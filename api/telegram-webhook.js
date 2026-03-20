import db from './firebase.js';

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("OK");

  try {
    const update = req.body;
    const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
    const CHANNEL_ID = "-1003524006612";

    // --- 1. MANEJAR CLICS EN BOTONES (CALLBACK QUERIES) ---
    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const chatId = callbackQuery.message.chat.id;
      const telegramId = String(callbackQuery.from.id);
      const data = callbackQuery.data;

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

        if (!userData || (userData.status !== "premium" && userData.status !== "premium_coupon")) {
          await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: "❌ <b>Acceso denegado.</b>\n\nNo tienes una suscripción activa.",
              parse_mode: "HTML"
            }),
          });
        } else {
          const linkResponse = await fetch(`${TELEGRAM_API}/createChatInviteLink`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: CHANNEL_ID,
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
          } else {
            await fetch(`${TELEGRAM_API}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chatId,
                text: "⚠️ <b>Error técnico.</b>\n\nHubo un fallo al generar tu invitación."
              }),
            });
          }
        }
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

    // --- LECTURA DE BASE DE DATOS (Movida hacia arriba) ---
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

    // --- INTERCEPTOR DE REDIRECCIÓN INTELIGENTE ---
    if (textLower === "/start success_stripe") {
      if (userData.status === "premium" || userData.status === "premium_coupon") {
        // El webhook fue más rápido que el cliente. Silenciamos la respuesta.
        return res.status(200).send("OK");
      } else {
        // El cliente fue más rápido. Damos feedback de procesamiento.
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
            chat_id: CHANNEL_ID,
            member_limit: 1,
            name: `Cupón: ${rawText}`
          }),
        });
        
        const linkData = await linkResponse.json();

        if (linkData.ok) {
          await sendMessage(`✅ <b>¡Cupón canjeado con éxito!</b>\n\nÚnete al canal privado usando este enlace único (solo funcionará una vez):\n\n${linkData.result.invite_link}`);
        } else {
          await sendMessage("⚠️ Tu cupón es válido, pero hubo un error al generar la invitación. Contacta a soporte.");
          console.error("Error Telegram API:", linkData);
        }
        
        return res.status(200).send("OK");
      }
    }

// --- 4. MENÚ PRINCIPAL Y FALLBACK ---
    if (isStart) {
      // Si el usuario viene de un pago fallido, le damos un tratamiento específico de retención
      if (userData.state === "payment_failed") {
        await userRef.update({ state: "normal" }); // Limpiamos para no ciclarlo
        
        const retryKeyboard = {
          inline_keyboard: [
            [{ text: "💳 Reintentar pago con otra tarjeta", url: `${process.env.BASE_URL}/api/create-checkout?telegram_id=${telegramId}` }],
            [{ text: "Volver al menú principal", callback_data: "main_menu" }] // Necesitarás atrapar este callback
          ]
        };
        await sendMessage(`⚠️ <b>Hubo un problema con tu tarjeta, ${firstName}.</b>\n\nNotamos que tu último intento de pago fue declinado por el banco. ¿Deseas intentar con otro método de pago para asegurar tu acceso?`, retryKeyboard);
        return res.status(200).send("OK");
      }

      // Si tenía otro estado (ej. esperando cupón y se arrepintió), lo limpiamos
      if (userData.state && userData.state !== "normal") {
        await userRef.update({ state: "normal" });
      }

      if (userData.status === "premium" || userData.status === "premium_coupon") {
        const premiumKeyboard = {
          inline_keyboard: [
            [{ text: "🔑 Recuperar acceso al canal", callback_data: "recover_access" }]
          ]
        };
        await sendMessage(`¡Hola de nuevo, <b>${firstName}</b>! 🌿\n\nTu suscripción está activa. Si necesitas entrar al canal privado de nuevo, genera una invitación aquí:`, premiumKeyboard);
      } else {
        const defaultKeyboard = {
          inline_keyboard: [
            [{ text: "💳 Acceso Premium", url: `${process.env.BASE_URL}/api/create-checkout?telegram_id=${telegramId}` }],
            [{ text: "🎁 Acceso con cupón", callback_data: "enter_coupon" }]
          ],
        };
        await sendMessage(`¡Hola <b>${firstName}</b>! 🌿\n\nBienvenido. Elige cómo deseas acceder:`, defaultKeyboard);
      }
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
