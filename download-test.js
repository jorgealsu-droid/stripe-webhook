import { Storage } from '@google-cloud/storage';
import fs from 'fs';
import path from 'path';

// 1. Conexión al entorno de PRUEBAS
const storage = new Storage({ 
  keyFilename: './service-account-testing.json' 
});

const bucketName = 'telegram-test-6efe1';
const downloadDir = './audios_recuperados';

async function downloadAudios() {
  console.log('📡 Conectando al bucket de pruebas para rescatar audios...');
  
  try {
    // Si la carpeta local no existe, la crea
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir);
    }

    const [files] = await storage.bucket(bucketName).getFiles({ prefix: 'audios/' });

    if (files.length === 0) {
      console.log('❌ No se encontraron audios en el bucket.');
      return;
    }

    console.log(`Se encontraron ${files.length} archivos. Iniciando descarga...`);

    for (const file of files) {
      if (file.name.endsWith('.mp3')) {
        const fileName = path.basename(file.name);
        const destination = path.join(downloadDir, fileName);

        await file.download({ destination });
        console.log(`⬇️ Descargado: ${fileName}`);
      }
    }

    console.log('✅ Todos los audios están ahora en la carpeta "audios_recuperados".');
  } catch (error) {
    console.error('❌ Error en la descarga:', error.message);
  }
}

downloadAudios().catch(console.error);