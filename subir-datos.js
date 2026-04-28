import 'dotenv/config';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import OpenAI from 'openai';
import fs from 'fs';
import csv from 'csv-parser';

// 1. CONFIGURACIÓN
const credentials = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// NUEVO: Ahora tomamos el nombre explícito del bucket desde el .env
const BUCKET_NAME = process.env.FIREBASE_STORAGE_BUCKET;
const NOMBRE_ARCHIVO_CSV = 'calendario_liturgico_2026.csv';

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// NUEVO: Validación estricta del bucket antes de iniciar
if (!credentials.projectId || !credentials.privateKey || !OPENAI_API_KEY || !BUCKET_NAME) {
  console.error("❌ ERROR: Faltan variables críticas. Verifica que FIREBASE_STORAGE_BUCKET esté en tu .env.");
  process.exit(1);
}

initializeApp({
  credential: cert(credentials),
  storageBucket: BUCKET_NAME
});

const db = getFirestore();
const bucket = getStorage().bucket();
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

async function procesarContenido() {
  const resultados = [];

  if (!fs.existsSync(NOMBRE_ARCHIVO_CSV)) {
    console.error(`❌ ERROR: No se encuentra '${NOMBRE_ARCHIVO_CSV}'`);
    return;
  }

  fs.createReadStream(NOMBRE_ARCHIVO_CSV)
    .pipe(csv())
    .on('data', (data) => resultados.push(data))
    .on('end', async () => {
      console.log(`🚀 Archivo detectado. Procesando ${resultados.length} registros...`);

      for (const row of resultados) {
        const { fecha, evangelio, mensaje, tiempo_liturgico } = row;
        
        if (!mensaje || mensaje.trim() === "") {
          console.warn(`⚠️ Saltando ${fecha}: La columna 'mensaje' está vacía.`);
          continue; 
        }

        const fileName = `audios/${fecha}.mp3`;

        try {
          console.log(`🎙️ Generando audio para: ${fecha}...`);
          
          const mp3 = await openai.audio.speech.create({
            model: "tts-1",
            voice: "onyx",
            input: mensaje, 
          });

          const buffer = Buffer.from(await mp3.arrayBuffer());
          const file = bucket.file(fileName);
          
          // Aquí es donde ocurría el error 404. Ahora apuntará al bucket correcto.
          await file.save(buffer, { contentType: 'audio/mpeg' });
          // await file.makePublic();
          
          const publicUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${fileName}`;

          await db.collection('liturgical_content').doc(fecha).set({
            evangelio,
            reflexion: mensaje, 
            tiempo_liturgico,
            audioUrl: publicUrl,
            sent: false,
            createdAt: new Date().toISOString()
          });

          console.log(`✅ ${fecha} completado y guardado en Firestore.`);
          
          console.log(`⏱️ Esperando 22 segundos para respetar límites de cuota...`);
          await delay(22000); 

        } catch (error) {
          console.error(`❌ Error en ${fecha}:`, error.message);
          if (error.message.includes('Rate limit') || error.message.includes('429')) {
            console.log("🛑 Límite de velocidad. Pausando 60 segundos...");
            await delay(60000);
          }
        }
      }
      console.log('🏁 Proceso total terminado.');
    });
}

procesarContenido();