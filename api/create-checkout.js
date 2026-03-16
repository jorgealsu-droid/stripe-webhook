import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido. Usa GET.' });
  }

  const { telegram_id } = req.query;

  if (!telegram_id) {
    return res.status(400).json({ error: 'Falta el telegram_id. No se puede rastrear el pago.' });
  }

  try {
    const customer = await stripe.customers.create({
      metadata: { telegram_id: telegram_id } 
    });

    const session = await stripe.checkout.sessions.create({
      customer: customer.id, 
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID, 
          quantity: 1,
        },
      ],
      mode: 'subscription', 
      client_reference_id: telegram_id,
      // AQUÍ ESTÁ EL CAMBIO CRÍTICO:
      success_url: `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=success_stripe`,
      cancel_url: `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}`,
    });

    res.redirect(303, session.url);

  } catch (error) {
    console.error('Error crítico al crear sesión de Stripe:', error.message);
    res.status(500).json({ error: 'Fallo al iniciar el checkout.' });
  }
}
