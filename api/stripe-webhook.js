import Stripe from 'stripe';
import db from './firebase.js';

// Desactivar el bodyParser por defecto de Next.js/Vercel para poder leer el raw body
export const config = {
  api: {
    bodyParser: false,
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Función auxiliar para leer el raw body (Requerido por Stripe)
async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const CHANNEL_ID = "-1003524006612"; 

// Función aislada para envíos a Telegram con manejo de errores interno
async function sendTelegramMsg(chatId, text) {
  try {
    const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    if (!response.ok) {
      console.error(`Error de la API de Telegram al enviar a ${chatId}:`, await response.text());
    }
  } catch (err) {
    console.error(`Fallo crítico de red al contactar a Telegram (${chatId}):`, err.message);
  }
}

export default async function handler(req, res) {
  // 1. Validación de método
  if (req.method !== 'POST') {
    return res.status(405).send('Método no permitido. Solo POST.');
  }

  const sig = req.headers['stripe-signature'];
  let buf;
  let event;

  // 2. Extracción segura del buffer
  try {
    buf = await buffer(req);
  } catch (err) {
    console.error('Error leyendo el buffer de la petición:', err.message);
    return res.status(400).send(`Error de Buffer: ${err.message}`);
  }

  // 3. Validación de firma de Stripe
  try {
    event = stripe.webhooks.constructEvent(buf, sig, endpointSecret);
  } catch (err) {
    console.error(`❌ Error de firma de Stripe: ${err.message}`);
    // Si la firma falla, es crítico detener la ejecución con un 400.
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`✅ Webhook recibido y validado: ${event.type}`);

  // 4. Lógica de negocio encapsulada
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const telegramId = session.client_reference_id; 

        if (!telegramId) {
          console.warn("Evento recibido sin client_reference_id. Imposible vincular con Telegram.");
          break;
        }

        // CORRECCIÓN: set con merge: true evita crashes si el documento no existe
        await db.collection('users').doc(telegramId).set({
          status: "premium",
          stripeCustomerId: session.customer,
          state: "normal",
          updatedAt: new Date().toISOString()
        }, { merge: true });

        const linkRes = await fetch(`${TELEGRAM_API}/createChatInviteLink`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: CHANNEL_ID, member_limit: 1, name: `Pago: ${telegramId}` }),
        });
        const linkData = await linkRes.json();

        if (linkData.ok) {
          await sendTelegramMsg(telegramId, `✅ <b>¡Pago exitoso!</b>\n\nBienvenido a la comunidad Premium. Únete al canal usando el siguiente enlace (solo funcionará una vez):\n\n${linkData.result.invite_link}`);
        } else {
          console.error("Fallo al generar el link en Telegram:", linkData.description);
        }
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object;
        
        if (paymentIntent.customer) {
          const customer = await stripe.customers.retrieve(paymentIntent.customer);
          const telegramId = customer.metadata.telegram_id;

          if (telegramId) {
            await db.collection('users').doc(telegramId).set({
              state: "payment_failed" 
            }, { merge: true });

            await sendTelegramMsg(telegramId, "⚠️ <b>Tu tarjeta fue rechazada.</b>\n\nNotamos que intentaste realizar el pago pero fue declinado. Envía /start para generar un nuevo enlace e intentar con otra tarjeta.");
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const failedCustomerId = invoice.customer;
        
        const failedUserSnap = await db.collection('users').where('stripeCustomerId', '==', failedCustomerId).get();
        
        if (!failedUserSnap.empty) {
          const tId = failedUserSnap.docs[0].id;
          
          const portalSession = await stripe.billingPortal.sessions.create({
            customer: failedCustomerId,
            return_url: `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}`,
          });

          await sendTelegramMsg(tId, `⚠️ <b>Problemas con tu pago recurrente.</b>\n\nNo pudimos procesar el cobro de tu suscripción. Para no perder tu acceso al canal, actualiza tu método de pago aquí:\n\n${portalSession.url}`);
        } else {
           console.warn(`invoice.payment_failed: No se encontró usuario en BD para el customer ${failedCustomerId}`);
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        
        if (invoice.billing_reason === 'subscription_cycle' || invoice.billing_reason === 'manual') {
          const customerId = invoice.customer;
          const userSnap = await db.collection('users').where('stripeCustomerId', '==', customerId).get();

          if (!userSnap.empty) {
            const tId = userSnap.docs[0].id;
            
            const portalSession = await stripe.billingPortal.sessions.create({
              customer: customerId,
              return_url: `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}`,
            });

            await sendTelegramMsg(tId, `✅ <b>¡Renovación exitosa!</b>\n\nTu acceso Premium se ha extendido un mes más. Gracias por seguir en la comunidad.\n\n👉 <a href="${portalSession.url}">Gestionar mi suscripción</a>`);
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

          await userDoc.ref.set({ status: "revoked" }, { merge: true });
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
      
      default:
        console.log(`Evento no manejado por diseño: ${event.type}`);
    }
  } catch (err) {
    // CORRECCIÓN CRÍTICA: Captura fallos de asincronía en Firebase/Telegram
    console.error(`❌ Error interno procesando el evento ${event.type}:`, err);
    return res.status(500).send(`Error interno del servidor: ${err.message}`);
  }

  // 5. Respuesta final a Stripe
  res.status(200).json({ received: true });
}
