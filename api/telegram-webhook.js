import db from './firebase';

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("OK");

  try {
    const update = req.body;
    if (!update?.message) return res.status(200).send("OK");

    const chatId = update.message.chat.id;
    const telegramId = String(update.message.from.id);
    const firstName = update.message.from.first_name || "Amigo";
    const text = (update.message.text || "").toLowerCase().trim();

    const isStart = ["/start", "hola", "start"].includes(text);
    const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

    // 1. Guardar o actualizar usuario en Firestore
    const userRef = db.collection('users').doc(telegramId);
    await userRef.set({
      telegramId,
      firstName,
      username: update.message.from.username || "",
      lastInteraction: new Date().toISOString(),
    }, { merge: true });

    if (isStart) {
      const keyboard = {
        inline_keyboard: [
          [{ text: "💳 Acceso Premium", url: `https://${process.env.VERCEL_URL}/api/create-checkout?telegram_id=${telegramId}` }],
          [{ text: "🆓 Saber más", callback_data: "info" }]
        ],
      };

      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: `¡Hola <b>${firstName}</b>! 🌿\n\nBienvenido. He registrado tu acceso. ¿Cómo quieres continuar?`,
          parse_mode: "HTML",
          reply_markup: keyboard
        }),
      });
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error("Error Telegram:", err);
    return res.status(200).send("ERROR");
  }
}
