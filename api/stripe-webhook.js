import Stripe from "stripe";
import db from './firebase.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = { api: { bodyParser: false } };

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  const buf = await buffer(req);
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send("Webhook Error");
  }

if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const telegramId = session.client_reference_id;
    const CHANNEL_ID = "-1003524006612";
    const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

    try {
      // 1. Actualizar usuario en Firestore a estado PREMIUM
      await db.collection('users').doc(String(telegramId)).update({
        status: "premium",
        paidAt: new Date().toISOString(),
        stripeSessionId: session.id
      });

      // 2. Generar enlace de invitación de UN SOLO USO
      const linkResponse = await fetch(`${TELEGRAM_API}/createChatInviteLink`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CHANNEL_ID,
          member_limit: 1, // CRÍTICO: Evita que el usuario lo comparta con amigos
          name: `Premium: ${telegramId}` // Para que lo identifiques en los ajustes de Telegram
        }),
      });

      const linkData = await linkResponse.json();

      if (!linkData.ok) {
        throw new Error(`Telegram rechazó crear el enlace: ${linkData.description}`);
      }

      const inviteLink = linkData.result.invite_link;

      // 3. Entregar el producto al usuario
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: telegramId,
          text: `✅ <b>¡Pago recibido con éxito!</b>\n\nTu cuenta ahora es Premium. Únete al canal privado usando este enlace único (solo funcionará una vez, no lo compartas):\n\n${inviteLink}`,
          parse_mode: "HTML"
        }),
      });

    } catch (err) {
      console.error("Fallo crítico en la entrega del producto:", err);
      // Falla de negocio: Si esto ocurre, el usuario pagó pero no recibió el enlace.
      // Lo ideal aquí sería enviar una alerta a tu propio ID de Telegram para que lo resuelvas manualmente.
    }
  }

  res.status(200).json({ received: true });

    // Avisar al usuario
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: telegramId,
        text: "✅ <b>¡Acceso Premium activado!</b>\n\nGracias por tu compra. Ya puedes acceder a todo el contenido.",
        parse_mode: "HTML"
      }),
    });
  }

  res.status(200).json({ received: true });
}
