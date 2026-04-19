import Stripe from 'stripe';
import admin from 'firebase-admin';

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
  } catch (err) { return res.status(400).send(err.message); }

  if (event.type === 'customer.subscription.deleted') {
    const stripeCustomerId = event.data.object.customer;
    const snapshot = await db.collection('users').where('stripeCustomerId', '==', stripeCustomerId).get();

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
  res.status(200).json({ received: true });
}