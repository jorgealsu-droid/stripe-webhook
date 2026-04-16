import Stripe from 'stripe';
import db from '../api/firebase.js';
import { buffer } from 'micro';

export const config = {
  api: {
    bodyParser: false, 
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  // 1. Cierre del Punto Ciego: Rechazar inmediatamente lo que no sea POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  let event;

  // 2. Extracción y Validación (Un solo bloque Try/Catch para esto)
  try {
    const rawBody = await buffer(req);
    const signature = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    console.log("=== DIAGNÓSTICO DE ENTRADA ===");
    console.log("Secreto configurado en .env:", endpointSecret ? "Cargado" : "NO ENCONTRADO");

    event = stripe.webhooks.constructEvent(rawBody, signature, endpointSecret);
  } catch (err) {
    console.error(`❌ Error de firma: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // 3. Lógica de Negocio
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
        console.log(`Evento ignorado de forma segura: ${event.type}`);
    }

    return res.json({ received: true });
  } catch (error) {
    console.error('❌ Error interno procesando el webhook:', error);
    return res.status(500).send('Internal Server Error');
  }
}