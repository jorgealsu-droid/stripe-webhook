import admin from 'firebase-admin';
import fs from 'fs';

// 1. Inicializar credenciales de Prueba
const testCert = JSON.parse(fs.readFileSync('./service-account-testing.json', 'utf8'));
const testApp = admin.initializeApp({ 
  credential: admin.credential.cert(testCert) 
}, 'testApp');
const testDb = testApp.firestore();

// 2. Inicializar credenciales de Producción
const prodCert = JSON.parse(fs.readFileSync('./service-account-produccion.json', 'utf8'));
const prodApp = admin.initializeApp({ 
  credential: admin.credential.cert(prodCert) 
}, 'prodApp');
const prodDb = prodApp.firestore();

async function cloneDatabase() {
  console.log('🔄 Iniciando clonación: Pruebas -> Producción...');
  
  try {
    // Leemos todos los documentos de la colección en Pruebas
    const snapshot = await testDb.collection("liturgical_content").get();
    
    if (snapshot.empty) {
      console.log('❌ No hay documentos en la base de pruebas.');
      return;
    }

    console.log(`📦 Se encontraron ${snapshot.size} registros. Iniciando transferencia...`);

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const dateId = doc.id; // Asume que el ID del documento es la fecha (ej. 2026-05-01)
      
      // Transformación Crítica: Actualizamos la URL al dominio de Producción
      if (data.audioUrl) {
        data.audioUrl = data.audioUrl.replace(
          'telegram-test-6efe1', 
          'evangelio-telegram.firebasestorage.app'
        );
      }

      // Escribimos el documento corregido en Producción
      await prodDb.collection("liturgical_content").doc(dateId).set(data);
      console.log(`✅ Registro clonado: ${dateId}`);
    }

    console.log('--- CLONACIÓN COMPLETADA AL 100% ---');
  } catch (error) {
    console.error('❌ Error crítico durante la clonación:', error.message);
  }
}

cloneDatabase().catch(console.error);