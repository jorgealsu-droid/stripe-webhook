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
        // Inyectamos el estado en la base de datos
        await db.collection('users').doc(telegramId).update({
          state: "awaiting_coupon"
        });
        
      if (data === "recover_access") {
        // 1. VERIFICACIÓN DE SEGURIDAD CRÍTICA (No confíes en el botón)
        const userDoc = await db.collection('users').doc(telegramId).get();
        const userData = userDoc.exists ? userDoc.data() : null;

        if (!userData || (userData.status !== "premium" && userData.status !== "premium_coupon")) {
          // El usuario intentó usar un botón viejo o su suscripción fue revocada
          await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: "❌ <b>Acceso denegado.</b>\n\nNo tienes una suscripción activa en nuestra base de datos. Si crees que es un error, contacta a soporte o usa el menú principal con /start.",
              parse_mode: "HTML"
            }),
          });
        } else {
          // 2. Generar un NUEVO enlace de UN SOLO USO
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
                text: `🔄 <b>Acceso recuperado</b>\n\nAquí tienes tu nuevo enlace único para unirte al canal privado. Úsalo de inmediato (no lo compartas):\n\n${linkData.result.invite_link}`,
                parse_mode: "HTML"
              }),
            });
          } else {
            console.error("Error Telegram API al recuperar:", linkData);
            await fetch(`${TELEGRAM_API}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chatId,
                text: "⚠️ <b>Error técnico.</b>\n\nEres usuario Premium, pero hubo un fallo al generar tu invitación. Por favor, inténtalo más tarde."
              }),
            });
          }
        }
      }
        

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

      // Cerrar la animación de carga del botón en Telegram
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
      // Limpiar estado por si se quedó atascado por algún error anterior
      if (userData.state && userData.state !== "normal") {
        await userRef.update({ state: "normal" });
      }

      const keyboard = {
        inline_keyboard: [
          // Asegúrate de tener BASE_URL configurado en Vercel
          [{ text: "💳 Acceso Premium", url: `${process.env.BASE_URL}/api/create-checkout?telegram_id=${telegramId}` }],
          [{ text: "🎁 Acceso con cupón", callback_data: "enter_coupon" }]
        ],
      };

      await sendMessage(`¡Hola <b>${firstName}</b>! 🌿\n\nBienvenido. He registrado tu perfil. Elige cómo deseas acceder:`, keyboard);
    } else {
      // FALLBACK: Si el usuario escribe texto aleatorio sin estar en un proceso
      await sendMessage("🤔 No entiendo ese comando.\n\nSi intentas usar un cupón, presiona primero el botón de <b>Acceso con cupón</b> en el menú principal.\n\nPresiona /start para volver a ver las opciones.");
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error("Error crítico en Telegram Webhook:", err);
    return res.status(200).send("OK");
  }
}
