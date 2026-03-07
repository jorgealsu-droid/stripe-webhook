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

      // BLOQUE 1: CUPÓN
      if (data === "enter_coupon") {
        await db.collection('users').doc(telegramId).update({
          state: "awaiting_coupon"
        });
        
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

      // BLOQUE 2: RECUPERAR ACCESO (Independiente del anterior)
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

      // CERRAR ANIMACIÓN DEL BOTÓN
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
    
    // Extraemos el texto crudo para el cupón (case sensitive) y la versión en minúsculas para comandos
    const rawText = update.message.text.trim();
    const textLower = rawText.toLowerCase();
    const isStart = ["/start", "hola", "start"].includes(textLower);

    async function sendMessage(msgText, replyMarkup = null) {
      const body = { chat_id: chatId, text: msgText, parse_mode: "HTML" };
      if (replyMarkup) body.reply_markup = replyMarkup;
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    // Leer al usuario
    const userRef = db.collection('users').doc(telegramId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      await userRef.set({
        telegramId,
        firstName,
        username: update.message.from.username || "",
        status: "new",
        state: "normal", // Estado por defecto
        lastInteraction: new Date().toISOString(),
      });
    }

    const userData = userDoc.exists ? userDoc.data() : { state: "normal" };

    // --- 3. MÁQUINA DE ESTADOS: ¿Está esperando un cupón? ---
    if (userData.state === "awaiting_coupon") {
      
      // ESCOTILLA DE ESCAPE: Si el usuario pone /start, abortamos el cupón
      if (isStart) {
        await userRef.update({ state: "normal" });
        // No hacemos return para que fluya hacia el menú principal de abajo
      } else {
        // PROCESAR EL CUPÓN
        const couponRef = db.collection('coupons').doc(rawText);
        const couponDoc = await couponRef.get();

        if (!couponDoc.exists || couponDoc.data().isActive !== true) {
          await sendMessage("❌ <b>Cupón inválido o ya utilizado.</b>\n\nVerifica que esté bien escrito o presiona /start para ver otras opciones.");
          await userRef.update({ state: "normal" }); // Lo sacamos del bucle
          return res.status(200).send("OK");
        }

        // Cupón válido: QUEMARLO
        await couponRef.update({
          isActive: false,
          usedBy: telegramId,
          usedAt: new Date().toISOString()
        });

        await userRef.update({
          status: "premium_coupon",
          state: "normal" // Limpiar estado
        });

        // Entregar el producto (Generar Link)
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
          // Falla de la API de Telegram
          await sendMessage("⚠️ Tu cupón es válido, pero hubo un error al generar la invitación. Contacta a soporte.");
          console.error("Error Telegram API:", linkData);
        }
        
        return res.status(200).send("OK");
      }
    }

    // --- 4. MENÚ PRINCIPAL Y FALLBACK ---
    if (isStart) {
      if (userData.state && userData.state !== "normal") {
        await userRef.update({ state: "normal" });
      }

      // LÓGICA DINÁMICA: Diferenciar clientes de usuarios nuevos
      if (userData.status === "premium" || userData.status === "premium_coupon") {
        const premiumKeyboard = {
          inline_keyboard: [
            [{ text: "🔑 Recuperar acceso al canal", callback_data: "recover_access" }]
          ]
        };
        await sendMessage(`¡Hola de nuevo, <b>${firstName}</b>! 🌿\n\nVeo que ya eres miembro. Si perdiste tu acceso al canal privado, genera una nueva invitación aquí:`, premiumKeyboard);
      } else {
// --- 4. MENÚ PRINCIPAL Y FALLBACK ---
if (isStart) {
  if (userData.state && userData.state !== "normal") {
    await userRef.update({ state: "normal" });
  }

  if (userData.status === "premium" || userData.status === "premium_coupon") {
    const premiumKeyboard = {
      inline_keyboard: [
        [{ text: "🔑 Recuperar acceso al canal", callback_data: "recover_access" }]
      ]
    };
    await sendMessage(`¡Hola de nuevo, <b>${firstName}</b>! 🌿\n\nVeo que ya eres miembro. Si perdiste tu acceso al canal privado, genera una nueva invitación aquí:`, premiumKeyboard);
  } else {
    // ESTA ES LA LÍNEA CRÍTICA QUE TE FALTA:
    const defaultKeyboard = {
      inline_keyboard: [
        [
          { 
            text: "💳 Acceso Premium", 
            url: `${process.env.BASE_URL}/api/create-checkout?telegram_id=${telegramId}` 
          }
        ],
        [{ text: "🎁 Acceso con cupón", callback_data: "enter_coupon" }]
      ],
    };
    await sendMessage(`¡Hola <b>${firstName}</b>! 🌿\n\nBienvenido. Elige cómo deseas acceder:`, defaultKeyboard);
  }
}
        await sendMessage(`¡Hola <b>${firstName}</b>! 🌿\n\nBienvenido. He registrado tu perfil. Elige cómo deseas acceder:`, defaultKeyboard);
      }
    } else {
      await sendMessage("🤔 No entiendo ese comando.\n\nSi intentas usar un cupón, presiona primero el botón de <b>Acceso con cupón</b> en el menú principal.\n\nPresiona /start para volver a ver las opciones.");
    }

    return res.status(200).send("OK");

  } catch (err) {
    // ESTE ES EL BLOQUE QUE BORRASTE. ES VITAL PARA QUE LA APLICACIÓN NO EXPLOTE.
    console.error("Error crítico en Telegram Webhook:", err);
    return res.status(200).send("OK");
  }
}
