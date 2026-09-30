// Configuración de Firebase del proyecto Surplus
export const firebaseConfig = {
  apiKey: "AIzaSyC-fMI9i3cKUAoXkCuFJ625qvj7NXyCTxE",
  authDomain: "surplus-f8ce5.firebaseapp.com",
  projectId: "surplus-f8ce5",
  storageBucket: "surplus-f8ce5.firebasestorage.app",
  messagingSenderId: "732493298045",
  appId: "1:732493298045:web:a89f3aaef8ac74f6a37414",
};

// El usuario escribe "cvalmacen3" y por dentro se inicia sesión como
// cvalmacen3@surplus-komatsu.app (el usuario creado en Authentication).
export const DOMINIO_USUARIOS = "surplus-komatsu.app";

// Materiales por documento en Firestore (reduce las lecturas del plan gratuito).
export const MATERIALES_POR_BLOQUE = 250;
