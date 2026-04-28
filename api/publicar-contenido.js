import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.trim().replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();

export default async function handler(req, res) {
  // Validación de seguridad para el Cron de Vercel
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const channelsConfig = [
    { name: "Premium", type: "audio", telegramId: process.env.TELEGRAM_CHANNEL_ID_PREMIUM },
    { name: "Gratuito", type: "text", telegramId: process.env.TELEGRAM_CHANNEL_ID_FREE }
  ];

  const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
  const ADMIN_ID = process.env.ADMIN_CHAT_ID;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  let report = []; 

  try {
    const contentDoc = await db.collection("liturgical_content").doc(today).get();

    if (!contentDoc.exists) {
       return res.status(200).json({ status: "Sin contenido para hoy", fecha: today });
    }

    const data = contentDoc.data();

    for (const config of channelsConfig) {
      if (!config.telegramId) continue;

      let response;

      if (config.type === "audio") {
        // --- LÓGICA PREMIUM: AUDIO + TEXTO (Limitado a 1024 chars) ---
        let caption = `<b>${data.tiempo_liturgico}</b>\n\n📖 <b>Evangelio:</b>\n${data.evangelio}`;
        
        if (caption.length > 1024) {
          caption = caption.substring(0, 1020) + "...";
        }
        
        response = await fetch(`${TELEGRAM_API}/sendAudio`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            chat_id: config.telegramId, 
            audio: data.audioUrl, 
            caption: caption,
            parse_mode: "HTML"
          }),
        });
      } else {
        // --- LÓGICA GRATUITA: TODO EN TEXTO (Límite 4096 chars) ---
        const fullText = `<b>${data.tiempo_liturgico}</b>\n\n📖 <b>Evangelio:</b>\n${data.evangelio}\n\n🧠 <b>Reflexión:</b>\n${data.reflexion}`;
        
        response = await fetch(`${TELEGRAM_API}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            chat_id: config.telegramId, 
            text: fullText, 
            parse_mode: "HTML" 
          }),
        });
      }

      const resData = await response.json();
      if (!response.ok) {
        report.push({ canal: config.name, status: "error", detalle: resData.description });
      } else {
        report.push({ canal: config.name, status: "exito" });
      }
    }

    // Actualizamos Firestore solo si hubo éxito en el canal Premium
    if (report.find(r => r.canal === "Premium" && r.status === "exito")) {
      await contentDoc.ref.update({ sent: true, sentAt: new Date().toISOString() });
    }

    return res.status(200).json({ resultados: report });

  } catch (error) {
    if (ADMIN_ID) {
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: ADMIN_ID, text: `🚨 <b>ERROR CRON:</b> ${error.message}`, parse_mode: "HTML" }),
      });
    }
    return res.status(500).json({ error: error.message });
  }
}