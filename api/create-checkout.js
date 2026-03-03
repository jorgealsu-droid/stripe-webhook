import Stripe from "stripe";
import db from "./firebase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  const { telegram_id } = req.query;

  if (!telegram_id) return res.status(400).send("Falta ID de Telegram");

  try {
    // Verificamos si el usuario existe antes de cobrarle
    const userDoc = await db.collection('users').doc(String(telegram_id)).get();
    
    if (!userDoc.exists) {
      return res.status(400).send("Usuario no registrado en el bot. Escribe /start primero.");
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: "Acceso Premium - Reflexión" },
          unit_amount: 1000, // $10.00
        },
        quantity: 1,
      }],
      client_reference_id: String(telegram_id),
      // MEJORA: Regresa al bot después de pagar
      success_url: `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}`,
      cancel_url: `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}`,
    });

    res.redirect(303, session.url);
  } catch (err) {
    res.status(500).send("Error al crear pago");
  }
}
