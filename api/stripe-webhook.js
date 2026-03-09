import Stripe from 'stripe';
import db from './firebase.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Solo POST');

  const sig = req.headers['stripe-signature'];
  const buf = await buffer(req);
  let event;

  try {
    event = stripe.webhooks.constructEvent(buf, sig, endpointSecret);
  } catch (err) {
    console.error(`❌ Error de firma: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
  const CHANNEL_ID = "-1003524006612"; 

  switch (event.type) {
    case 'checkout.session.completed': {
      // Al usar { } aislamos el scope de las variables
      const session = event.data.object;
      const telegramId = session.client_reference_id; 

      if (telegramId) {
        await db.collection('users').doc(telegramId).update({
          status: "premium",
          stripeCustomerId: session.customer,
          updatedAt: new Date().toISOString()
        });

        const linkRes = await fetch(`${TELEGRAM_API}/createChatInviteLink`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: CHANNEL_ID, member_limit: 1, name: `Pago: ${telegramId}` }),
        });
        const linkData = await linkRes.json();

        if (linkData.ok) {
          await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: telegramId,
              text: `✅ <b>¡Pago exitoso!</b>\n\nBienvenido a la comunidad Premium. Únete al canal usando el siguiente enlace (solo funcionará una vez):\n\n${linkData.result.invite_link}`,
              parse_mode: "HTML"
            }),
          });
        } else {
            console.error("Fallo al generar el link en Telegram", linkData);
        }
      } else {
        console.error("Pago completado pero no se encontró client_reference_id (telegramId)");
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const failedCustomerId = invoice.customer;
      
      const failedUserSnap = await db.collection('users').where('stripeCustomerId', '==', failedCustomerId).get();
      
      if (!failedUserSnap.empty) {
        const tId = failedUserSnap.docs[0].id;
        
        try {
          const portalSession = await stripe.billingPortal.sessions.create({
            customer: failedCustomerId,
            return_url: `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}`,
          });

          await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: tId,
              text: `⚠️ <b>Problemas con tu pago.</b>\n\nNo pudimos procesar el cobro de tu suscripción. Para no perder tu acceso al canal, actualiza tu método de pago aquí:\n\n${portalSession.url}`,
              parse_mode: "HTML"
            }),
          });
        } catch (error) {
          console.error("Error generando Customer Portal:", error.message);
        }
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const deletedSub = event.data.object;
      const deletedCustomerId = deletedSub.customer;
      
      const deletedUserSnap = await db.collection('users').where('stripeCustomerId', '==', deletedCustomerId).get();
      
      if (!deletedUserSnap.empty) {
        const userDoc = deletedUserSnap.docs[0];
        const tId = userDoc.id;

        await userDoc.ref.update({ status: "revoked" });

        await fetch(`${TELEGRAM_API}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: tId,
            text: "❌ <b>Suscripción cancelada.</b>\n\nTu periodo de gracia ha terminado y tu acceso al canal privado ha sido revocado. Si deseas volver a unirte, inicia el proceso nuevamente enviando /start.",
            parse_mode: "HTML"
          }),
        });
        
        await fetch(`${TELEGRAM_API}/banChatMember`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: CHANNEL_ID,
            user_id: tId
          }),
        });
        
        await fetch(`${TELEGRAM_API}/unbanChatMember`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: CHANNEL_ID,
            user_id: tId,
            only_if_banned: true
          }),
        });
      }
      break;
    }
  }

  res.json({ received: true });
}
