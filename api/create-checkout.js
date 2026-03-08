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
    // 1. PASO NUEVO: Crear el cliente en Stripe explícitamente primero
    const customer = await stripe.customers.create({
      metadata: { telegram_id: telegram_id } // Anclamos el ID de Telegram al perfil del cliente
    });

    // 2. Generar la sesión de Checkout vinculada a ese cliente
    const session = await stripe.checkout.sessions.create({
      customer: customer.id, // <--- ESTA ES LA LLAVE QUE FALTABA
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID, 
          quantity: 1,
        },
      ],
      mode: 'subscription', // IMPORTANTE: Cambia a 'subscription' si tu precio es mensual
      client_reference_id: telegram_id,
      success_url: `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=success`,
      cancel_url: `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}`,
    });

    res.redirect(303, session.url);

  } catch (error) {
    console.error('Error crítico al crear sesión de Stripe:', error.message);
    res.status(500).json({ error: 'Fallo al iniciar el checkout.' });
  }
}
