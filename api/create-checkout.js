import Stripe from 'stripe';

// Inicializamos Stripe con la variable de entorno (Nunca hardcodeado)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido. Usa GET.' });
  }

  // Extraemos el telegram_id que inyectamos en la URL desde el webhook
  const { telegram_id } = req.query;

  if (!telegram_id) {
    return res.status(400).json({ error: 'Falta el telegram_id. No se puede rastrear el pago.' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID, 
          quantity: 1,
        },
      ],
      mode: 'subscription', // O 'subscription' si tu price_id es recurrente
      
      // CRÍTICO: Aquí es donde anclamos el pago al usuario de Telegram
      client_reference_id: telegram_id,

      // Redirecciones tras el pago (Cámbialas por el enlace real de tu bot)
      success_url: `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=success`,
      cancel_url: `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}`,
    });

    // Redirigimos al usuario al checkout alojado en Stripe
    res.redirect(303, session.url);

  } catch (error) {
    console.error('Error crítico al crear sesión de Stripe:', error.message);
    res.status(500).json({ error: 'Fallo al iniciar el checkout.' });
  }
}
