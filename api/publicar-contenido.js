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
  // 1. Verificación de Seguridad
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  let report = [];

  try {
    // 2. Obtener contenido de Firestore
    const contentDoc = await db.collection("liturgical_content").doc(today).get();

    if (!contentDoc.exists) {
      return res.status(200).json({ status: "Sin contenido para hoy", fecha: today });
    }

    const data = contentDoc.data();
    const tiempo = data.tiempo_liturgico || "Sin tiempo";
    const evangelio = data.evangelio || "Evangelio no disponible";
    const reflexion = data.reflexion || "Reflexión no disponible";
    const audioUrl = data.audioUrl;

    const channelsConfig = [
      { name: "Premium", type: "audio", telegramId: process.env.TELEGRAM_CHANNEL_ID_PREMIUM },
      { name: "Gratuito", type: "text", telegramId: process.env.TELEGRAM_CHANNEL_ID_FREE }
    ];

    for (const config of channelsConfig) {
      if (!config.telegramId) continue;

      let response;

      if (config.type === "audio" && audioUrl) {
        // --- MÉTODO ROBUSTO: ENVÍO DE ARCHIVO DIRECTO ---
        // Descargamos el audio a la memoria de Vercel primero
        const audioFileResponse = await fetch(audioUrl);
        const audioBlob = await audioFileResponse.blob();
        
        const formData = new FormData();
        formData.append('chat_id', config.telegramId);
        formData.append('audio', audioBlob, 'audio.mp3');
        formData.append('caption', `<b>${tiempo}</b>\n\n📖 <b>Evangelio:</b>\n${evangelio}`.substring(0, 1024));
        formData.append('parse_mode', 'HTML');

        response = await fetch(`${TELEGRAM_API}/sendAudio`, {
          method: "POST",
          body: formData, // Enviamos el archivo físicamente
        });
      } else {
        // --- ENVÍO DE TEXTO (CANAL GRATUITO) ---
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

      const resultData = await response.json();
      if (!response.ok) {
        report.push({ canal: config.name, status: "error", detalle: JSON.stringify(resultData) });
      } else {
        report.push({ canal: config.name, status: "exito" });
      }
    }

    return res.status(200).json({ resultados: report });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}