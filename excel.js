// Lectura del Excel del patio y exportes a Excel / PDF, todo en el navegador.
// Las librerías se descargan solo cuando se usan, para que la lista cargue rápido.
import { limpiar, aNumero, normalizarVale } from "./datos.js";

const LIB_XLSX = "https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js";
const LIB_PDF = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
const LIB_PDF_TABLA = "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js";

const cargadas = {};
function cargarScript(url) {
  if (!cargadas[url]) {
    cargadas[url] = new Promise((ok, mal) => {
      const s = document.createElement("script");
      s.src = url; s.onload = ok;
      s.onerror = () => { delete cargadas[url]; mal(new Error("No se pudo descargar una librería. Revisa la conexión a internet.")); };
      document.head.appendChild(s);
    });
  }
  return cargadas[url];
}
const xlsx = async () => { await cargarScript(LIB_XLSX); return window.XLSX; };

// ------------------------------------------------------------ lectura
const ALIAS = {
  codigo: ["TEMP_CODE", "TEMP CODE", "CODIGO", "CÓDIGO"],
  item_code: ["ITEM_CODE", "ITEM CODE"],
  descripcion: ["DESCRIPTION", "DESCRIPCION", "DESCRIPCIÓN"],
  storage_location: ["STORAGE_TYPE", "STORAGE LOCATION", "STORAGE_LOCATION"],
  storage_section: ["STORAGE_SECTION", "STORAGE SECTION", "SECTION"],
  location: ["LOCATION"],
  um: ["UND", "UM", "UNIDAD"],
  saldo: ["SALDO"],
  stock: ["STOCK"],
};
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toUpperCase();

function buscarEncabezado(filas) {
  for (let i = 0; i < Math.min(filas.length, 20); i++) {
    const f = filas[i].map(norm);
    if (f.some((c) => ALIAS.codigo.includes(c))) {
      const idx = {};
      for (const [k, nombres] of Object.entries(ALIAS)) idx[k] = f.findIndex((c) => nombres.includes(c));
      return { fila: i, idx };
    }
  }
  return null;
}

const dos = (n) => String(n).padStart(2, "0");
function fechaHistorica(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${dos(v.getMonth() + 1)}-${dos(v.getDate())}`;
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`;
  }
  const m = String(v).trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${dos(m[2])}-${dos(m[1])}`;
  }
  return null;
}

/** Lee el archivo y devuelve { materiales, historial, repetidos, hoja }. */
export async function leerExcel(archivo) {
  const X = await xlsx();
  const wb = X.read(await archivo.arrayBuffer(), { type: "array", cellDates: true });
  const aFilas = (nombre) => X.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, raw: true, defval: null });

  // Lista oficial: hoja STOCK si existe; si no, la primera hoja con encabezado de código.
  const candidatas = wb.SheetNames.includes("STOCK")
    ? ["STOCK", ...wb.SheetNames.filter((n) => n !== "STOCK")] : wb.SheetNames;
  let hoja = null, filas = null, enc = null;
  for (const n of candidatas) {
    if (n === "DESCARGAR DESPACHO" || n === "Instrucciones") continue;
    const f = aFilas(n);
    const e = buscarEncabezado(f);
    if (e) { hoja = n; filas = f; enc = e; break; }
  }
  if (!enc) throw new Error("No encontré una hoja con la columna TEMP_CODE o CODIGO.");

  const { idx } = enc;
  const col = (fila, k) => (idx[k] >= 0 ? fila[idx[k]] : null);
  const vistos = new Set(), repetidos = [], materiales = [];
  for (const fila of filas.slice(enc.fila + 1)) {
    const codigo = limpiar(col(fila, "codigo"));
    if (!codigo) continue;
    if (vistos.has(codigo)) { repetidos.push(codigo); continue; }
    vistos.add(codigo);
    // SALDO es el stock actual; STOCK solo se usa si el archivo no trae SALDO (plantilla de carga).
    const stock = idx.saldo >= 0 ? aNumero(col(fila, "saldo")) : aNumero(col(fila, "stock"));
    materiales.push({
      codigo,
      item_code: limpiar(col(fila, "item_code")),
      descripcion: limpiar(col(fila, "descripcion")),
      storage_location: limpiar(col(fila, "storage_location")),
      storage_section: limpiar(col(fila, "storage_section")),
      location: limpiar(col(fila, "location")),
      um: limpiar(col(fila, "um")),
      stock: stock ?? 0,
      inventariado: false,
      fecha_inventario: null,
      responsable_inventario: null,
    });
  }

  // Historial (hoja DESCARGAR DESPACHO), solo como registro.
  const historial = [];
  if (wb.SheetNames.includes("DESCARGAR DESPACHO")) {
    const fh = aFilas("DESCARGAR DESPACHO");
    const inicio = fh.findIndex((f) => norm(f[0]).startsWith("TEMP"));
    for (const f of fh.slice(inicio + 1)) {
      const codigo = limpiar(f[0]);
      const fecha = fechaHistorica(f[7]);
      if (!codigo && !fecha) continue;
      const cantidad = aNumero(f[9]);
      const obs = [limpiar(f[13]), limpiar(f[14])];
      if (cantidad === null && limpiar(f[9])) obs.push(`Cantidad original: ${f[9]}`);
      if (!fecha && limpiar(f[7])) obs.push(`Fecha original: ${f[7]}`);
      historial.push({
        tipo: "HISTORICO", codigo, item_code: limpiar(f[1]), descripcion: limpiar(f[2]),
        storage_location: limpiar(f[4]), storage_section: limpiar(f[5]), location: limpiar(f[6]),
        um: limpiar(f[10]), fecha, vale: normalizarVale(f[8], false), cantidad,
        stock_antes: null, stock_despues: null,
        responsable: limpiar(f[11]), comentario: obs.filter(Boolean).join(" | ") || null,
      });
    }
  }
  return { materiales, historial, repetidos, hoja };
}

// ------------------------------------------------------------ exportes
export const COLS = {
  materiales: [
    ["Codigo", "codigo", 11], ["Item_Code", "item_code", 18], ["Description", "descripcion", 50],
    ["Storage Location", "storage_location", 14], ["Storage Section", "storage_section", 13],
    ["Location", "location", 10], ["UM", "um", 7], ["Stock", "stock", 10, "num"],
    ["Inventariado", "inventariado", 12, "si_no"], ["Fecha conteo", "fecha_inventario", 17, "fecha"],
    ["Responsable conteo", "responsable_inventario", 18],
  ],
  despachos: [
    ["Codigo", "codigo", 11], ["Item_Code", "item_code", 18], ["Description", "descripcion", 44],
    ["Storage Location", "storage_location", 14], ["Storage Section", "storage_section", 13],
    ["Location", "location", 10], ["Fecha", "fecha", 17, "fecha"], ["Vale Manual", "vale", 12],
    ["Cantidad", "cantidad", 10, "num"], ["UM", "um", 7], ["Despachador", "responsable", 15],
    ["Comentario", "comentario", 40],
  ],
};

export function fmtFecha(s) {
  if (!s) return "-";
  const [d, h] = s.split(" ");
  const [y, m, dd] = d.split("-");
  return `${dd}/${m}/${y}` + (h ? " " + h.slice(0, 5) : "");
}
const fmtNum = (x) => (x === null || x === undefined ? "-" : String(Math.round(x * 10000) / 10000));

function texto(fila, clave, tipo) {
  const v = fila[clave];
  if (tipo === "num") return fmtNum(v);
  if (tipo === "fecha") return fmtFecha(v);
  if (tipo === "si_no") return v ? "Sí" : "No";
  return v === null || v === undefined || v === "" ? "-" : String(v);
}

const VERDE = "E3F1E3", ROJO = "FBECE8", TINTA = "1D2630";
const titulo = (lista) => (lista === "materiales" ? "Lista oficial de materiales" : "Lista de despachos") + ", Surplus Patio Komatsu";
function nombreArchivo(lista, ext) {
  const d = new Date();
  return `${lista === "materiales" ? "lista_oficial" : "lista_despacho"}_${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}_${dos(d.getHours())}${dos(d.getMinutes())}.${ext}`;
}
const generado = () => { const d = new Date(); return `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()} ${dos(d.getHours())}:${dos(d.getMinutes())}`; };

export async function exportarExcel(lista, filas) {
  const X = await xlsx();
  const cols = COLS[lista];
  const aoa = [[titulo(lista)], [`Generado el ${generado()} (${filas.length} filas)`], [], cols.map((c) => c[0])];
  filas.forEach((f) => aoa.push(cols.map(([, k, , t]) => (t === "num" ? (f[k] ?? "-") : texto(f, k, t)))));
  const ws = X.utils.aoa_to_sheet(aoa);
  ws["!cols"] = cols.map((c) => ({ wch: c[2] }));
  ws["!autofilter"] = { ref: X.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: 3 + filas.length, c: cols.length - 1 } }) };

  const borde = { bottom: { style: "thin", color: { rgb: "C9CED3" } } };
  ws["A1"].s = { font: { name: "Arial", sz: 13, bold: true } };
  ws["A2"].s = { font: { name: "Arial", sz: 9, color: { rgb: "5B6670" } } };
  cols.forEach((c, j) => {
    const ref = X.utils.encode_cell({ r: 3, c: j });
    ws[ref].s = { font: { name: "Arial", bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: TINTA } }, alignment: { wrapText: true, vertical: "center" } };
  });
  filas.forEach((f, i) => {
    const color = lista === "materiales" ? (f.inventariado ? VERDE : ROJO) : null;
    cols.forEach(([, , , t], j) => {
      const ref = X.utils.encode_cell({ r: 4 + i, c: j });
      if (!ws[ref]) return;
      ws[ref].s = {
        font: { name: "Arial", sz: 10 }, border: borde,
        alignment: { vertical: "top", wrapText: j === 2 || j === 11, horizontal: t === "num" ? "right" : undefined },
        ...(color ? { fill: { fgColor: { rgb: color } } } : {}),
      };
    });
  });
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, lista === "materiales" ? "Lista oficial" : "Lista despacho");
  X.writeFile(wb, nombreArchivo(lista, "xlsx"));
}

export async function exportarPDF(lista, filas) {
  await cargarScript(LIB_PDF);
  await cargarScript(LIB_PDF_TABLA);
  const { jsPDF } = window.jspdf;
  const cols = COLS[lista];
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const tit = titulo(lista), gen = generado();
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(13); pdf.text(tit, 10, 13);
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(91, 102, 112);
  pdf.text(`Generado el ${gen} (${filas.length} filas)`, 10, 18);

  const anchoTotal = cols.reduce((s, c) => s + c[2], 0);
  const columnStyles = {};
  cols.forEach((c, j) => {
    columnStyles[j] = { cellWidth: (c[2] / anchoTotal) * 277, halign: c[3] === "num" ? "right" : "left" };
  });
  pdf.autoTable({
    startY: 22, margin: { left: 10, right: 10, bottom: 12 },
    head: [cols.map((c) => c[0])],
    body: filas.map((f) => cols.map(([, k, , t]) => texto(f, k, t))),
    styles: { font: "helvetica", fontSize: 6.8, cellPadding: 1.2, overflow: "linebreak", textColor: [29, 38, 48], lineColor: [201, 206, 211], lineWidth: { bottom: 0.1 } },
    headStyles: { fillColor: [29, 38, 48], textColor: 255, fontStyle: "bold" },
    columnStyles,
    didParseCell: (d) => {
      if (d.section === "body" && lista === "materiales") {
        d.cell.styles.fillColor = filas[d.row.index].inventariado ? [227, 241, 227] : [251, 236, 232];
      }
    },
    didDrawPage: () => {
      pdf.setFontSize(7); pdf.setTextColor(91, 102, 112);
      pdf.text(`${tit}, generado el ${gen}`, 10, 205);
      pdf.text(`Página ${pdf.internal.getNumberOfPages()}`, 287, 205, { align: "right" });
    },
  });
  pdf.save(nombreArchivo(lista, "pdf"));
}

/** Plantilla vacía para la carga masiva de materiales nuevos. */
export async function descargarPlantilla() {
  const X = await xlsx();
  const ws = X.utils.aoa_to_sheet([
    ["CODIGO", "ITEM_CODE", "DESCRIPTION", "STORAGE LOCATION", "STORAGE SECTION", "LOCATION", "UM", "STOCK"],
  ]);
  ws["!cols"] = [11, 16, 44, 16, 16, 10, 7, 9].map((w) => ({ wch: w }));
  const ayuda = X.utils.aoa_to_sheet([
    ["Cómo llenar la hoja STOCK"],
    ["Una fila por material. CODIGO es obligatorio y no debe existir ya en el sistema."],
    ["STOCK es la cantidad actual. Las celdas vacías se muestran como guion."],
    ["Ejemplo:"],
    ["CODIGO", "ITEM_CODE", "DESCRIPTION", "STORAGE LOCATION", "STORAGE SECTION", "LOCATION", "UM", "STOCK"],
    ["CT9001", "5356649", "PIPE STD WT ERW STL API-5L-B / A53-B", "PSJ", "FLR", "B06", "M", 12],
  ]);
  ayuda["!cols"] = [{ wch: 11 }, { wch: 16 }, { wch: 44 }];
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, "STOCK");
  X.utils.book_append_sheet(wb, ayuda, "Instrucciones");
  X.writeFile(wb, "plantilla_materiales_nuevos.xlsx");
}
