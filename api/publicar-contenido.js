import db from './firebase.js';

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const CHANNEL_ID = "-1003524006612"; 

export default async function handler(req, res) {
  // Validación de seguridad (Misma llave que el cron de cupones)
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    // Obtener fecha actual en formato YYYY-MM-DD
    const today = new Date().toISOString().split('T')[0]; 
    
    // Buscar el contenido del día usando la fecha como ID de documento
    const contentDoc = await db.collection('content').doc(today).get();

    if (!contentDoc.exists) {
      console.error(`No hay contenido programado para hoy: ${today}`);
      return res.status(404).json({ message: "Contenido no encontrado" });
    }

    const content = contentDoc.data();

    // Evitar duplicados (Falla de seguridad lógica)
    if (content.sent) {
      return res.status(200).json({ message: "El contenido de hoy ya fue enviado previamente." });
    }

    // Enviar a Telegram
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
      // Marcar como enviado en la base de datos
      await contentDoc.ref.update({ sent: true, sentAt: new Date().toISOString() });
      return res.status(200).json({ status: "success", message: "Contenido publicado" });
    } else {
      throw new Error(await response.text());
    }

  } catch (error) {
    console.error("Error publicando contenido:", error);
    return res.status(500).json({ error: error.message });
  }
}
