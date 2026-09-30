// ============================================================
//  CONFIGURACIÓN: pega aquí los datos de tu proyecto Firebase
//  (Consola de Firebase > Configuración del proyecto > Tus apps > App web)
// ============================================================

export const firebaseConfig = {
  apiKey: "AIzaSyC-fMI9i3cKUAoXkCuFJ625qvj7NXyCTxE",
  authDomain: "surplus-f8ce5.firebaseapp.com",
  projectId: "surplus-f8ce5",
  storageBucket: "surplus-f8ce5.firebasestorage.app",
  messagingSenderId: "732493298045",
  appId: "1:732493298045:web:a89f3aaef8ac74f6a37414"
};

// El usuario escribe "cvalmacen3" y por dentro se inicia sesión como
// cvalmacen3@surplus-komatsu.app. Ese correo es el que debes crear en
// Firebase > Authentication > Usuarios > Agregar usuario.
export const DOMINIO_USUARIOS = "surplus-komatsu.app";

// Materiales por documento en Firestore. Agruparlos reduce muchísimo
// las lecturas del plan gratuito (≈13 lecturas por apertura en vez de 3000).
export const MATERIALES_POR_BLOQUE = 250;
