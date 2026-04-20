import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Esta versión limpia comillas y arregla saltos de línea reales o escritos
      privateKey: process.env.FIREBASE_PRIVATE_KEY
        .replace(/\\n/g, '\n')
        .replace(/"/g, '') 
    }),
  });
}

const db = admin.firestore();

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const channelsConfig = [
    { name: "Liturgia", dbCollection: "liturgical_content", telegramId: process.env.TELEGRAM_CHANNEL_ID },
  ];

  const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
  const ADMIN_ID = process.env.ADMIN_CHAT_ID;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  let report = []; 

  try {
    for (const config of channelsConfig) {
      const contentDoc = await db.collection(config.dbCollection).doc(today).get();

      if (!contentDoc.exists) {
         report.push({ canal: config.name, status: "ignorado", razon: "Sin contenido para hoy" });
         continue; 
      }

      const content = contentDoc.data();

      if (content.sent) {
        report.push({ canal: config.name, status: "ignorado", razon: "Ya enviado previamente" });
        continue;
      }

      const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          chat_id: config.telegramId, 
          text: content.mensaje_formateado, 
          parse_mode: "HTML" 
        }),
      });

      if (!response.ok) {
        throw new Error(`Falla en Telegram: ${await response.text()}`);
      }

      await contentDoc.ref.update({ sent: true, sentAt: new Date().toISOString() });
      report.push({ canal: config.name, status: "exito", fecha: today });
    } 

    return res.status(200).json({ status: "Proceso finalizado", resultados: report });

  } catch (error) {
    if (ADMIN_ID) {
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: ADMIN_ID, text: `🚨 ERROR: ${error.message}`, parse_mode: "HTML" }),
      });
    }
    return res.status(500).json({ error: error.message });
  }
}