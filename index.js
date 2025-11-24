// index.js
const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');

const app = express();
app.use(bodyParser.json());

// === Inicializar Firebase ===
let serviceAccount;

if (process.env.FIREBASE_SA) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SA);
    // Reemplaza los \n literales por saltos de línea reales
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  } catch (e) {
    console.error("❌ FIREBASE_SA no es JSON válido:", e.message);
    process.exit(1);
  }
} else {
  try {
    serviceAccount = require('./serviceAccountKey.json');
  } catch (e) {
    console.error("❌ No se encontró serviceAccountKey.json ni la variable FIREBASE_SA.");
    process.exit(1);
  }
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


const db = admin.firestore();
console.log("✅ Firebase inicializado correctamente");

// === CORS ===
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

/* =====================================================
   /sensor — recibe POST desde ESP32

   ESP32 debe enviar:
   {
     "temperature": 24.5,
     "soilPct": 60,
     "deviceId": "A1B2C3D4",
     "userId": "UID-del-usuario"
   }
===================================================== */
app.post('/sensor', async (req, res) => {
  const { temperature, soilPct, deviceId, userId, bomba } = req.body;

  if (!userId || !deviceId || temperature === undefined || soilPct === undefined) {
    console.warn("⚠ Datos incompletos:", req.body);
    return res.status(400).json({
      error: "Faltan userId/deviceId/temperature/soilPct"
    });
  }

  try {
    const lecturaRef = db
      .collection('usuarios')
      .doc(userId)
      .collection('dispositivos')
      .doc(deviceId)
      .collection('lecturas')
      .doc();

    await lecturaRef.set({
      temperature,
      soilPct,
      bomba: bomba ?? null,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`📥 Lectura guardada: usuario=${userId}, dispositivo=${deviceId}`);
    return res.json({ success: true });

  } catch (err) {
    console.error("❌ Error guardando lectura:", err);
    return res.status(500).json({ error: err.message });
  }
});

/* =====================================================
   /devices/claim — la app relaciona dispositivo ↔ usuario
===================================================== */
app.post('/devices/claim', async (req, res) => {
  const { deviceId, idToken } = req.body;

  if (!deviceId || !idToken)
    return res.status(400).json({ error: "Faltan datos" });

  try {
    // Validar token del usuario
    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    await db
      .collection('usuarios')
      .doc(uid)
      .collection('dispositivos')
      .doc(deviceId)
      .set({
        claimedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

    return res.json({ success: true, uid });

  } catch (err) {
    console.error("❌ /devices/claim error:", err);
    return res.status(401).json({ error: "Token inválido" });
  }
});

// === Debug ===
app.get('/', (_, res) => res.send("Express Terranova OK"));
app.get('/health', (_, res) => res.json({ ok: true }));

// === Start ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🟢 Server running on port ${PORT}`));
