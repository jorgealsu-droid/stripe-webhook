import Stripe from 'stripe';
import db from './firebase.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Solo POST');

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // 1. VERIFICACIÓN DE SEGURIDAD (Criptográfica)
    const rawBody = await req.text(); // Vercel necesita el body crudo para validar la firma
    event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
  } catch (err) {
    console.error(`❌ Error de firma: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
  const CHANNEL_ID = "-1003524006612";

  // 2. PROCESAR EVENTOS
  switch (event.type) {
    
    // CASO A: PAGO EXITOSO (Checkout Único o Primera Suscripción)
    case 'checkout.session.completed':
      const session = event.data.object;
      const telegramId = session.client_reference_id; // Recuperamos el ID que guardamos

      if (telegramId) {
        // Actualizar Firestore
        await db.collection('users').doc(telegramId).update({
          status: "premium",
          stripeCustomerId: session.customer,
          updatedAt: new Date().toISOString()
        });

        // Generar Link de Invitación (Un solo uso)
        const linkRes = await fetch(`${TELEGRAM_API}/createChatInviteLink`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: CHANNEL_ID, member_limit: 1, name: `Pago: ${telegramId}` }),
        });
        const linkData = await linkRes.json();

        // Enviar mensaje de bienvenida con el Link
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
        }
      }
      break;

    // CASO B: SUSCRIPCIÓN CANCELADA O REEMBOLSO
    case 'customer.subscription.deleted':
    case 'charge.refunded':
      const obj = event.data.object;
      // Buscamos al usuario por su Customer ID de Stripe
      const userSnapshot = await db.collection('users').where('stripeCustomerId', '==', obj.customer).get();
      
      if (!userSnapshot.empty) {
        const userDoc = userSnapshot.docs[0];
        const tId = userDoc.id;

        await userDoc.ref.update({ status: "revoked" });

        // Notificar al usuario (Ley de Protección al Consumidor)
        await fetch(`${TELEGRAM_API}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: tId,
            text: "⚠️ <b>Tu acceso ha sido revocado.</b>\n\nHemos detectado una cancelación o reembolso. Si deseas volver a entrar, inicia el proceso de pago nuevamente con /start.",
            parse_mode: "HTML"
          }),
        });
        
        // NOTA: Aquí deberías usar la API de Telegram para banear al usuario del canal 
        // para que sea expulsado físicamente en este momento.
      }
      break;
  }

  res.json({ received: true });
}
