import db from './firebase.js';

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const CHANNEL_ID = "-1003524006612";

export default async function handler(req, res) {
  // 1. Barrera de seguridad
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    // 2. Corrección arquitectónica: Forzamos la zona horaria local de CDMX
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
    
    // 3. Consulta a la base de datos
    const contentDoc = await db.collection('content').doc(today).get();

    if (!contentDoc.exists) {
      console.error(`Fallo: No hay contenido programado para la fecha local de hoy: ${today}`);
      return res.status(404).json({ message: "Contenido no encontrado", fechaBuscada: today });
    }

    const content = contentDoc.data();

    // 4. Prevención de envíos duplicados
    if (content.sent) {
      return res.status(200).json({ message: "El contenido de hoy ya fue enviado previamente." });
    }

    // 5. Disparo a la API de Telegram
    const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        chat_id: CHANNEL_ID, 
        text: content.text, 
        parse_mode: "HTML" 
      }),
    });

    if (response.ok) {
      // 6. Actualización de estado en Firestore
      await contentDoc.ref.update({ sent: true, sentAt: new Date().toISOString() });
      return res.status(200).json({ status: "success", message: "Contenido publicado exitosamente", fecha: today });
    } else {
      throw new Error(await response.text());
    }

  } catch (error) {
    console.error("Falla crítica publicando contenido:", error);
    return res.status(500).json({ error: error.message });
  }
}
