import fetch from "node-fetch";
import { google } from "googleapis";

/**
 * ===============================
 * CONFIGURACIÓN
 * ===============================
 */
const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth });

/**
 * ===============================
 * UTILIDADES
 * ===============================
 */

// Normaliza texto (para detectar hola, start, etc.)
function normalizeText(text = "") {
  return text.toLowerCase().trim();
}

// Envía mensaje a Telegram
async function sendTelegramMessage(chatId, text, replyMarkup = null) {
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  };

  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }

  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * ===============================
 * GOOGLE SHEETS
 * ===============================
 */

// Busca usuario por telegram_id
async function findUserRow(telegramId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "users!A:A",
  });

  const rows = res.data.values || [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === String(telegramId)) {
      return i + 1; // fila real (1-indexed)
    }
  }
  return null;
}

// Crea nuevo usuario
async function createUser({ telegramId, username, firstName }) {
  const now = new Date().toISOString();

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "users!A:J",
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        telegramId,
        username || "",
        firstName || "",
        "new",          // status
        now,            // created_at
        "",             // stripe_customer_id
        "",             // stripe_subscription_id
        "",             // last_stripe_event_id
        "",             // updated_at
        ""              // payment_date
      ]],
    },
  });
}

/**
 * ===============================
 * HANDLER PRINCIPAL
 * ===============================
 */
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(200).send("OK");
    }

    const update = req.body;

    if (!update.message) {
      return res.status(200).send("No message");
    }

    const message = update.message;
    const chatId = message.chat.id;
    const telegramId = message.from.id;
    const username = message.from.username;
    const firstName = message.from.first_name;
    const text = normalizeText(message.text);

    // Detectamos inicio
    const isStart =
      text === "/start" ||
      text === "start" ||
      text === "hola" ||
      text === "iniciar";

    if (!isStart) {
      await sendTelegramMessage(
        chatId,
        "Escribe <b>hola</b> o <b>/start</b> para comenzar 😊"
      );
      return res.status(200).send("OK");
    }

    // Google Sheets: buscar o crear
    const existingRow = await findUserRow(telegramId);

    if (!existingRow) {
      await createUser({
        telegramId,
        username,
        firstName,
      });
    }

    // Botones
    const keyboard = {
      inline_keyboard: [
        [{ text: "💳 Acceso Completo", callback_data: "access_paid" }],
        [{ text: "🆓 Versión Gratuita", callback_data: "access_free" }],
        [{ text: "🎁 Tengo invitación a Versión Completa", callback_data: "access_gifted" }],
      ],
    };

    // Mensaje bienvenida
    const welcomeText = `
Hola <b>${firstName}</b> 👋  

Bienvenido a <b>Reflexión consciente</b> 🌱  

Elige cómo deseas acceder:
`;

    await sendTelegramMessage(chatId, welcomeText, keyboard);

    return res.status(200).send("OK");
  } catch (error) {
    console.error("Telegram webhook error:", error);
    return res.status(200).send("Error handled");
  }
}
