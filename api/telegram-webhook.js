export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const body = req.body;
  const message = body.message;

  if (!message || !message.text) {
    return res.status(200).json({ ok: true });
  }

  const text = message.text.toLowerCase().trim();
  const chatId = message.chat.id;

  const telegramId = message.from.id;
  const username = message.from.username || "";
  const firstName = message.from.first_name || "";

  // 1️⃣ detectar inicio
  const isStart =
    text === "/start" ||
    text === "start" ||
    text === "hola" ||
    text === "iniciar" ||
    text === "empezar";

  // 2️⃣ buscar o crear usuario en Sheets
  const user = await findOrCreateUser({
    telegramId,
    username,
    firstName,
  });

  // 3️⃣ lógica central
  let response;

  if (isStart) {
    response = welcomeMessage();
  } else {
    switch (user.status) {
      case "new":
        response = welcomeMessage();
        break;

      case "free":
        response = freeMessage();
        break;

      case "pending_payment":
        response = pendingPaymentMessage();
        break;

      case "paid":
        response = paidMessage();
        break;

      case "gifted_pending":
        response = giftedPendingMessage();
        break;

      case "gifted_active":
        response = paidMessage();
        break;

      default:
        response = welcomeMessage();
    }
  }

  // 4️⃣ enviar respuesta a Telegram
  await sendTelegramMessage(chatId, response);

  return res.status(200).json({ ok: true });
}
