import { Storage } from '@google-cloud/storage';

// 1. Configuración para Producción
const storage = new Storage({ 
  keyFilename: './service-account-produccion.json' 
});

const bucketName = 'evangelio-telegram.firebasestorage.app';
const bucket = storage.bucket(bucketName);

async function aplicarPermisosProduccion() {
  console.log('🏗️  Iniciando aplicación de permisos en PRODUCCIÓN...');
  
  try {
    // Buscamos los archivos en la carpeta /audios
    const [files] = await bucket.getFiles({ prefix: 'audios/' });

    if (files.length === 0) {
      console.log('❌ Error: No se encontraron archivos en la carpeta /audios del bucket de producción.');
      return;
    }

    console.log(`📡 Se encontraron ${files.length} archivos. Haciéndolos públicos...`);

    for (const file of files) {
      if (file.name.endsWith('.mp3')) {
        // Asignamos el tipo de contenido y el acceso público
        await file.setMetadata({
          contentType: 'audio/mpeg',
          cacheControl: 'public, max-age=31536000',
        });

        // Este es el paso que elimina el error "AccessDenied"
        await file.makePublic();
        console.log(`✅ Público: ${file.name}`);
      }
    }
    
    console.log('🏁 PROCESO COMPLETADO: Todos los audios de producción son ahora accesibles.');
  } catch (error) {
    console.error('❌ Error crítico en el script:', error.message);
  }
}

aplicarPermisosProduccion().catch(console.error);