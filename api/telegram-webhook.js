import db, { sendLog } from './firebase.js';

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("OK");

  try {
    const update = req.body;
    const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
    const PREMIUM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID_PREMIUM;
    const FREE_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID_FREE;

    // --- 1. MANEJAR CLICS EN BOTONES (CALLBACK QUERIES) ---
    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const chatId = callbackQuery.message.chat.id;
      const telegramId = String(callbackQuery.from.id);
      const data = callbackQuery.data;
      const firstName = callbackQuery.from.first_name || "Amigo";

      if (data === "free_access") {
        await db.collection('users').doc(telegramId).update({ status: "free", state: "normal" });
        const linkResponse = await fetch(`${TELEGRAM_API}/createChatInviteLink`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: FREE_CHANNEL_ID, member_limit: 1, name: `Gratis: ${telegramId}` }),
        });
        const linkData = await linkResponse.json();
        if (linkData.ok) {
          await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: `✅ <b>Acceso concedido</b>\n\nÚnete al canal gratuito:\n\n${linkData.result.invite_link}`, parse_mode: "HTML" }),
          });
        } else {
          await sendLog(`⚠️ <b>ERROR INVITE LINK [Gratis]:</b> ${linkData.description}`);
        }
      }

      if (data === "enter_coupon") {
        await db.collection('users').doc(telegramId).update({ state: "awaiting_coupon" });
        await fetch(`${TELEGRAM_API}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: "🎟️ <b>Ingresa tu cupón:</b>\n\n(Respeta mayúsculas y minúsculas)", parse_mode: "HTML" }),
        });
      }

      if (data === "recover_access") {
        const userDoc = await db.collection('users').doc(telegramId).get();
        const userData = userDoc.exists ? userDoc.data() : null;
        let targetChannel = (userData?.status === "premium" || userData?.status === "premium_coupon") ? PREMIUM_CHANNEL_ID : (userData?.status === "free" ? FREE_CHANNEL_ID : null);

        if (!targetChannel) {
          await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: "❌ <b>No tienes un acceso activo para recuperar.</b>", parse_mode: "HTML" }),
          });
        } else {
          const linkResponse = await fetch(`${TELEGRAM_API}/createChatInviteLink`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: targetChannel, member_limit: 1, name: `Recuperación: ${telegramId}` }),
          });
          const linkData = await linkResponse.json();
          if (linkData.ok) {
            await fetch(`${TELEGRAM_API}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: chatId, text: `🔄 <b>Acceso recuperado</b>\n\nAquí tienes tu link:\n\n${linkData.result.invite_link}`, parse_mode: "HTML" }),
            });
          } else {
            await sendLog(`⚠️ <b>ERROR RECOVERY LINK:</b> ${linkData.description}`);
          }
        }
      }

      if (data === "main_menu") {
        await db.collection('users').doc(telegramId).update({ state: "normal" });
        const defaultKeyboard = {
          inline_keyboard: [
            [{ text: "💳 Acceso Premium", url: `${process.env.BASE_URL}/api/create-checkout?telegram_id=${telegramId}` }],
            [{ text: "🎁 Acceso con cupón", callback_data: "enter_coupon" }],
            [{ text: "🟢 Acceso Gratuito", callback_data: "free_access" }]
          ],
        };
        await fetch(`${TELEGRAM_API}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: `¡Hola <b>${firstName}</b>! 🌿\n\nBienvenido de nuevo al menú principal:`, parse_mode: "HTML", reply_markup: defaultKeyboard }),
        });
      }

      await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: callbackQuery.id }),
      });
      return res.status(200).send("OK");
    }

    // --- 2. MANEJAR MENSAJES DE TEXTO ---
    if (!update.message || !update.message.text) return res.status(200).send("OK");

    const chatId = update.message.chat.id;
    const telegramId = String(update.message.from.id);
    const firstName = update.message.from.first_name || "Amigo";
    const rawText = update.message.text.trim();
    const textLower = rawText.toLowerCase();

    const userRef = db.collection('users').doc(telegramId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      await userRef.set({ telegramId, firstName, username: update.message.from.username || "", status: "new", state: "normal", lastInteraction: new Date().toISOString() });
    }
    const userData = userDoc.exists ? userDoc.data() : { status: "new", state: "normal" };

    // RETORNO DESDE STRIPE (Éxito)
    if (textLower === "/start success_stripe") {
      if (userData.status === "premium" || userData.status === "premium_coupon") {
        return res.status(200).send("OK");
      } else {
        await fetch(`${TELEGRAM_API}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: "⏳ <b>Verificando tu pago...</b>\n\nEstamos confirmando la transacción. Recibirás tu link en unos segundos.", parse_mode: "HTML" }),
        });
        return res.status(200).send("OK");
      }
    }

    // MÁQUINA DE ESTADOS: CUPONES
    if (userData.state === "awaiting_coupon") {
      if (textLower.startsWith("/start")) {
        await userRef.update({ state: "normal" });
      } else {
        const couponRef = db.collection('coupons').doc(rawText);
        const couponDoc = await couponRef.get();

        if (!couponDoc.exists || couponDoc.data().isActive !== true) {
          await sendLog(`🎟️ <b>INTENTO FALLIDO CUPÓN:</b> El usuario ${firstName} intentó usar: <code>${rawText}</code>`);
          await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: "❌ <b>Cupón inválido.</b>", parse_mode: "HTML" }),
          });
          await userRef.update({ state: "normal" });
          return res.status(200).send("OK");
        }

        await couponRef.update({ isActive: false, usedBy: telegramId, usedAt: new Date().toISOString() });
        await userRef.update({ status: "premium_coupon", state: "normal" });

        const linkResponse = await fetch(`${TELEGRAM_API}/createChatInviteLink`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: PREMIUM_CHANNEL_ID, member_limit: 1, name: `Cupón: ${rawText}` }),
        });
        const linkData = await linkResponse.json();
        if (linkData.ok) {
          await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: `✅ <b>¡Canjeado!</b> Aquí tienes tu link:\n\n${linkData.result.invite_link}`, parse_mode: "HTML" }),
          });
          await sendLog(`✅ <b>CUPÓN EXITOSO:</b> ${rawText} usado por ${firstName}`);
        }
        return res.status(200).send("OK");
      }
    }

    // MENÚS PRINCIPALES
    if (textLower.startsWith("/start")) {
      // Caso: Error de Pago previo
      if (userData.state === "payment_failed") {
        await userRef.update({ state: "normal" });
        const retryKeyboard = {
          inline_keyboard: [
            [{ text: "💳 Reintentar pago", url: `${process.env.BASE_URL}/api/create-checkout?telegram_id=${telegramId}` }],
            [{ text: "Volver al menú principal", callback_data: "main_menu" }]
          ]
        };
        await fetch(`${TELEGRAM_API}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: `⚠️ <b>Pago declinado, ${firstName}.</b>\n\n¿Deseas intentar con otra tarjeta?`, parse_mode: "HTML", reply_markup: retryKeyboard }),
        });
        return res.status(200).send("OK");
      }

      let keyboard;
      let text = `¡Hola <b>${firstName}</b>! 🌿\n\nBienvenido. Elige tu acceso:`;
      
      if (userData.status === "premium" || userData.status === "premium_coupon") {
        keyboard = { inline_keyboard: [[{ text: "🔑 Recuperar acceso Premium", callback_data: "recover_access" }], [{ text: "💳 Gestionar suscripción", url: "https://billing.stripe.com/..." }]] };
      } else if (userData.status === "free") {
        keyboard = { inline_keyboard: [[{ text: "💳 Upgrade a Premium", url: `${process.env.BASE_URL}/api/create-checkout?telegram_id=${telegramId}` }], [{ text: "🎁 Canjear cupón", callback_data: "enter_coupon" }], [{ text: "🔄 Recuperar acceso Gratis", callback_data: "recover_access" }]] };
        text = `¡Hola de nuevo, <b>${firstName}</b>! 🌿\n\nEstás en el plan gratuito. ¿Deseas subir al contenido Premium?`;
      } else {
        keyboard = { inline_keyboard: [[{ text: "💳 Acceso Premium", url: `${process.env.BASE_URL}/api/create-checkout?telegram_id=${telegramId}` }], [{ text: "🎁 Acceso con cupón", callback_data: "enter_coupon" }], [{ text: "🟢 Acceso Gratuito", callback_data: "free_access" }]] };
      }

      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "HTML", reply_markup: keyboard }),
      });
    }

    return res.status(200).send("OK");
  } catch (err) {
    await sendLog(`🚨 <b>ERROR CRÍTICO WEBHOOK:</b>\n${err.message}`);
    return res.status(200).send("OK");
  }
}