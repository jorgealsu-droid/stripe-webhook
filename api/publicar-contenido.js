import admin from 'firebase-admin';
import db, { sendLog } from './firebase.js';

// Devuelve la fecha actual en zona America/Mexico_City como 'YYYY-MM-DD'.
// Usamos el locale 'en-CA' porque su formato corto coincide exactamente con YYYY-MM-DD.
function getMexicoCityDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// Envía a un canal con candado idempotente en content_deliveries/{deliveryId}.
// Devuelve { canal, status: 'enviado'|'omitido'|'error', detalle?, messageId? }.
async function publishToChannel({ canal, deliveryId, sendFn }) {
  const ref = db.collection('content_deliveries').doc(deliveryId);
  const STUCK_MS = 5 * 60 * 1000; // 5 minutos: ventana para considerar un envío "en curso" como zombi

  // Paso 1: intentar tomar el candado creando el doc.
  try {
    await ref.create({
      canal,
      status: 'sending',
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
      attemptCount: 1,
    });
  } catch (err) {
    if (err.code !== 6) {
      // Error real de Firestore (permisos, red). No es duplicado.
      return { canal, status: 'error', detalle: `lock create failed: ${err.message}` };
    }
    // Doc ya existe. Inspeccionar estado previo.
    const snap = await ref.get();
    const data = snap.data();
    if (data.status === 'sent') {
      return { canal, status: 'omitido', detalle: 'ya enviado previamente' };
    }
    if (data.status === 'sending') {
      const startedAtMs = data.startedAt?.toMillis?.() ?? 0;
      if (Date.now() - startedAtMs < STUCK_MS) {
        // Otra invocación está enviando justo ahora. No competir.
        return { canal, status: 'omitido', detalle: 'envío en curso por otra invocación' };
      }
      // Pasó la ventana → invocación previa zombi. Retomamos.
    }
    // status === 'failed' o 'sending' zombi → re-claim del candado.
    await ref.update({
      status: 'sending',
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
      attemptCount: admin.firestore.FieldValue.increment(1),
    });
  }

  // Paso 2: tenemos el candado. Intentar envío a Telegram.
  let telegramJson;
  try {
    const response = await sendFn();
    telegramJson = await response.json();
  } catch (err) {
    await ref.update({
      status: 'failed',
      lastError: err.message,
      failedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { canal, status: 'error', detalle: `network error: ${err.message}` };
  }

  if (!telegramJson.ok) {
    await ref.update({
      status: 'failed',
      lastError: telegramJson.description ?? 'unknown',
      failedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { canal, status: 'error', detalle: telegramJson.description };
  }

  // Paso 3: envío exitoso. Marcar como 'sent'.
  await ref.update({
    status: 'sent',
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
    telegramMessageId: telegramJson.result?.message_id ?? null,
  });
  return {
    canal,
    status: 'enviado',
    messageId: telegramJson.result?.message_id ?? null,
  };
}

export default async function handler(req, res) {
  // 1. Validación de seguridad del Cron Job
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
  const PREMIUM_CHANNEL = process.env.TELEGRAM_CHANNEL_ID_PREMIUM;
  const FREE_CHANNEL = process.env.TELEGRAM_CHANNEL_ID_FREE;

  // 2. Fecha de hoy en zona Mexico City (no UTC).
  const hoy = getMexicoCityDate();

  try {
    const doc = await db.collection('liturgical_content').doc(hoy).get();

    if (!doc.exists) {
      await sendLog(`❌ <b>ERROR DE CONTENIDO:</b> No existe el documento para la fecha ${hoy} en Firestore.`);
      return res.status(404).json({ error: "Contenido no encontrado", fecha: hoy });
    }

    const data = doc.data();
    const textoBase = `✝️ <b>${data.tiempo_liturgico}</b>\n\n${data.evangelio}`;

    // 3. Envío por canal, con candado independiente cada uno.
    const premiumResult = await publishToChannel({
      canal: 'premium',
      deliveryId: `${hoy}_premium`,
      sendFn: () => fetch(`${TELEGRAM_API}/sendAudio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: PREMIUM_CHANNEL,
          audio: data.audioUrl,
          caption: textoBase,
          parse_mode: "HTML",
        }),
      }),
    });

    const freeResult = await publishToChannel({
      canal: 'free',
      deliveryId: `${hoy}_free`,
      sendFn: () => fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: FREE_CHANNEL,
          text: textoBase,
          parse_mode: "HTML",
        }),
      }),
    });

    // 4. Solo alertamos errores reales (omitidos por idempotencia son comportamiento normal).
    if (premiumResult.status === 'error') {
      await sendLog(`⚠️ <b>FALLO DE ENVÍO [Premium]:</b> ${premiumResult.detalle}`);
    }
    if (freeResult.status === 'error') {
      await sendLog(`⚠️ <b>FALLO DE ENVÍO [Gratuito]:</b> ${freeResult.detalle}`);
    }

    return res.status(200).json({
      fecha: hoy,
      resultados: [premiumResult, freeResult],
    });

  } catch (error) {
    await sendLog(`🚨 <b>ERROR CRÍTICO EN CRON:</b>\n${error.message}`);
    return res.status(500).json({ error: error.message });
  }
}
