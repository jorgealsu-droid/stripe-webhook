import db, { sendLog } from './firebase.js';

export default async function handler(req, res) {
  // 1. Validación de seguridad del Cron Job
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
  const PREMIUM_CHANNEL = process.env.TELEGRAM_CHANNEL_ID_PREMIUM;
  const FREE_CHANNEL = process.env.TELEGRAM_CHANNEL_ID_FREE;

  // Obtener fecha actual en formato YYYY-MM-DD
  const hoy = new Date().toISOString().split('T')[0];

  try {
    const doc = await db.collection('liturgical_content').doc(hoy).get();
    
    if (!doc.exists) {
      await sendLog(`❌ <b>ERROR DE CONTENIDO:</b> No existe el documento para la fecha ${hoy} en Firestore.`);
      return res.status(404).json({ error: "Contenido no encontrado" });
    }

    const data = doc.data();
    
    // Armamos el bloque de texto estándar (común para ambos)
    const textoBase = `✝️ <b>${data.tiempo_liturgico}</b>\n\n${data.evangelio}`;

    // --- ENVÍO CANAL PREMIUM (Audio + Texto como Caption) ---
    const premiumRes = await fetch(`${TELEGRAM_API}/sendAudio`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: PREMIUM_CHANNEL,
        audio: data.audioUrl,
        caption: textoBase,
        parse_mode: "HTML"
      }),
    });
    const premiumData = await premiumRes.json();
    if (!premiumData.ok) {
      await sendLog(`⚠️ <b>FALLO DE ENVÍO [Premium]:</b> ${premiumData.description}`);
    }

    // --- ENVÍO CANAL FREE (Solo Texto) ---
    const freeRes = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: FREE_CHANNEL,
        text: textoBase,
        parse_mode: "HTML"
      }),
    });
    const freeData = await freeRes.json();
    if (!freeData.ok) {
      await sendLog(`⚠️ <b>FALLO DE ENVÍO [Gratuito]:</b> ${freeData.description}`);
    }

    return res.status(200).json({ 
      resultados: [
        { canal: "Premium", status: premiumData.ok ? "exito" : "error", detalle: premiumData.description || null },
        { canal: "Gratuito", status: freeData.ok ? "exito" : "error", detalle: freeData.description || null }
      ] 
    });

  } catch (error) {
    await sendLog(`🚨 <b>ERROR CRÍTICO EN CRON:</b>\n${error.message}`);
    return res.status(500).json({ error: error.message });
  }
}