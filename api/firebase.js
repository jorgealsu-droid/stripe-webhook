import admin from 'firebase-admin';

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
  } catch (error) {
    console.error('Error al conectar con Firebase:', error);
  }
}

const db = admin.firestore();
export default db;

/**
 * Envía alertas críticas al canal de logs en Telegram.
 * @param {string} message - El mensaje de error detallado.
 */
export async function sendLog(message) {
  const LOG_CHANNEL = process.env.TELEGRAM_LOGS_CHANNEL_ID;
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const PROJECT = process.env.PROJECT_NAME || "PROYECTO_DESCONOCIDO";
  
  if (!LOG_CHANNEL || !BOT_TOKEN) return;

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: LOG_CHANNEL,
        text: `🛡️ <b>SISTEMA DE LOGS [${PROJECT}]</b>\n\n${message}`,
        parse_mode: "HTML"
      }),
    });
  } catch (e) {
    console.error("Error enviando log a Telegram:", e);
  }
}