import Stripe from 'stripe';
import db from './firebase.js';

// 1. INSTRUCCIÓN CRÍTICA PARA VERCEL: No toques el body
export const config = {
  api: {
    bodyParser: false,
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Función para leer el flujo de datos crudo
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
  const buf = await buffer(req); // Leemos el body como buffer binario
  let event;

  try {
    // 2. VERIFICACIÓN DE SEGURIDAD
    event = stripe.webhooks.constructEvent(buf, sig, endpointSecret);
  } catch (err) {
    console.error(`❌ Error de firma: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
  const CHANNEL_ID = "-1003524006612"; // Tu canal privado

  // 3. PROCESAR EVENTOS
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      const telegramId = session.client_reference_id; 

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

        if (linkData.ok) {
          // Enviar el link de bienvenida
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
      
    // Aquí irían los casos de cancelación que omitimos temporalmente
  }

  res.json({ received: true });
}
