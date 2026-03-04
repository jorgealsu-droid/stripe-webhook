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

    // Actualizar Firestore
    await db.collection('users').doc(String(telegramId)).update({
      status: "premium",
      paidAt: new Date().toISOString(),
      stripeId: session.id
    });

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
