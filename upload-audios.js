const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// 1. Usa tus credenciales de ambiente de pruebas
const serviceAccount = require('./service-account-testing.json'); 

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'telegram-test-6efe1' // Reemplaza con tu bucket real de GCS
});

const bucket = admin.storage().bucket();
const directoryPath = path.join(__dirname, 'audios_locales'); // Tu carpeta con MP3s

async function uploadFiles() {
  const files = fs.readdirSync(directoryPath);

  for (const file of files) {
    if (path.extname(file) === '.mp3') {
      const localPath = path.join(directoryPath, file);
      
      console.log(`Subiendo: ${file}...`);

      await bucket.upload(localPath, {
        destination: `audios/${file}`,
        public: true, // ESTO ES LO MÁS IMPORTANTE: Hace que el archivo sea legible para Telegram
        metadata: {
          contentType: 'audio/mpeg',
        },
      });

      console.log(`✅ ${file} subido y público.`);
    }
  }
  console.log('--- CARGA FINALIZADA ---');
}

uploadFiles().catch(console.error);