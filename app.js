/* Surplus Patio Komatsu: lógica compartida de las pantallas Despacho e Inventario.
   Los datos viven en Firestore y llegan en tiempo real; no hace falta recargar. */
import {
  exigirSesion, cerrarSesion, nombreUsuario, escucharMateriales, escucharDespachos, despachar, contar,
} from "./datos.js";
import { exportarExcel, exportarPDF } from "./excel.js";

(async () => {

  const ROL = document.body.dataset.rol; // "despacho" | "inventario"
  const LOTE = 60; // filas que se dibujan por tanda (scroll infinito)
  const $ = (s, el = document) => el.querySelector(s);
  const col = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

  // ------------------------------------------------------------ columnas
  const COLS = {
    materiales: {
      codigo: { t: "Codigo", tipo: "txt" },
      item_code: { t: "Item_Code", tipo: "txt" },
      descripcion: { t: "Description", tipo: "txt" },
      storage_location: { t: "Storage Location", tipo: "txt" },
      storage_section: { t: "Storage Section", tipo: "txt" },
      location: { t: "Location", tipo: "txt" },
      um: { t: "UM", tipo: "txt" },
      stock: { t: "Stock", tipo: "num" },
      inventariado: { t: "Inventariado", tipo: "num" },
      fecha_inventario: { t: "Fecha de conteo", tipo: "txt" },
    },
    despachos: {
      fecha: { t: "Fecha", tipo: "txt" },
      codigo: { t: "Codigo", tipo: "txt" },
      item_code: { t: "Item_Code", tipo: "txt" },
      descripcion: { t: "Description", tipo: "txt" },
      storage_location: { t: "Storage Location", tipo: "txt" },
      storage_section: { t: "Storage Section", tipo: "txt" },
      location: { t: "Location", tipo: "txt" },
      vale: { t: "Vale manual", tipo: "txt" },
      cantidad: { t: "Cantidad", tipo: "num" },
      um: { t: "UM", tipo: "txt" },
      responsable: { t: "Despachador", tipo: "txt" },
    },
  };
  const ORDEN_UBICACION = [
    { c: "storage_location", d: 1 }, { c: "storage_section", d: 1 }, { c: "location", d: 1 }, { c: "codigo", d: 1 },
  ];
  const ORDEN_RECIENTES = [{ c: "fecha", d: -1 }, { c: "vale", d: -1 }];

  // ------------------------------------------------------------ estado
  const est = {
    vista: "materiales",
    materiales: new Map(),
    despachos: new Map(),
    docsDespacho: new Map(), // id de documento mensual -> ids de despachos que contiene
    visibles: [],
    dibujadas: 0,
    q: "",
    filtro: { materiales: "todos", despachos: "todos" },
    orden: {
      materiales: leer("orden_materiales") || ORDEN_UBICACION,
      despachos: leer("orden_despachos") || ORDEN_RECIENTES,
    },
    sel: null,
  };

  function leer(k) { try { return JSON.parse(localStorage.getItem("surplus_" + k)); } catch { return null; } }
  function guardar(k, v) { try { localStorage.setItem("surplus_" + k, JSON.stringify(v)); } catch { /* sin espacio */ } }

  // ------------------------------------------------------------ formato
  const val = (v) => (v === null || v === undefined ? "" : esc(v));
  const guion = (v) => (v === null || v === undefined || v === "" ? "-" : v);
  function esc(v) {
    return String(guion(v)).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function num(x) {
    if (x === null || x === undefined || x === "") return "-";
    const r = Math.round(Number(x) * 10000) / 10000;
    return r.toLocaleString("es-PE", { maximumFractionDigits: 4 });
  }
  function fecha(s) {
    if (!s) return "-";
    const [d, h] = s.split(" ");
    const [y, m, dd] = d.split("-");
    return `${dd}/${m}/${y}` + (h ? " " + h.slice(0, 5) : "");
  }
  function hora() { return new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false }); }

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = msg; t.setAttribute("role", "status");
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  // ------------------------------------------------------------ datos en tiempo real
  let tRefresco;
  const refrescoDiferido = () => { clearTimeout(tRefresco); tRefresco = setTimeout(() => { if (!hoja.open) refrescar(true); else est.pendiente = true; }, 120); };

  function estadoConexion({ cache, error } = {}) {
    const sync = $("#sync");
    if (!est.cargado && !error && (!cache || est.materiales.size)) { est.cargado = true; refrescoDiferido(); }
    if (error) {
      sync.textContent = error.code === "permission-denied" ? "Sin permiso" : "Error de conexión";
      sync.classList.add("error");
    } else if (cache) {
      sync.textContent = "Sin señal, datos guardados";
      sync.classList.add("error");
    } else {
      sync.textContent = `En línea ${hora()}`;
      sync.classList.remove("error");
    }
  }

  function alCambiarMateriales(cambios) {
    for (const { tipo, id, data } of cambios) {
      est.materiales.forEach((m, k) => { if (m._b === id) est.materiales.delete(k); });
      if (tipo === "removed") continue;
      for (const [codigo, m] of Object.entries(data.m || {})) est.materiales.set(codigo, { ...m, codigo, _b: id });
    }
    refrescoDiferido();
  }

  function alCambiarDespachos(cambios) {
    for (const { tipo, id, data } of cambios) {
      (est.docsDespacho.get(id) || []).forEach((x) => est.despachos.delete(x));
      if (tipo === "removed") { est.docsDespacho.delete(id); continue; }
      const ids = [];
      for (const d of data.items || []) { est.despachos.set(d.id, d); ids.push(d.id); }
      est.docsDespacho.set(id, ids);
    }
    if (est.vista === "despachos") refrescoDiferido();
  }

  // ------------------------------------------------------------ filtrado y orden
  function comparar(a, b, orden, cols) {
    for (const { c, d } of orden) {
      const va = a[c], vb = b[c];
      const na = va === null || va === undefined || va === "";
      const nb = vb === null || vb === undefined || vb === "";
      if (na || nb) { if (na && nb) continue; return na ? 1 : -1; } // vacíos siempre al final
      const r = cols[c] && cols[c].tipo === "num" ? va - vb : col.compare(String(va), String(vb));
      if (r) return r * d;
    }
    return 0;
  }

  const CAMPOS_BUSQUEDA = {
    materiales: ["codigo", "item_code", "descripcion", "storage_location", "storage_section", "location"],
    despachos: ["codigo", "item_code", "descripcion", "vale", "responsable", "comentario", "location"],
  };

  function calcularVisibles() {
    const v = est.vista;
    const terms = est.q.toLowerCase().split(/\s+/).filter(Boolean);
    const campos = CAMPOS_BUSQUEDA[v];
    const f = est.filtro[v];
    const miNombre = (leer("despachador") || "").toUpperCase();
    let filas = [...(v === "materiales" ? est.materiales : est.despachos).values()];

    filas = filas.filter((r) => {
      if (v === "materiales") {
        if (f === "ok" && !r.inventariado) return false;
        if (f === "pend" && r.inventariado) return false;
        if (f === "stock" && !(r.stock > 0)) return false;
        if (f === "neg" && !(r.stock < 0)) return false;
      } else {
        if (f === "app" && r.tipo !== "DESPACHO") return false;
        if (f === "mios" && (r.tipo !== "DESPACHO" || (r.responsable || "") !== miNombre)) return false;
        if (f === "hist" && r.tipo !== "HISTORICO") return false;
      }
      if (!terms.length) return true;
      const texto = campos.map((c) => r[c] || "").join(" ").toLowerCase();
      return terms.every((t) => texto.includes(t));
    });
    filas.sort((a, b) => comparar(a, b, est.orden[v], COLS[v]));
    // Si lo buscado es exactamente un código o item, esas filas van primero (CT86 antes que CT860).
    const exacto = est.q.trim().toLowerCase();
    if (exacto) {
      const es = (r) => (r.codigo || "").toLowerCase() === exacto || (r.item_code || "").toLowerCase() === exacto;
      filas = [...filas.filter(es), ...filas.filter((r) => !es(r))];
    }
    est.visibles = filas;
  }

  // ------------------------------------------------------------ dibujo
  function htmlMaterial(m) {
    const extra = m.inventariado
      ? `Contado ${fecha(m.fecha_inventario)} por ${esc(m.responsable_inventario)}`
      : "Sin conteo";
    return `<button class="fila${m.inventariado ? " ok" : ""}" data-id="${esc(m.codigo)}">
      <span class="placa"><span class="placa__sl">${esc(m.storage_location)}</span><span class="placa__sec">${esc(m.storage_section)}</span><span class="placa__loc">${esc(m.location)}</span></span>
      <span class="fila__cuerpo">
        <span class="fila__codigos"><b>${esc(m.codigo)}</b><span>${esc(m.item_code)}</span></span>
        <span class="fila__desc">${esc(m.descripcion)}</span>
        <span class="fila__extra">${extra}</span>
      </span>
      <span class="fila__stock"><strong class="${m.stock < 0 ? "negativo" : ""}">${num(m.stock)}</strong><small>${esc(m.um)}</small></span>
    </button>`;
  }

  function htmlDespacho(d) {
    const hist = d.tipo === "HISTORICO";
    return `<button class="fila mov${hist ? " historico" : ""}" data-id="${d.id}">
      <span class="placa"><span class="placa__sl">${esc(d.storage_location)}</span><span class="placa__sec">${esc(d.storage_section)}</span><span class="placa__loc">${esc(d.location)}</span></span>
      <span class="fila__cuerpo">
        <span class="fila__codigos"><b>${esc(d.codigo)}</b><span>Vale ${esc(d.vale)}</span><span>${fecha(d.fecha)}</span></span>
        <span class="fila__desc">${esc(d.descripcion)}</span>
        <span class="fila__extra">${esc(d.responsable)}${d.comentario ? ", " + esc(d.comentario) : ""}${hist ? " (histórico)" : ""}</span>
      </span>
      <span class="fila__stock"><strong>${num(d.cantidad)}</strong><small>${esc(d.um)}</small></span>
    </button>`;
  }

  function dibujarMas() {
    const lista = $("#lista");
    const desde = est.dibujadas;
    const hasta = Math.min(est.visibles.length, desde + LOTE);
    if (desde >= hasta) return;
    const fn = est.vista === "materiales" ? htmlMaterial : htmlDespacho;
    let html = "";
    for (let i = desde; i < hasta; i++) html += fn(est.visibles[i]);
    lista.insertAdjacentHTML("beforeend", html);
    est.dibujadas = hasta;
  }

  function refrescar(mantenerScroll = false) {
    const y = window.scrollY;
    const antes = est.dibujadas;
    calcularVisibles();
    const lista = $("#lista");
    lista.innerHTML = "";
    est.dibujadas = 0;
    dibujarMas();
    while (mantenerScroll && est.dibujadas < antes && est.dibujadas < est.visibles.length) dibujarMas();
    const vacio = $("#vacio");
    vacio.classList.toggle("oculto", est.visibles.length > 0);
    const total = est.vista === "materiales" ? est.materiales.size : est.despachos.size;
    vacio.innerHTML = !est.cargado ? "Cargando lista…"
      : total === 0 && est.vista === "materiales" ? 'Todavía no hay materiales. Cárgalos desde <a href="cargar.html">Cargar datos</a>.'
      : total === 0 ? "Todavía no hay despachos registrados."
      : "No hay filas con esta búsqueda o filtro. Cambia el texto o elige otro filtro.";
    resumen();
    if (mantenerScroll) window.scrollTo(0, y);
  }

  function resumen() {
    const v = est.vista;
    const total = v === "materiales" ? est.materiales.size : est.despachos.size;
    let txt = `<b>${est.visibles.length.toLocaleString("es-PE")}</b> de ${total.toLocaleString("es-PE")} ${v === "materiales" ? "materiales" : "despachos"}`;
    if (v === "materiales") {
      let ok = 0;
      est.materiales.forEach((m) => { if (m.inventariado) ok++; });
      txt += `, <b>${ok.toLocaleString("es-PE")}</b> inventariados`;
      const bar = $("#progreso");
      if (bar) bar.firstElementChild.style.width = (total ? (ok / total) * 100 : 0) + "%";
    }
    $("#resumen-texto").innerHTML = txt;
    $("#orden-actual").textContent = "Orden: " + est.orden[v].map((o) => COLS[v][o.c].t + (o.d < 0 ? " ↓" : "")).join(" › ");
  }

  // ------------------------------------------------------------ filtros (chips)
  const CHIPS = {
    materiales: [["todos", "Todos"], ["pend", "Sin conteo"], ["ok", "Inventariados"], ["stock", "Con stock"], ["neg", "Stock negativo"]],
    despachos: [["todos", "Todos"], ["mios", "Mis despachos"], ["app", "Registrados en la app"], ["hist", "Históricos"]],
  };
  function dibujarChips() {
    const v = est.vista;
    $("#filtros").innerHTML = CHIPS[v].map(([k, t]) =>
      `<button class="chip" data-filtro="${k}" aria-pressed="${est.filtro[v] === k}">${t}</button>`).join("");
  }

  // ------------------------------------------------------------ hoja: detalle / acción
  const hoja = $("#hoja");

  function abrirHoja(html) {
    hoja.innerHTML = html;
    if (!hoja.open) hoja.showModal();
    hoja.scrollTop = 0;
  }
  hoja.addEventListener("click", (e) => {
    if (e.target === hoja || e.target.closest("[data-cerrar]")) hoja.close();
  });

  function ficha(m) {
    return `<dl class="ficha">
      <div><dt>Storage Location</dt><dd>${esc(m.storage_location)}</dd></div>
      <div><dt>Storage Section</dt><dd>${esc(m.storage_section)}</dd></div>
      <div><dt>Location</dt><dd>${esc(m.location)}</dd></div>
      <div><dt>Item_Code</dt><dd>${esc(m.item_code)}</dd></div>
      <div><dt>UM</dt><dd>${esc(m.um)}</dd></div>
      <div><dt>Conteo</dt><dd>${m.inventariado ? fecha(m.fecha_inventario) : "Pendiente"}</dd></div>
      <div class="ancho"><dt>Description</dt><dd>${esc(m.descripcion)}</dd></div>
    </dl>`;
  }

  function cabeceraHoja(titulo, sub) {
    return `<div class="hoja__cab"><div><h2>${titulo}</h2><p>${sub}</p></div>
      <button class="btn btn--plano hoja__cerrar" data-cerrar aria-label="Cerrar">×</button></div>`;
  }

  function historialMaterial(codigo) {
    const movs = [...est.despachos.values()].filter((d) => d.codigo === codigo)
      .sort((a, b) => col.compare(b.fecha || "", a.fecha || "")).slice(0, 6);
    if (!movs.length) return "";
    return `<div class="historial-mat"><h3>Últimos despachos de este material</h3><ul>${movs.map((d) =>
      `<li><span>${fecha(d.fecha)}, vale ${esc(d.vale)}, ${esc(d.responsable)}</span><b class="num">−${num(d.cantidad)}</b></li>`).join("")}</ul></div>`;
  }

  function abrirDespacho(m) {
    est.sel = m.codigo;
    abrirHoja(`<form id="form-accion" novalidate>
      ${cabeceraHoja(`Despachar ${esc(m.codigo)}`, esc(m.descripcion))}
      <div class="hoja__cuerpo">
        <div class="stockbox"><div><span>Stock actual</span><strong>${num(m.stock)}</strong></div>
          <div class="flecha">→</div><div><span>Quedará</span><strong class="nuevo" id="stock-nuevo">${num(m.stock)}</strong></div></div>
        <div id="msg"></div>
        <label class="campo"><span>Cantidad a despachar (${esc(m.um)})</span>
          <input name="cantidad" type="number" inputmode="decimal" step="any" min="0" required autocomplete="off"></label>
        <label class="campo"><span>Despachador responsable</span>
          <input name="despachador" required autocapitalize="characters" placeholder="Ej. JCHECASACA" value="${val(leer("despachador"))}"></label>
        <label class="campo"><span>Vale manual</span>
          <input name="vale" required inputmode="numeric" placeholder="Ej. 15-2024" pattern="\\d{1,5}-\\d{4}" autocomplete="off">
          <small>Número y año separados por guion.</small></label>
        <label class="campo"><span>Comentario</span>
          <textarea name="comentario" rows="2" placeholder="Ej. Se despacha 01 carrete(s)"></textarea></label>
        ${ficha(m)}
        ${historialMaterial(m.codigo)}
      </div>
      <div class="hoja__pie"><button type="button" class="btn" data-cerrar>Cancelar</button>
        <button type="submit" class="btn btn--primario">Despachar</button></div>
    </form>`);

    const f = $("#form-accion");
    const actualizar = () => {
      const c = parseFloat(f.cantidad.value);
      const nuevo = isNaN(c) ? m.stock : m.stock - c;
      const el = $("#stock-nuevo");
      el.textContent = num(nuevo);
      el.classList.toggle("negativo", nuevo < 0);
      const msg = $("#msg");
      if (!isNaN(c) && nuevo < 0) {
        msg.innerHTML = `<div class="aviso aviso--alerta">El sistema tiene ${num(m.stock)} ${esc(m.um)}; este despacho deja el stock en negativo. Avisa a inventario para un reconteo.
          <label><input type="checkbox" name="permitir_negativo"> Confirmo que el material salió físicamente</label></div>`;
      } else if (msg.querySelector(".aviso--alerta")) msg.innerHTML = "";
    };
    f.cantidad.addEventListener("input", actualizar);
    f.vale.addEventListener("blur", () => {
      const m2 = f.vale.value.trim().match(/^(\d{4})\s*-\s*(\d{1,5})$/);
      if (m2) f.vale.value = `${m2[2].padStart(2, "0")}-${m2[1]}`;
    });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const datos = {
        codigo: m.codigo,
        cantidad: f.cantidad.value,
        despachador: f.despachador.value.trim().toUpperCase(),
        vale: f.vale.value.trim(),
        comentario: f.comentario.value.trim(),
        permitir_negativo: !!(f.permitir_negativo && f.permitir_negativo.checked),
      };
      if (m.stock - parseFloat(datos.cantidad) < 0 && !datos.permitir_negativo) {
        mostrarError("Marca la confirmación para registrar un despacho mayor al stock del sistema.");
        return;
      }
      await enviar(() => despachar({ ...datos, bloque: m._b, permitirNegativo: datos.permitir_negativo }), (r) => {
        guardar("despachador", datos.despachador);
        est.materiales.set(m.codigo, { ...r.material, codigo: m.codigo, _b: m._b });
        toast(`Despachado: ${num(r.despacho.cantidad)} ${r.despacho.um || ""} de ${m.codigo}. Stock ${num(r.material.stock)}`);
      });
    });
    setTimeout(() => f.cantidad.focus(), 60);
  }

  function abrirConteo(m) {
    est.sel = m.codigo;
    const info = m.inventariado
      ? `<div class="aviso aviso--ok">Ya contado el ${fecha(m.fecha_inventario)} por ${esc(m.responsable_inventario)}. Guardar de nuevo reemplaza ese conteo.</div>`
      : "";
    abrirHoja(`<form id="form-accion" novalidate>
      ${cabeceraHoja(`Conteo de ${esc(m.codigo)}`, `${esc(m.item_code)}, ${esc(m.um)}`)}
      <div class="hoja__cuerpo">
        ${info}
        <div class="stockbox"><div><span>En sistema</span><strong>${num(m.stock)}</strong></div>
          <div class="flecha">→</div><div><span>Contado</span><strong class="nuevo" id="stock-nuevo">?</strong></div></div>
        <div id="msg"></div>
        <label class="campo"><span>Cantidad contada (${esc(m.um)})</span>
          <span class="campo-con-boton"><input name="stock" type="number" inputmode="decimal" step="any" min="0" required autocomplete="off">
          <button type="button" class="btn btn--chico" id="igual">Igual al sistema</button></span></label>
        <label class="campo"><span>Responsable del conteo</span>
          <input name="responsable" required autocapitalize="characters" placeholder="Ej. JBERRIO" value="${val(leer("inventariador"))}"></label>
        <div class="campos-3">
          <label class="campo"><span>Storage Location</span><input name="storage_location" value="${val(m.storage_location)}" autocapitalize="characters"></label>
          <label class="campo"><span>Storage Section</span><input name="storage_section" value="${val(m.storage_section)}" autocapitalize="characters"></label>
          <label class="campo"><span>Location</span><input name="location" value="${val(m.location)}" autocapitalize="characters"></label>
        </div>
        <label class="campo"><span>Description</span>
          <textarea name="descripcion" rows="3">${val(m.descripcion)}</textarea></label>
      </div>
      <div class="hoja__pie"><button type="button" class="btn" data-cerrar>Cancelar</button>
        <button type="submit" class="btn btn--primario">Guardar conteo</button></div>
    </form>`);

    const f = $("#form-accion");
    const actualizar = () => {
      const c = parseFloat(f.stock.value);
      const el = $("#stock-nuevo");
      el.textContent = isNaN(c) ? "?" : num(c);
    };
    f.stock.addEventListener("input", actualizar);
    $("#igual").addEventListener("click", () => { f.stock.value = Math.max(0, m.stock); actualizar(); });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const datos = {
        codigo: m.codigo,
        stock: f.stock.value,
        responsable: f.responsable.value.trim().toUpperCase(),
        storage_location: f.storage_location.value.trim().toUpperCase(),
        storage_section: f.storage_section.value.trim().toUpperCase(),
        location: f.location.value.trim().toUpperCase(),
        descripcion: f.descripcion.value.trim(),
      };
      await enviar(() => contar({ ...datos, bloque: m._b }), (r) => {
        guardar("inventariador", datos.responsable);
        est.materiales.set(m.codigo, { ...r.material, codigo: m.codigo, _b: m._b });
        toast(`Conteo guardado: ${m.codigo} = ${num(r.material.stock)}`);
      });
    });
    setTimeout(() => f.stock.focus(), 60);
  }

  function abrirDetalleDespacho(d) {
    const filas = [
      ["Fecha", fecha(d.fecha)], ["Vale manual", d.vale], ["Cantidad", `${num(d.cantidad)} ${guion(d.um)}`],
      ["Despachador", d.responsable], ["Comentario", d.comentario],
      ["Stock antes / después", d.tipo === "DESPACHO" ? `${num(d.stock_antes)} → ${num(d.stock_despues)}` : "Registro histórico importado del Excel"],
    ];
    abrirHoja(`${cabeceraHoja(`Despacho de ${esc(d.codigo)}`, esc(d.descripcion))}
      <div class="hoja__cuerpo">
        <dl class="ficha">${filas.map(([k, v]) => `<div class="ancho"><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
        ${ficha(d)}
      </div>
      <div class="hoja__pie"><button type="button" class="btn" data-cerrar>Cerrar</button></div>`);
  }

  function mostrarError(msg) {
    const box = $("#msg");
    if (!box) return toast(msg);
    box.querySelector(".aviso--error")?.remove();
    box.insertAdjacentHTML("afterbegin", `<div class="aviso aviso--error" role="alert">${esc(msg)}</div>`);
    hoja.scrollTop = 0;
  }

  async function enviar(operacion, alTerminar) {
    const btn = $("#form-accion button[type=submit]");
    btn.disabled = true;
    if (!navigator.onLine) {
      mostrarError("No hay conexión a internet. El registro necesita señal para no descuadrar el stock.");
      btn.disabled = false;
      return;
    }
    try {
      const r = await operacion();
      alTerminar(r);
      hoja.close();
      refrescar(true);
    } catch (e) {
      const msg = e.code === "permission-denied"
        ? "Tu sesión no tiene permiso para guardar. Cierra sesión y vuelve a entrar."
        : e.message || "No se pudo guardar. Revisa la conexión e inténtalo otra vez.";
      mostrarError(msg);
    } finally {
      btn.disabled = false;
    }
  }

  // ------------------------------------------------------------ hoja: orden múltiple
  function abrirOrden() {
    const v = est.vista;
    let niveles = est.orden[v].map((o) => ({ ...o }));
    const opciones = (sel) => Object.entries(COLS[v]).map(([k, c]) =>
      `<option value="${k}"${k === sel ? " selected" : ""}>${c.t}</option>`).join("");
    const pintar = () => {
      $("#niveles").innerHTML = niveles.map((n, i) => `<div class="nivel" data-i="${i}">
        <span class="nivel__n">${i + 1}</span>
        <select aria-label="Columna nivel ${i + 1}">${opciones(n.c)}</select>
        <button type="button" class="btn btn--chico" data-dir>${n.d > 0 ? "A → Z" : "Z → A"}</button>
        <button type="button" class="btn btn--chico btn--plano" data-quitar aria-label="Quitar nivel"${niveles.length < 2 ? " disabled" : ""}>×</button>
      </div>`).join("");
      $("#agregar-nivel").disabled = niveles.length >= 5;
    };
    abrirHoja(`${cabeceraHoja("Ordenar lista", "El primer nivel manda; los siguientes desempatan.")}
      <div class="hoja__cuerpo">
        <div class="presets">
          <button type="button" class="btn btn--chico" data-preset="ubicacion">Por ubicación</button>
          ${v === "despachos" ? '<button type="button" class="btn btn--chico" data-preset="recientes">Más recientes</button>' : '<button type="button" class="btn btn--chico" data-preset="codigo">Por código</button>'}
        </div>
        <div id="niveles"></div>
        <button type="button" class="btn btn--chico" id="agregar-nivel">Agregar nivel</button>
      </div>
      <div class="hoja__pie"><button type="button" class="btn" data-cerrar>Cancelar</button>
        <button type="button" class="btn btn--primario" id="aplicar-orden">Aplicar orden</button></div>`);
    pintar();
    const cuerpo = $(".hoja__cuerpo", hoja);
    cuerpo.addEventListener("change", (e) => {
      const n = e.target.closest(".nivel"); if (n) niveles[+n.dataset.i].c = e.target.value;
    });
    cuerpo.addEventListener("click", (e) => {
      const n = e.target.closest(".nivel");
      if (e.target.closest("[data-dir]")) { niveles[+n.dataset.i].d *= -1; pintar(); }
      else if (e.target.closest("[data-quitar]")) { niveles.splice(+n.dataset.i, 1); pintar(); }
      else if (e.target.id === "agregar-nivel") {
        const usadas = new Set(niveles.map((x) => x.c));
        const libre = Object.keys(COLS[v]).find((k) => !usadas.has(k));
        niveles.push({ c: libre, d: 1 }); pintar();
      } else if (e.target.dataset.preset) {
        const p = e.target.dataset.preset;
        niveles = (p === "ubicacion" ? ORDEN_UBICACION : p === "recientes" ? ORDEN_RECIENTES : [{ c: "codigo", d: 1 }]).map((o) => ({ ...o }));
        pintar();
      }
    });
    $("#aplicar-orden").addEventListener("click", () => {
      est.orden[v] = niveles;
      guardar("orden_" + v, niveles);
      hoja.close();
      refrescar();
      window.scrollTo(0, 0);
    });
  }

  // ------------------------------------------------------------ exportar
  async function exportar(fmt) {
    $("#menu-exportar").classList.add("oculto");
    const filas = est.visibles;
    if (!filas.length) return toast("No hay filas para exportar con el filtro actual.");
    toast(`Generando ${fmt === "xlsx" ? "Excel" : "PDF"} con ${filas.length} filas…`);
    try {
      if (fmt === "xlsx") await exportarExcel(est.vista, filas);
      else await exportarPDF(est.vista, filas);
    } catch (e) {
      toast(e.message || "No se pudo generar el archivo.");
    }
  }

  // ------------------------------------------------------------ eventos
  function cambiarVista(v) {
    est.vista = v;
    document.querySelectorAll(".pestana").forEach((p) => p.setAttribute("aria-selected", p.dataset.vista === v));
    $("#progreso")?.classList.toggle("oculto", v !== "materiales");
    $("#buscador").placeholder = v === "materiales"
      ? "Código, item, descripción o ubicación"
      : "Código, vale, despachador o comentario";
    dibujarChips();
    refrescar();
    window.scrollTo(0, 0);
  }

  let tBusqueda;
  $("#buscador").addEventListener("input", (e) => {
    clearTimeout(tBusqueda);
    tBusqueda = setTimeout(() => { est.q = e.target.value; refrescar(); }, 180);
  });
  $("#filtros").addEventListener("click", (e) => {
    const c = e.target.closest(".chip"); if (!c) return;
    est.filtro[est.vista] = c.dataset.filtro;
    dibujarChips(); refrescar();
  });
  $("#lista").addEventListener("click", (e) => {
    const f = e.target.closest(".fila"); if (!f) return;
    if (est.vista === "despachos") return abrirDetalleDespacho(est.despachos.get(f.dataset.id));
    const m = est.materiales.get(f.dataset.id);
    if (ROL === "despacho") abrirDespacho(m); else abrirConteo(m);
  });
  document.querySelectorAll(".pestana").forEach((p) => p.addEventListener("click", () => cambiarVista(p.dataset.vista)));
  $("#btn-ordenar").addEventListener("click", abrirOrden);
  $("#btn-exportar").addEventListener("click", (e) => { e.stopPropagation(); $("#menu-exportar").classList.toggle("oculto"); });
  $("#menu-exportar").addEventListener("click", (e) => { const b = e.target.closest("[data-fmt]"); if (b) exportar(b.dataset.fmt); });
  document.addEventListener("click", () => $("#menu-exportar").classList.add("oculto"));

  new IntersectionObserver((ents) => { if (ents[0].isIntersecting) dibujarMas(); }, { rootMargin: "600px" })
    .observe($("#centinela"));

  hoja.addEventListener("close", () => { if (est.pendiente) { est.pendiente = false; refrescar(true); } });
  $("#btn-salir").addEventListener("click", cerrarSesion);

  const usuario = await exigirSesion();
  $("#usuario").textContent = nombreUsuario(usuario);
  cambiarVista("materiales");
  escucharMateriales(alCambiarMateriales, estadoConexion);
  if (ROL === "despacho") escucharDespachos(alCambiarDespachos, estadoConexion);
})();
