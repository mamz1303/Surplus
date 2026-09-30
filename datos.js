// Capa de datos: sesión (Firebase Auth) y base de datos (Firestore).
//
// Modelo en Firestore (pensado para gastar pocas lecturas del plan gratuito):
//   materiales/b000, b001, ...   { m: { CT86: {...material}, CT87: {...} } }   ~250 materiales por documento
//   despachos/2026-10            { items: [ {...despacho}, ... ] }              un documento por mes
//   despachos/hist-2020          { items: [...] }                               historial importado del Excel, por año
//   conteos/2026-10              { items: [ {...conteo}, ... ] }                registro de conteos por mes
import { firebaseConfig, DOMINIO_USUARIOS, MATERIALES_POR_BLOQUE } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, runTransaction, writeBatch, arrayUnion, FieldPath, getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const configurado = !String(firebaseConfig.apiKey).includes("PEGAR");

let auth = null;
let db = null;
if (configurado) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  // Caché local: si la señal se cae en el patio, la lista sigue visible.
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
}

export class ErrorNegocio extends Error {}

// ------------------------------------------------------------ utilidades
export const r4 = (x) => Math.round(Number(x) * 10000) / 10000;

export function limpiar(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  const s = String(v).trim();
  return s === "" || s === "-" || s === "--" ? null : s;
}

export function aNumero(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? r4(v) : null;
  const n = Number(String(v).trim().replace(",", "."));
  return Number.isFinite(n) ? r4(n) : null;
}

/** Vale manual nn-año (ej. 15-2024). Acepta 2024-15 y lo reordena.
 *  estricto=false deja pasar formatos antiguos del historial (VENTA01, 162...). */
export function normalizarVale(v, estricto = true) {
  const s = limpiar(v);
  if (!s) {
    if (estricto) throw new ErrorNegocio("Ingresa el vale manual con formato nn-año, por ejemplo 15-2024.");
    return null;
  }
  let m = s.match(/^(\d{1,5})\s*-\s*(\d{4})$/);
  if (m) return `${m[1].padStart(2, "0")}-${m[2]}`;
  m = s.match(/^(\d{4})\s*-\s*(\d{1,5})$/);
  if (m) return `${m[2].padStart(2, "0")}-${m[1]}`;
  if (estricto) throw new ErrorNegocio(`El vale "${s}" no tiene el formato nn-año (ej. 15-2024).`);
  return s;
}

const dos = (n) => String(n).padStart(2, "0");
export function ahora() {
  const d = new Date();
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
}
const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Firestore no acepta undefined.
function sinIndefinidos(o) {
  const r = {};
  for (const [k, v] of Object.entries(o)) if (!k.startsWith("_")) r[k] = v === undefined ? null : v;
  return r;
}

function requiereFirebase() {
  if (!configurado) throw new ErrorNegocio("Falta configurar Firebase en config.js.");
}

// ------------------------------------------------------------ sesión
export async function iniciarSesion(usuario, clave) {
  requiereFirebase();
  const u = String(usuario || "").trim().toLowerCase();
  if (!u || !clave) throw new ErrorNegocio("Escribe usuario y contraseña.");
  const correo = u.includes("@") ? u : `${u}@${DOMINIO_USUARIOS}`;
  try {
    await signInWithEmailAndPassword(auth, correo, clave);
  } catch (e) {
    const c = e.code || "";
    if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found") || c.includes("invalid-email"))
      throw new ErrorNegocio("Usuario o contraseña incorrectos.");
    if (c.includes("too-many-requests")) throw new ErrorNegocio("Demasiados intentos. Espera unos minutos e inténtalo otra vez.");
    if (c.includes("network")) throw new ErrorNegocio("Sin conexión a internet. Revisa la señal e inténtalo otra vez.");
    throw new ErrorNegocio("No se pudo iniciar sesión (" + (c || e.message) + ").");
  }
}

export function alCambiarSesion(cb) {
  if (!configurado) { cb(null); return () => {}; }
  return onAuthStateChanged(auth, cb);
}

/** Para páginas internas: devuelve el usuario o manda al login. */
export function exigirSesion() {
  return new Promise((resolve) => {
    const fin = alCambiarSesion((u) => {
      fin();
      if (u) resolve(u);
      else location.replace("index.html");
    });
  });
}

export async function cerrarSesion() {
  if (auth) await signOut(auth);
  location.replace("index.html");
}

export const nombreUsuario = (u) => (u && u.email ? u.email.split("@")[0] : "");

// ------------------------------------------------------------ lectura en tiempo real
function escuchar(col, alCambiar, alEstado) {
  requiereFirebase();
  return onSnapshot(collection(db, col), { includeMetadataChanges: true }, (snap) => {
    const cambios = snap.docChanges().map((ch) => ({ tipo: ch.type, id: ch.doc.id, data: ch.doc.data() }));
    if (cambios.length) alCambiar(cambios);
    alEstado && alEstado({ cache: snap.metadata.fromCache, pendiente: snap.metadata.hasPendingWrites });
  }, (err) => alEstado && alEstado({ error: err }));
}
export const escucharMateriales = (a, b) => escuchar("materiales", a, b);
export const escucharDespachos = (a, b) => escuchar("despachos", a, b);

// ------------------------------------------------------------ operaciones
function leerMaterial(snap, codigo) {
  const m = snap.exists() ? (snap.data().m || {})[codigo] : null;
  if (!m) throw new ErrorNegocio(`El material ${codigo} no existe en la lista oficial.`);
  return m;
}

/** Salida de material: stock nuevo = stock actual − cantidad. Atómico. */
export async function despachar({ codigo, bloque, cantidad, despachador, vale, comentario, permitirNegativo }) {
  requiereFirebase();
  const cant = aNumero(cantidad);
  if (!(cant > 0)) throw new ErrorNegocio("La cantidad a despachar debe ser mayor que cero.");
  const resp = (limpiar(despachador) || "").toUpperCase();
  if (!resp) throw new ErrorNegocio("Escribe el nombre del despachador responsable.");
  const v = normalizarVale(vale);
  const fecha = ahora();
  const refB = doc(db, "materiales", bloque);
  const refMes = doc(db, "despachos", fecha.slice(0, 7));

  return runTransaction(db, async (tx) => {
    const m = leerMaterial(await tx.get(refB), codigo);
    const antes = r4(m.stock || 0);
    const despues = r4(antes - cant);
    if (despues < 0 && !permitirNegativo)
      throw new ErrorNegocio(`El despacho deja el stock en ${despues} (hay ${antes}). Confirma si igual quieres registrarlo.`);
    const material = sinIndefinidos({ ...m, stock: despues });
    const despacho = sinIndefinidos({
      id: nuevoId(), tipo: "DESPACHO", codigo, item_code: m.item_code, descripcion: m.descripcion,
      storage_location: m.storage_location, storage_section: m.storage_section, location: m.location, um: m.um,
      fecha, vale: v, cantidad: cant, stock_antes: antes, stock_despues: despues,
      responsable: resp, comentario: limpiar(comentario),
    });
    tx.update(refB, new FieldPath("m", codigo), material);
    tx.set(refMes, { items: arrayUnion(despacho) }, { merge: true });
    return { material, despacho };
  });
}

/** Conteo físico: el stock pasa a ser lo contado y la fila queda inventariada.
 *  También corrige ubicación y descripción. Atómico. */
export async function contar({ codigo, bloque, stock, responsable, storage_location, storage_section, location, descripcion }) {
  requiereFirebase();
  const cant = aNumero(stock);
  if (cant === null || cant < 0) throw new ErrorNegocio("Ingresa la cantidad contada (0 o más).");
  const resp = (limpiar(responsable) || "").toUpperCase();
  if (!resp) throw new ErrorNegocio("Escribe el nombre de quien hizo el conteo.");
  const nuevos = {
    storage_location: limpiar(storage_location), storage_section: limpiar(storage_section),
    location: limpiar(location), descripcion: limpiar(descripcion),
  };
  const fecha = ahora();
  const refB = doc(db, "materiales", bloque);
  const refMes = doc(db, "conteos", fecha.slice(0, 7));

  return runTransaction(db, async (tx) => {
    const m = leerMaterial(await tx.get(refB), codigo);
    const cambios = Object.entries(nuevos)
      .filter(([k, v]) => (m[k] || null) !== v)
      .map(([k, v]) => `${k}: ${m[k] || "-"} → ${v || "-"}`);
    const material = sinIndefinidos({
      ...m, ...nuevos, stock: cant, inventariado: true, fecha_inventario: fecha, responsable_inventario: resp,
    });
    tx.update(refB, new FieldPath("m", codigo), material);
    tx.set(refMes, {
      items: arrayUnion({
        id: nuevoId(), codigo, fecha, stock_antes: r4(m.stock || 0), stock_despues: cant,
        responsable: resp, cambios: cambios.join("; ") || null,
      }),
    }, { merge: true });
    return { material };
  });
}

// ------------------------------------------------------------ carga desde Excel
const idBloque = (n) => "b" + String(n).padStart(3, "0");

async function borrarColeccion(nombre) {
  const snap = await getDocs(collection(db, nombre));
  let batch = writeBatch(db), n = 0;
  for (const d of snap.docs) {
    batch.delete(d.ref);
    if (++n % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
  }
  if (n % 400) await batch.commit();
  return n;
}

async function escribirDocs(nombre, docs, progreso) {
  // Lotes chicos para no superar el tamaño máximo de una escritura.
  for (let i = 0; i < docs.length; i += 8) {
    const batch = writeBatch(db);
    docs.slice(i, i + 8).forEach(([id, data]) => batch.set(doc(db, nombre, id), data));
    await batch.commit();
    progreso && progreso(Math.min(i + 8, docs.length), docs.length);
  }
}

/** Borra todo y carga la lista oficial (y opcionalmente el historial). */
export async function cargaInicial(materiales, historial, progreso = () => {}) {
  requiereFirebase();
  progreso("Borrando datos anteriores…");
  await borrarColeccion("materiales");
  await borrarColeccion("despachos");
  await borrarColeccion("conteos");

  const bloques = [];
  for (let i = 0; i < materiales.length; i += MATERIALES_POR_BLOQUE) {
    const m = {};
    materiales.slice(i, i + MATERIALES_POR_BLOQUE).forEach((x) => { m[x.codigo] = sinIndefinidos(x); });
    bloques.push([idBloque(bloques.length), { m }]);
  }
  await escribirDocs("materiales", bloques, (a, t) => progreso(`Materiales: bloque ${a} de ${t}`));

  if (historial && historial.length) {
    const porAnio = {};
    historial.forEach((h) => {
      const k = "hist-" + (h.fecha ? h.fecha.slice(0, 4) : "sin-fecha");
      (porAnio[k] = porAnio[k] || []).push(sinIndefinidos({ ...h, id: nuevoId() + Math.random().toString(36).slice(2, 5) }));
    });
    await escribirDocs("despachos", Object.entries(porAnio).map(([k, items]) => [k, { items }]),
      (a, t) => progreso(`Historial: documento ${a} de ${t}`));
  }
  return { materiales: materiales.length, bloques: bloques.length, historial: historial ? historial.length : 0 };
}

/** Agrega solo los códigos que no existen. No toca stock ni conteos existentes.
 *  existentes: Map codigo -> material (con _b = bloque). */
export async function agregarNuevos(materiales, existentes, progreso = () => {}) {
  requiereFirebase();
  const nuevos = materiales.filter((m) => !existentes.has(m.codigo));
  if (!nuevos.length) return { agregados: 0, omitidos: materiales.length };

  const ocupacion = {};
  existentes.forEach((m) => { ocupacion[m._b] = (ocupacion[m._b] || 0) + 1; });
  const ids = Object.keys(ocupacion).sort();
  let siguiente = ids.length ? parseInt(ids[ids.length - 1].slice(1), 10) + 1 : 0;

  // Rellena bloques con espacio y abre bloques nuevos cuando se llenan.
  const porBloque = {};
  const esNuevo = new Set();
  let actual = ids.find((id) => ocupacion[id] < MATERIALES_POR_BLOQUE);
  for (const m of nuevos) {
    if (!actual || ocupacion[actual] >= MATERIALES_POR_BLOQUE) {
      actual = idBloque(siguiente++); ocupacion[actual] = 0; esNuevo.add(actual);
    }
    (porBloque[actual] = porBloque[actual] || []).push(m);
    ocupacion[actual]++;
  }

  const entradas = Object.entries(porBloque);
  for (let i = 0; i < entradas.length; i++) {
    const [id, lista] = entradas[i];
    const batch = writeBatch(db);
    const ref = doc(db, "materiales", id);
    if (esNuevo.has(id)) {
      const m = {};
      lista.forEach((x) => { m[x.codigo] = sinIndefinidos(x); });
      batch.set(ref, { m });
    } else {
      const args = [];
      lista.forEach((x) => args.push(new FieldPath("m", x.codigo), sinIndefinidos(x)));
      batch.update(ref, ...args);
    }
    await batch.commit();
    progreso(`Guardando bloque ${i + 1} de ${entradas.length}`);
  }
  return { agregados: nuevos.length, omitidos: materiales.length - nuevos.length };
}
