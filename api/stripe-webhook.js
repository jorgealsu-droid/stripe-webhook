import Stripe from 'stripe';
import admin from 'firebase-admin';
import { sendLog } from './firebase.js';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}
const db = admin.firestore();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
export const config = { api: { bodyParser: false } };

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  const rawBody = await buffer(req);
  const signature = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(err.message);
  }

  // ----- Idempotencia por event.id -----
  // Stripe puede reenviar el mismo evento (red, timeout, replay manual).
  // Usamos `create()` como candado atómico: si el doc ya existe, este intento es duplicado.
  const dedupRef = db.collection('webhook_events').doc(`stripe_${event.id}`);
  try {
    await dedupRef.create({
      provider: 'stripe',
      eventId: event.id,
      type: event.type,
      livemode: event.livemode,
      status: 'received',
      receivedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    if (err.code === 6) {
      // Ya recibimos este event.id antes. 200 OK para que Stripe deje de reintentar.
      return res.status(200).json({ received: true, duplicate: true });
    }
    await sendLog(`🚨 <b>STRIPE WEBHOOK:</b> Fallo escribiendo dedup para ${event.id}: ${err.message}`);
    return res.status(500).json({ error: 'dedup write failed' });
  }

  // ----- Handlers de eventos -----
  try {
    if (event.type === 'customer.subscription.deleted') {
      const stripeCustomerId = event.data.object.customer;
      const snapshot = await db.collection('users')
        .where('stripeCustomerId', '==', stripeCustomerId).get();

      for (const doc of snapshot.docs) {
        await doc.ref.update({ status: 'revoked' });
        const { telegramId } = doc.data();
        if (telegramId) {
          await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/banChatMember`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHANNEL_ID, user_id: telegramId })
          });
        }
      }
    }

    await dedupRef.update({
      status: 'processed',
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return res.status(200).json({ received: true });
  } catch (err) {
    // El doc queda en status='received' para diagnóstico.
    // Stripe reintentará; el reintento entrará al mismo path (ALREADY_EXISTS) y NO se reprocesará.
    // Es aceptable HOY porque el único handler (subscription.deleted) es idempotente por naturaleza.
    // Cuando agregues handlers no idempotentes (checkout, invoice), esto hay que repensarlo.
    await sendLog(`🚨 <b>STRIPE WEBHOOK:</b> Error procesando ${event.type} (${event.id}): ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
}
