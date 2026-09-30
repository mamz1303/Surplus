// ============================================================
//  CONFIGURACIÓN: pega aquí los datos de tu proyecto Firebase
//  (Consola de Firebase > Configuración del proyecto > Tus apps > App web)
// ============================================================
export const firebaseConfig = {
  apiKey: "PEGAR_AQUI",
  authDomain: "PEGAR_AQUI.firebaseapp.com",
  projectId: "PEGAR_AQUI",
  storageBucket: "PEGAR_AQUI.appspot.com",
  messagingSenderId: "PEGAR_AQUI",
  appId: "PEGAR_AQUI",
};

// El usuario escribe "cvalmacen3" y por dentro se inicia sesión como
// cvalmacen3@surplus-komatsu.app. Ese correo es el que debes crear en
// Firebase > Authentication > Usuarios > Agregar usuario.
export const DOMINIO_USUARIOS = "surplus-komatsu.app";

// Materiales por documento en Firestore. Agruparlos reduce muchísimo
// las lecturas del plan gratuito (≈13 lecturas por apertura en vez de 3000).
export const MATERIALES_POR_BLOQUE = 250;
