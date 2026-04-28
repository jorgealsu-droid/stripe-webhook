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

    // Mapeo flexible para evitar el "undefined" si hay acentos en Firestore
    const tiempo = data.tiempo_liturgico || data.tiempo_litúrgico || "Sin tiempo";
    const evangelio = data.evangelio || "Evangelio no disponible";
    const reflexion = data.reflexion || data.reflexión || "Reflexión no disponible";
    const audio = data.audioUrl || data.audio_url;

    for (const config of channelsConfig) {
      if (!config.telegramId) continue;

      let response;

      if (config.type === "audio" && audio) {
        // --- ENVÍO AUDIO (PREMIUM) ---
        let caption = `<b>${tiempo}</b>\n\n📖 <b>Evangelio:</b>\n${evangelio}`;
        if (caption.length > 1024) caption = caption.substring(0, 1020) + "...";
        
        response = await fetch(`${TELEGRAM_API}/sendAudio`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            chat_id: config.telegramId, 
            audio: audio, 
            caption: caption,
            parse_mode: "HTML"
          }),
        });
      } else {
        // --- ENVÍO TEXTO (FREE) ---
        const fullText = `<b>${tiempo}</b>\n\n📖 <b>Evangelio:</b>\n${evangelio}\n\n🧠 <b>Reflexión:</b>\n${reflexion}`;
        
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

      if (!response.ok) {
        const errorText = await response.text();
        report.push({ canal: config.name, status: "error", detalle: errorText });
      } else {
        report.push({ canal: config.name, status: "exito" });
      }
    }

    return res.status(200).json({ resultados: report });

  } catch (error) {
    if (ADMIN_ID) {
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: ADMIN_ID, text: `🚨 ERROR EN TEST: ${error.message}` }),
      });
    }
    return res.status(500).json({ error: error.message });
  }
}