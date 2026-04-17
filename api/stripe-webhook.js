import Stripe from 'stripe';
import db from '../api/firebase.js';

// Mantenemos la orden de apagar el parser de Vercel
export const config = {
  api: {
    bodyParser: false, 
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  try {
    // 1. LECTURA NATIVA: Adiós 'micro'. Leemos los bytes puros directamente de Node.js
    const rawBody = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });

    const signature = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    // 2. EL TRACER BULLET: Forzamos a Vercel a imprimir qué está procesando realmente
    console.log("=== DIAGNÓSTICO PROFUNDO ===");
    console.log(`1. Longitud del rawBody: ${rawBody.length} caracteres`);
    console.log(`2. Primeros 20 caracteres: ${rawBody.substring(0, 20)}...`);
    console.log(`3. Inicio de Firma: ${signature ? signature.substring(0, 15) : 'NULA'}`);
    console.log(`4. Últimos 4 del Secreto Vercel: ${endpointSecret ? endpointSecret.slice(-4) : 'NULO'}`);

    if (rawBody.length === 0) {
      throw new Error("El body crudo está vacío. El parser de Vercel lo mutiló antes de que pudiéramos leerlo.");
    }

    // 3. Validación
    const event = stripe.webhooks.constructEvent(rawBody, signature, endpointSecret);

    // 4. Lógica de Negocio
    switch (event.type) {
      case 'customer.subscription.deleted':
      case 'invoice.payment_failed':
        const session = event.data.object;
        const stripeCustomerId = session.customer;

        console.log(`[ALERTA] Evento detectado (${event.type}) para: ${stripeCustomerId}`);

        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('stripeCustomerId', '==', stripeCustomerId).get();

        if (snapshot.empty) {
          console.error(`[ERROR LÓGICO] El cliente ${stripeCustomerId} no existe en Firestore.`);
          return res.status(404).json({ error: 'User not found' });
        }

        const batch = db.batch();
        snapshot.forEach(doc => {
          batch.update(doc.ref, { 
            active: false,
            cancellation_date: new Date(),
            reason: event.type 
          });
        });
        
        await batch.commit();
        console.log(`[ÉXITO] Usuario ${stripeCustomerId} desactivado en Firestore.`);
        break;

      default:
        console.log(`Evento ignorado de forma segura: ${event.type}`);
    }

    return res.json({ received: true });

  } catch (err) {
    console.error(`❌ Falla crítica: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
}