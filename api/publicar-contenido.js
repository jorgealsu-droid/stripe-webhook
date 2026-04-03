import db from './firebase.js';

export default async function handler(req, res) {
  // 1. Barrera de seguridad
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  // Configuración Maestra de Canales (Aquí escalarás a futuro)
  const channelsConfig = [
    { name: "Liturgia", dbCollection: "content", telegramId: "-1003524006612" },
    // Para agregar tu segundo canal, solo descomenta y llena esta línea:
    // { name: "Estoicismo", dbCollection: "content_estoicismo", telegramId: "-100XXXXXXX" },
    // { name: "Finanzas", dbCollection: "content_finanzas", telegramId: "-100YYYYYYY" }
  ];

  const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
  const ADMIN_ID = process.env.ADMIN_CHAT_ID;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  let report = []; // Para llevar registro de lo que pasó en cada canal

  try {
    // 2. Iteramos sobre cada canal de forma secuencial
    for (const config of channelsConfig) {
      console.log(`Procesando canal: ${config.name}...`);
      const contentDoc = await db.collection(config.dbCollection).doc(today).get();

      if (!contentDoc.exists) {
         report.push({ canal: config.name, status: "ignorado", razon: "Sin contenido para hoy" });
         continue; // Saltamos al siguiente canal en lugar de detener todo el script
      }

      const content = contentDoc.data();

      if (content.sent) {
        report.push({ canal: config.name, status: "ignorado", razon: "Ya enviado previamente" });
        continue;
      }

      // 3. Disparo a Telegram (Canal Público)
      const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          chat_id: config.telegramId, 
          text: content.text, 
          parse_mode: "HTML" 
        }),
      });

      if (!response.ok) {
        throw new Error(`Falla en Telegram para ${config.name}: ${await response.text()}`);
      }

      // 4. Actualizar Firestore
      await contentDoc.ref.update({ sent: true, sentAt: new Date().toISOString() });
      report.push({ canal: config.name, status: "exito", fecha: today });

      // 5. Auditoría de Inventario (Alerta Temprana)
      const unsentQuery = await db.collection(config.dbCollection).where('sent', '==', false).count().get();
      const remainingDays = unsentQuery.data().count;

      if (remainingDays <= 15 && ADMIN_ID) {
        await fetch(`${TELEGRAM_API}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            chat_id: ADMIN_ID, 
            text: `⚠️ <b>ALERTA DE INVENTARIO: ${config.name}</b>\nSolo quedan ${remainingDays} días de contenido programado. Es necesario cargar más a Firestore pronto.`,
            parse_mode: "HTML"
          }),
        });
      }
    } // Fin del loop

    return res.status(200).json({ status: "Proceso por lotes finalizado", resultados: report });

  } catch (error) {
    console.error("Falla crítica en Orquestador:", error);
    
    // Alerta de Telemetría a Telegram Personal (Ya comprobada)
    if (ADMIN_ID) {
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          chat_id: ADMIN_ID, 
          text: `🚨 <b>ERROR CRÍTICO EN CRON DE CONTENIDO:</b>\n${error.message}`,
          parse_mode: "HTML"
        }),
      });
    }
    return res.status(500).json({ error: error.message });
  }
}
