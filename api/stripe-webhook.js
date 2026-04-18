import Stripe from 'stripe';
import admin from 'firebase-admin';

// 1. Conexión Segura con Firebase
// Usamos este "if" para que Vercel no intente conectar dos veces y marque error
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Esta línea es un truco necesario para que Vercel lea bien las llaves privadas
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = {
  api: {
    bodyParser: false,
  },
};

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Método no permitido');
  }

  const rawBody = await buffer(req);
  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error(`❌ Error de firma: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // --- AQUÍ EMPIEZA LA ACCIÓN REAL ---

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const stripeCustomerId = subscription.customer; // El ID que empieza con 'cus_'

    console.log(`Suscripción cancelada detectada para el cliente: ${stripeCustomerId}`);

    try {
      // 2. Buscamos al usuario en tu colección "users" que coincida con ese ID de Stripe
      const usersRef = db.collection('users');
      const snapshot = await usersRef.where('stripeCustomerId', '==', stripeCustomerId).get();

      if (snapshot.empty) {
        console.log('⚠️ No se encontró ningún usuario con ese ID de Stripe en Firebase.');
      } else {
        // 3. Si lo encuentra, le cambiamos el estatus a "revoked"
        const batch = db.batch();
        snapshot.forEach(doc => {
          batch.update(doc.ref, { 
            status: 'revoked',
            updatedAt: admin.firestore.FieldValue.serverTimestamp() 
          });
        });
        await batch.commit();
        console.log('✅ Éxito: Estatus actualizado a "revoked" en Firebase Test.');
      }
    } catch (error) {
      console.error('❌ Error al actualizar Firebase:', error);
    }
  }

  res.status(200).json({ received: true });
}