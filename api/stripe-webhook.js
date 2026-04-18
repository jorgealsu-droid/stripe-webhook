import Stripe from 'stripe';

// Conectamos con Stripe usando la llave general
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Esta configuración es OBLIGATORIA en Vercel para que Stripe pueda leer los datos crudos
export const config = {
  api: {
    bodyParser: false,
  },
};

// Función para leer el flujo de datos exacto que envía Stripe
async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Solo se aceptan peticiones POST');
  }

  const rawBody = await buffer(req);
  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // Aquí ocurre la magia: Stripe compara su llave con la de tu Vercel
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error(`❌ Error de firma: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Si la firma es correcta, confirmamos la recepción
  console.log(`✅ Evento verificado y recibido: ${event.type}`);

  // Aquí iría tu lógica de Firebase para cancelar la suscripción
  if (event.type === 'customer.subscription.deleted') {
    console.log('Suscripción cancelada. Procediendo a actualizar la base de datos...');
  }

  res.status(200).json({ received: true });
}