const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const path = require('path');

// Configuración de la conexión
const storage = new Storage({
  keyFilename: './service-account-testing.json', // Tu archivo de credenciales
  projectId: 'EL_ID_DE_TU_PROYECTO' // Cámbialo por tu Project ID
});

const bucketName = 'telegram-test-6efe1';
const remoteFolder = 'audios/'; // La carpeta en la nube
const localFolder = path.join(__dirname, 'audios_locales');

// Crear la carpeta local si no existe
if (!fs.existsSync(localFolder)) {
  fs.mkdirSync(localFolder);
}

async function downloadAudios() {
  const [files] = await storage.bucket(bucketName).getFiles({ prefix: remoteFolder });

  console.log(`Encontrados ${files.length} archivos. Iniciando descarga...`);

  for (const file of files) {
    if (file.name.endsWith('.mp3')) {
      const fileName = path.basename(file.name);
      const destination = path.join(localFolder, fileName);

      console.log(`Descargando: ${fileName}...`);
      await file.download({ destination });
    }
  }

  console.log('--- DESCARGA COMPLETADA ---');
  console.log(`Revisa la carpeta: ${localFolder}`);
}

downloadAudios().catch(console.error);