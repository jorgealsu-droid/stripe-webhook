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

  // Función auxiliar para enviar mensajes a Telegram
  async function sendTelegramMsg(chatId, text) {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const telegramId = session.client_reference_id; 

      if (telegramId) {
        await db.collection('users').doc(telegramId).update({
          status: "premium",
          stripeCustomerId: session.customer,
          state: "normal", // Limpiamos cualquier estado de error previo
          updatedAt: new Date().toISOString()
        });

        const linkRes = await fetch(`${TELEGRAM_API}/createChatInviteLink`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: CHANNEL_ID, member_limit: 1, name: `Pago: ${telegramId}` }),
        });
        const linkData = await linkRes.json();

        if (linkData.ok) {
          await sendTelegramMsg(telegramId, `✅ <b>¡Pago exitoso!</b>\n\nBienvenido a la comunidad Premium. Únete al canal usando el siguiente enlace (solo funcionará una vez):\n\n${linkData.result.invite_link}`);
        } else {
            console.error("Fallo al generar el link en Telegram", linkData);
        }
      }
      break;
    }

    // --- BLOQUE: FALLO EN EL PRIMER INTENTO DE PAGO ---
    case 'payment_intent.payment_failed': {
      const paymentIntent = event.data.object;
      
      // En el primer pago, Firebase no tiene el ID. Consultamos a Stripe por los metadatos.
      if (paymentIntent.customer) {
        try {
          const customer = await stripe.customers.retrieve(paymentIntent.customer);
          const telegramId = customer.metadata.telegram_id;

          if (telegramId) {
            // Actualizamos la base de datos para que el bot sepa que intentó pagar pero falló
            await db.collection('users').doc(telegramId).update({
              state: "payment_failed" 
            });

            // Opcional: Notificarle en el momento (puede ser ruidoso si falla 3 veces seguidas)
            await sendTelegramMsg(telegramId, "⚠️ <b>Tu tarjeta fue rechazada.</b>\n\nNotamos que intentaste realizar el pago pero fue declinado. Envía /start para generar un nuevo enlace e intentar con otra tarjeta.");
          }
        } catch (err) {
          console.error("Error recuperando customer en payment_failed:", err.message);
        }
      }
      break;
    }

    // --- BLOQUE: FALLO EN RENOVACIÓN MENSUAL (Mes 2 en adelante) ---
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

          await sendTelegramMsg(tId, `⚠️ <b>Problemas con tu pago recurrente.</b>\n\nNo pudimos procesar el cobro de tu suscripción. Para no perder tu acceso al canal, actualiza tu método de pago aquí:\n\n${portalSession.url}`);
        } catch (error) {
          console.error("Error generando Customer Portal:", error.message);
        }
      }
      break;
    }

    // --- NUEVO BLOQUE: RENOVACIÓN EXITOSA (Mes 2 en adelante) ---
    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      
      // Ignoramos el primer pago (billing_reason: subscription_create) 
      // Solo actuamos en renovaciones (billing_reason: subscription_cycle)
      if (invoice.billing_reason === 'subscription_cycle' || invoice.billing_reason === 'manual') {
        const customerId = invoice.customer;
        const userSnap = await db.collection('users').where('stripeCustomerId', '==', customerId).get();

        if (!userSnap.empty) {
          const tId = userSnap.docs[0].id;
          
          try {
            const portalSession = await stripe.billingPortal.sessions.create({
              customer: customerId,
              return_url: `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}`,
            });

            await sendTelegramMsg(tId, `✅ <b>¡Renovación exitosa!</b>\n\nTu acceso Premium se ha extendido un mes más. Gracias por seguir en la comunidad.\n\n<i>Nota: Puedes gestionar o cancelar tu suscripción en cualquier momento desde tu panel de control:</i>\n\n👉 <a href="${portalSession.url}">Gestionar mi suscripción</a>`);
          } catch (error) {
            console.error("Error al crear portal en renovación:", error.message);
          }
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

        await sendTelegramMsg(tId, "❌ <b>Suscripción cancelada.</b>\n\nTu periodo de gracia ha terminado y tu acceso al canal privado ha sido revocado. Si deseas volver a unirte, inicia el proceso nuevamente enviando /start.");

        const banRes = await fetch(`${TELEGRAM_API}/banChatMember`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: CHANNEL_ID, user_id: tId }),
        });
        const banData = await banRes.json();
        
        if (!banData.ok) {
          await db.collection('system_logs').add({
            level: 'CRITICAL',
            process: 'webhook_telegram_banChatMember',
            telegramId: tId,
            errorDescription: banData.description,
            timestamp: new Date().toISOString()
          });
        } else {
          await fetch(`${TELEGRAM_API}/unbanChatMember`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: CHANNEL_ID, user_id: tId, only_if_banned: true }),
          });
        }
      }
      break;
    }
  }

  res.json({ received: true });
}
