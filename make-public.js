import { Storage } from '@google-cloud/storage';

// Inicia Storage usando tu llave JSON local
const storage = new Storage({ 
  keyFilename: './service-account-testing.json' 
});

const bucketName = 'telegram-test-6efe1';
const bucket = storage.bucket(bucketName);

async function makePublic() {
  console.log('--- INICIANDO ACTUALIZACIÓN DE METADATOS Y PERMISOS ---');
  
  try {
    const [files] = await bucket.getFiles({ prefix: 'audios/' });

    if (files.length === 0) {
      console.log('No se encontraron archivos en la carpeta audios/.');
      return;
    }

    console.log(`Procesando ${files.length} archivos...`);

    for (const file of files) {
      if (file.name.endsWith('.mp3')) {
        // 1. Forzamos el tipo de contenido para que sea reconocido como audio
        await file.setMetadata({
          contentType: 'audio/mpeg',
          cacheControl: 'public, max-age=31536000',
        });

        // 2. Lo hacemos público
        await file.makePublic();
        
        console.log(`✅ Actualizado: ${file.name}`);
      }
    }
    
    console.log('--- PROCESO FINALIZADO CON ÉXITO ---');
  } catch (error) {
    console.error('❌ Error durante el proceso:', error.message);
  }
}

makePublic().catch(console.error);