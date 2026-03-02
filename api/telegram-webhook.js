import { google } from "googleapis";

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(200).send("OK");
    }

    const update = req.body;
    if (!update?.message) {
      return res.status(200).send("NO_MESSAGE");
    }

    const message = update.message;
    const chatId = message.chat.id;
    const telegramId = message.from.id;
    const firstName = message.from.first_name || "";
    const text = (message.text || "").toLowerCase().trim();

    const isStart =
      text === "/start" ||
      text === "hola" ||
      text === "start" ||
      text === "iniciar";

    const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

    async function sendMessage(text, replyMarkup = null) {
      const body = {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      };
      if (replyMarkup) body.reply_markup = replyMarkup;

      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    if (!isStart) {
      await sendMessage("Escribe <b>hola</b> o <b>/start</b> para comenzar 😊");
      return res.status(200).send("OK");
    }

    // 🔐 Google Sheets auth (AQUÍ, no arriba)
    if (!process.env.GOOGLE_PRIVATE_KEY) {
  throw new Error("GOOGLE_PRIVATE_KEY is missing");
}

const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  ["https://www.googleapis.com/auth/spreadsheets"]
);

    const sheets = google.sheets({ version: "v4", auth });
    const SHEET_ID = process.env.GOOGLE_SHEET_ID;

    // Buscar usuario
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "users!A:A",
    });

    const rows = existing.data.values || [];
    const exists = rows.some(r => r[0] === String(telegramId));

    if (!exists) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: "users!A:J",
        valueInputOption: "RAW",
        requestBody: {
          values: [[
            telegramId,
            message.from.username || "",
            firstName,
            "new",
            new Date().toISOString(),
            "",
            "",
            "",
            "",
            ""
          ]]
        }
      });
    }

    const keyboard = {
      inline_keyboard: [
        [{ text: "💳 Acceso Completo", callback_data: "access_paid" }],
        [{ text: "🆓 Versión Gratuita", callback_data: "access_free" }],
        [{ text: "🎁 Tengo invitación a Versión Completa", callback_data: "access_gifted" }],
      ],
    };

    await sendMessage(
      `Hola <b>${firstName}</b> 👋\n\nBienvenido a <b>Reflexión consciente</b> 🌱\n\nElige cómo deseas acceder:`,
      keyboard
    );

    return res.status(200).send("OK");
  } catch (err) {
    console.error("Telegram webhook error:", err);
    return res.status(200).send("ERROR_HANDLED");
  }
}
