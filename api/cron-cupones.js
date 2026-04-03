import db from './firebase.js';

export default async function handler(req, res) {
  // 1. Barrera de seguridad (Misma que usamos en el de contenido)
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    // 2. Obtener fecha actual en CDMX (YYYY-MM-DD)
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
    
    // 3. Query: Cupones 'available' cuya fecha 'expiresAt' es menor a hoy
    const expiredQuery = await db.collection('cupones_rotos_test')
      .where('status', '==', 'available')
      .where('expiresAt', '<', today)
      .get();

    if (expiredQuery.empty) {
      return res.status(200).json({ 
        message: "Auditoría completada. No se encontraron cupones vencidos hoy.",
        fecha_proceso: today 
      });
    }

    // 4. Operación en Batch (Atómica) para actualizar todos los vencidos
    const batch = db.batch();
    expiredQuery.forEach(doc => {
      batch.update(doc.ref, { 
        status: 'expired',
        updatedAt: new Date().toISOString() 
      });
    });

    await batch.commit();

    return res.status(200).json({ 
      status: "success", 
      cupones_afectados: expiredQuery.size, 
      message: "Cupones invalidados por vencimiento de vigencia." 
    });

} catch (error) {
    console.error("Falla de ejecución:", error);
    
    // Disparador de emergencia a Telegram personal
    const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
    const ADMIN_ID = process.env.ADMIN_CHAT_ID;
    
    if (ADMIN_ID) {
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          chat_id: ADMIN_ID, 
          text: `🚨 ERROR CRÍTICO EN SCRIPT:\n${error.message}` 
        }),
      });
    }

    return res.status(500).json({ error: error.message });
  }
}
