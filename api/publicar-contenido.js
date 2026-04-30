import db, { sendLog } from './firebase.js';

export default async function handler(req, res) {
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
    const mensaje = `📖 <b>${data.titulo}</b>\n\n${data.texto}`;

    // Función auxiliar para enviar y alertar errores
    const enviarContenido = async (channelId, label) => {
      const response = await fetch(`${TELEGRAM_API}/sendAudio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: channelId,
          audio: data.audioUrl,
          caption: mensaje,
          parse_mode: "HTML"
        }),
      });

      const resJson = await response.json();
      if (!resJson.ok) {
        await sendLog(`⚠️ <b>FALLO DE ENVÍO [${label}]:</b>\nError: ${resJson.description}`);
        return { status: "error", error: resJson.description };
      }
      return { status: "exito" };
    };

    const resPremium = await enviarContenido(PREMIUM_CHANNEL, "Premium");
    const resFree = await enviarContenido(FREE_CHANNEL, "Gratuito");

    return res.status(200).json({ resultados: [resPremium, resFree] });

  } catch (error) {
    await sendLog(`🚨 <b>ERROR CRÍTICO EN CRON:</b>\n${error.message}`);
    return res.status(500).json({ error: error.message });
  }
}