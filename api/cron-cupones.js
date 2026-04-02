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
    const expiredQuery = await db.collection('coupons')
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
    console.error("Falla en el motor de auditoría de cupones:", error);
    return res.status(500).json({ error: error.message });
  }
}
