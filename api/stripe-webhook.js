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
  if (req.method !== 'POST') return res.status(405).send('Método no permitido');

  const rawBody = await buffer(req);
  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'customer.subscription.deleted') {
    const stripeCustomerId = event.data.object.customer;

    try {
      const usersRef = db.collection('users');
      const snapshot = await usersRef.where('stripeCustomerId', '==', stripeCustomerId).get();

      if (snapshot.empty) {
        console.log('⚠️ Usuario no encontrado en Firebase.');
      } else {
        for (const doc of snapshot.docs) {
          const userData = doc.data();
          
          // 1. Actualiza la ficha del usuario en la base de datos
          await doc.ref.update({ 
            status: 'revoked',
            updatedAt: admin.firestore.FieldValue.serverTimestamp() 
          });
          console.log('✅ Firebase actualizado a "revoked".');

          // 2. Ejecuta la expulsión de Telegram
          if (userData.telegramId) {
            // Le pregunta a Vercel: "¿Cuál es el token del bot que debo usar?"
            const telegramUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/banChatMember`;
            
            const response = await fetch(telegramUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                // Aquí es donde usamos el ID del canal secreto de Vercel
                chat_id: process.env.TELEGRAM_CHANNEL_ID,
                user_id: userData.telegramId
              })
            });

            const result = await response.json();
            if (result.ok) {
              console.log(`✅ Usuario ${userData.telegramId} expulsado del canal.`);
            } else {
              console.error(`❌ Telegram no pudo expulsar: ${result.description}`);
            }
          }
        }
      }
    } catch (error) {
      console.error('❌ Error en el proceso:', error);
    }
  }

  res.status(200).json({ received: true });
}