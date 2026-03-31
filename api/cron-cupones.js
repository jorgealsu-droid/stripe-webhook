import db from './firebase.js';

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const CHANNEL_ID = "-1003524006612"; 
const VIGENCIA_DIAS = 30; // Ajusta esto si tus cupones duran diferente

// Función auxiliar para pausas activas (Evita bloqueos de Telegram)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendTelegramMsg(chatId, text) {
  try {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch (err) {
    console.error(`Fallo de red a Telegram (${chatId}):`, err.message);
  }
}

export default async function handler(req, res) {
  // 1. VALIDACIÓN DE SEGURIDAD CRÍTICA
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Acceso no autorizado' });
  }

  try {
    console.log("Iniciando barrido de cupones caducados...");
    
    // 2. Extracción de usuarios en riesgo (Solo los que tienen cupón)
    const snapshot = await db.collection('users').where('status', '==', 'premium_coupon').get();
    
    if (snapshot.empty) {
      return res.status(200).json({ message: "No hay usuarios con cupón activo actualmente." });
    }

    const now = new Date();
    let procesados = 0;
    let revocados = 0;

    // 3. Procesamiento SECUENCIAL (Uso de for...of en lugar de forEach/Promise.all)
    for (const doc of snapshot.docs) {
      procesados++;
      const data = doc.data();
      
      if (!data.updatedAt) continue;

      const fechaIngreso = new Date(data.updatedAt);
      const diferenciaMs = now - fechaIngreso;
      const diasTranscurridos = diferenciaMs / (1000 * 60 * 60 * 24);

      if (diasTranscurridos >= VIGENCIA_DIAS) {
        const telegramId = doc.id;
        
        // A. Actualizar BD
        await doc.ref.set({ status: "revoked", reason: "coupon_expired" }, { merge: true });
        
        // B. Expulsar del canal
        await fetch(`${TELEGRAM_API}/banChatMember`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: CHANNEL_ID, user_id: telegramId }),
        });
        
        // C. Levantar el veto para permitir reingreso futuro
        await delay(500); // Pausa de medio segundo por seguridad de API
        await fetch(`${TELEGRAM_API}/unbanChatMember`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: CHANNEL_ID, user_id: telegramId, only_if_banned: true }),
        });

        // D. Mensaje de Upsell (Conversión a pago)
        const upsellMessage = `⚠️ <b>Tu periodo de cortesía ha terminado.</b>\n\nEsperamos que hayas disfrutado de las reflexiones diarias durante este mes. Tu acceso al canal ha sido revocado, pero puedes regresar hoy mismo.\n\nPara no perderte el contenido de mañana y apoyar este espacio, suscríbete oficialmente enviando el comando /start o tocando este enlace: \n\n👉 https://t.me/${process.env.TELEGRAM_BOT_USERNAME}`;
        
        await sendTelegramMsg(telegramId, upsellMessage);
        
        revocados++;
        await delay(1000); // Pausa de 1 segundo entre usuarios para evitar Rate Limits
      }
    }

    console.log(`Barrido finalizado. Evaluados: ${procesados}. Revocados: ${revocados}.`);
    return res.status(200).json({ status: "success", procesados, revocados });

  } catch (error) {
    console.error("Error crítico en Cron Job:", error);
    return res.status(500).json({ error: "Fallo interno en el barrido de cupones" });
  }
}
