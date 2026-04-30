import db from './firebase.js';

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("OK");

  try {
    const update = req.body;
    const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
    
    // Extraemos los IDs desde las variables de entorno para mayor escalabilidad
    const PREMIUM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID_PREMIUM;
    const FREE_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID_FREE;

    // --- 1. MANEJAR CLICS EN BOTONES (CALLBACK QUERIES) ---
    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const chatId = callbackQuery.message.chat.id;
      const telegramId = String(callbackQuery.from.id);
      const data = callbackQuery.data;
      const firstName = callbackQuery.from.first_name || "Amigo";

      // NUEVO: Lógica para acceso gratuito
      if (data === "free_access") {
        await db.collection('users').doc(telegramId).update({ 
          status: "free",
          state: "normal" 
        });

        const linkResponse = await fetch(`${TELEGRAM_API}/createChatInviteLink`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: FREE_CHANNEL_ID,
            member_limit: 1,
            name: `Gratuito: ${telegramId}`
          }),
        });
        
        const linkData = await linkResponse.json();

        if (linkData.ok) {
          await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: `✅ <b>Acceso concedido</b>\n\nÚnete al canal público usando este enlace:\n\n${linkData.result.invite_link}`,
              parse_mode: "HTML"
            }),
          });
        } else {
          await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: "⚠️ <b>Error técnico.</b>\n\nHubo un fallo al generar tu invitación al canal gratuito. Intenta de nuevo usando /start"
            }),
          });
        }
      }

      if (data === "enter_coupon") {
        await db.collection('users').doc(telegramId).update({ state: "awaiting_coupon" });
        await fetch(`${TELEGRAM_API}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: "🎟️ <b>Ingresa tu código de cupón:</b>\n\n(Respeta estrictamente las mayúsculas y minúsculas)",
            parse_mode: "HTML"
          }),
        });
      }

      if (data === "recover_access") {
        const userDoc = await db.collection('users').doc(telegramId).get();
        const userData = userDoc.exists ? userDoc.data() : null;

        // Evaluamos a qué canal tiene derecho el usuario
        let targetChannel = null;
        if (userData && (userData.status === "premium" || userData.status === "premium_coupon")) {
          targetChannel = PREMIUM_CHANNEL_ID;
        } else if (userData && userData.status === "free") {
          targetChannel = FREE_CHANNEL_ID;
        }

        if (!targetChannel) {
          await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: "❌ <b>Acceso denegado.</b>\n\nNo tienes una suscripción ni registro activo.",
              parse_mode: "HTML"
            }),
          });
        } else {
          const linkResponse = await fetch(`${TELEGRAM_API}/createChatInviteLink`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: targetChannel,
              member_limit: 1,
              name: `Recuperación: ${telegramId}`
            }),
          });
          
          const linkData = await linkResponse.json();

          if (linkData.ok) {
            await fetch(`${TELEGRAM_API}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chatId,
                text: `🔄 <b>Acceso recuperado</b>\n\nAquí tienes tu nuevo enlace único:\n\n${linkData.result.invite_link}`,
                parse_mode: "HTML"
              }),
            });
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
          body: JSON.stringify({
            chat_id: chatId,
            text: `¡Hola <b>${firstName}</b>! 🌿\n\nBienvenido. Elige cómo deseas acceder:`,
            parse_mode: "HTML",
            reply_markup: defaultKeyboard
          }),
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

    const isStart = textLower.startsWith("/start") || textLower === "hola" || textLower === "start";

    async function sendMessage(msgText, replyMarkup = null) {
      const body = { chat_id: chatId, text: msgText, parse_mode: "HTML" };
      if (replyMarkup) body.reply_markup = replyMarkup;
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    const userRef = db.collection('users').doc(telegramId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      await userRef.set({
        telegramId,
        firstName,
        username: update.message.from.username || "",
        status: "new",
        state: "normal",
        lastInteraction: new Date().toISOString(),
      });
    }

    const userData = userDoc.exists ? userDoc.data() : { status: "new", state: "normal" };

    if (textLower === "/start success_stripe") {
      if (userData.status === "premium" || userData.status === "premium_coupon") {
        return res.status(200).send("OK");
      } else {
        await sendMessage("⏳ <b>Verificando tu pago...</b>\n\nEstamos confirmando la transacción con el procesador. En unos segundos recibirás tu enlace de acceso aquí mismo.");
        return res.status(200).send("OK");
      }
    }

    // --- 3. MÁQUINA DE ESTADOS: ¿Está esperando un cupón? ---
    if (userData.state === "awaiting_coupon") {
      if (isStart) {
        await userRef.update({ state: "normal" });
      } else {
        const couponRef = db.collection('coupons').doc(rawText);
        const couponDoc = await couponRef.get();

        if (!couponDoc.exists || couponDoc.data().isActive !== true) {
          await sendMessage("❌ <b>Cupón inválido o ya utilizado.</b>\n\nVerifica que esté bien escrito o presiona /start para ver otras opciones.");
          await userRef.update({ state: "normal" }); 
          return res.status(200).send("OK");
        }

        await couponRef.update({
          isActive: false,
          usedBy: telegramId,
          usedAt: new Date().toISOString()
        });

        await userRef.update({
          status: "premium_coupon",
          state: "normal" 
        });

        const linkResponse = await fetch(`${TELEGRAM_API}/createChatInviteLink`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: PREMIUM_CHANNEL_ID,
            member_limit: 1,
            name: `Cupón: ${rawText}`
          }),
        });
        
        const linkData = await linkResponse.json();

        if (linkData.ok) {
          await sendMessage(`✅ <b>¡Cupón canjeado con éxito!</b>\n\nÚnete al canal privado usando este enlace único:\n\n${linkData.result.invite_link}`);
        } else {
          await sendMessage("⚠️ Tu cupón es válido, pero hubo un error al generar la invitación. Contacta a soporte.");
        }
        
        return res.status(200).send("OK");
      }
    }

    // --- 4. MENÚ PRINCIPAL Y FALLBACK ---
    if (isStart) {
      if (userData.state === "payment_failed") {
        await userRef.update({ state: "normal" }); 
        
        const retryKeyboard = {
          inline_keyboard: [
            [{ text: "💳 Reintentar pago", url: `${process.env.BASE_URL}/api/create-checkout?telegram_id=${telegramId}` }],
            [{ text: "Volver al menú principal", callback_data: "main_menu" }] 
          ]
        };
        await sendMessage(`⚠️ <b>Hubo un problema con tu tarjeta, ${firstName}.</b>\n\nNotamos que tu último intento de pago fue declinado por el banco. ¿Deseas intentar con otro método de pago para asegurar tu acceso?`, retryKeyboard);
        return res.status(200).send("OK");
      }

      if (userData.state && userData.state !== "normal") {
        await userRef.update({ state: "normal" });
      }

      if (userData.status === "premium" || userData.status === "premium_coupon" || userData.status === "free") {
        const premiumKeyboard = {
          inline_keyboard: [
            [{ text: "🔑 Recuperar acceso al canal", callback_data: "recover_access" }]
          ]
        };
        await sendMessage(`¡Hola de nuevo, <b>${firstName}</b>! 🌿\n\nTu suscripción está activa. Si necesitas entrar al canal de nuevo, genera una invitación aquí:`, premiumKeyboard);
      } else {
        const defaultKeyboard = {
          inline_keyboard: [
            [{ text: "💳 Acceso Premium", url: `${process.env.BASE_URL}/api/create-checkout?telegram_id=${telegramId}` }],
            [{ text: "🎁 Acceso con cupón", callback_data: "enter_coupon" }],
            [{ text: "🟢 Acceso Gratuito", callback_data: "free_access" }]
          ],
        };
        await sendMessage(`¡Hola <b>${firstName}</b>! 🌿\n\nBienvenido. Elige cómo deseas acceder:`, defaultKeyboard);
      }
    } else {
      await sendMessage("🤔 No entiendo ese comando.\n\nSi intentas usar un cupón, presiona primero el botón de <b>Acceso con cupón</b> en el menú principal.\n\nPresiona /start para volver a ver las opciones.");
    }

    return res.status(200).send("OK");

  } catch (err) {
    console.error("Error crítico en Telegram Webhook:", err);
    return res.status(200).send("OK");
  }
}