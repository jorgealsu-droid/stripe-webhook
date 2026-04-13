import Stripe from 'stripe';
import db from '../api/firebase.js'; // Importación por defecto (alineada con tu firebase.js)
import { buffer } from 'micro';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    console.log("=== DIAGNÓSTICO DE ENTRADA ===");
    console.log("Secreto configurado en .env:", endpointSecret);
    
    event = stripe.webhooks.constructEvent(buf, sig, endpointSecret);
  } catch (err) {
    console.error(`❌ Error de firma: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
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
        console.log(`Evento ignorado: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Error procesando el webhook:', error);
    res.status(500).send('Internal Server Error');
  }
}