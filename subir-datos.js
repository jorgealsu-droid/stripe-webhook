import admin from 'firebase-admin';
import fs from 'fs';
import csv from 'csv-parser';
import { readFile } from 'fs/promises';

// Para leer el archivo JSON de la llave en este formato moderno
const serviceAccount = JSON.parse(
  await readFile(new URL('./llave-firebase.json', import.meta.url))
);

console.log("🚀 Iniciando motor de subida en modo ES Module...");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function uploadContent() {
  const results = [];

  fs.createReadStream('calendario_liturgico_2026.csv')
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      console.log(`📦 Leídos ${results.length} registros. Procesando...`);
      
      let count = 0;
      for (const row of results) {
        const docId = row.fecha;
        
        // Formato HTML para Telegram
        const telegramMessage = `📖 <b>${row.tiempo_liturgico}</b>\n\n` +
                                `<i>"${row.evangelio}"</i>\n\n` +
                                `${row.mensaje.replace(/\¿/g, '\n\n¿').replace(/\?/g, '?\n\n')}`;

        const contentData = {
          evangelio: row.evangelio,
          mensaje_original: row.mensaje,
          mensaje_formateado: telegramMessage,
          tiempo_liturgico: row.tiempo_liturgico,
          sent: false 
        };

        await db.collection('liturgical_content').doc(docId).set(contentData);
        count++;
        
        if (count % 50 === 0) console.log(`⏳ Progreso: ${count}/${results.length}...`);
      }
      
      console.log('✅ ÉXITO: Todo el contenido de 2026 está en Firebase.');
      process.exit(0);
    });
}

uploadContent().catch(console.error);