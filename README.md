# Surplus Patio Komatsu (GitHub Pages + Firebase)

Página web para inventario y despacho de materiales. Las pantallas se publican en GitHub Pages y los datos viven en Firebase (Firestore), igual que el recorrido del Señor de los Milagros.

Todos los archivos van en la raíz del repositorio (sin carpetas), para que se puedan subir fácil desde la tablet.

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Login y menú (Despacho, Inventario, Cargar datos) |
| `despacho.html` / `inventario.html` | Las dos pantallas de trabajo |
| `cargar.html` | Carga del Excel a Firebase desde la tablet |
| `config.js` | **Aquí se pega la configuración de Firebase** |
| `datos.js`, `app.js`, `excel.js`, `app.css` | Lógica y estilos |
| `firestore.rules` | Reglas de seguridad para pegar en Firebase |

## 1. Firebase (console.firebase.google.com)

1. Crea un proyecto nuevo, por ejemplo `surplus-komatsu` (Analytics no hace falta).
2. **Firestore Database** > Crear base de datos > modo producción. Ubicación sugerida: `southamerica-east1`.
3. Firestore > pestaña **Reglas**: borra lo que haya, pega el contenido de `firestore.rules` y presiona Publicar.
4. **Authentication** > Comenzar > **Correo electrónico/contraseña** > Habilitar.
5. Authentication > **Usuarios** > Agregar usuario:
   - Correo: `cvalmacen3@surplus-komatsu.app`
   - Contraseña: la del almacén
   En la página se escribe solo `cvalmacen3`; el resto lo agrega la app.
6. Engranaje > **Configuración del proyecto** > Tus apps > ícono web `</>` > registra la app y copia el bloque `firebaseConfig`. Pégalo en `config.js` reemplazando los `PEGAR_AQUI`.

La contraseña no está escrita en ningún archivo: la valida Firebase. Los datos de `config.js` sí son públicos, y eso es normal; lo que protege la información son las reglas del paso 3, que solo dejan leer y escribir al usuario `cvalmacen3`.

## 2. GitHub Pages

1. Crea un repositorio nuevo, por ejemplo `surplus-komatsu`.
2. *Add file* > *Upload files* y sube todos los archivos (ya con `config.js` editado).
3. *Settings* > *Pages* > Branch `main`, carpeta `/ (root)` > Save.
4. En un par de minutos queda en `https://TU-USUARIO.github.io/surplus-komatsu/`.

**No subas el Excel al repositorio**: GitHub Pages es público. El Excel solo se usa desde la tablet en el paso 3.

## 3. Cargar los datos desde la tablet

1. Ten el Excel en la tablet (Descargas o Google Drive).
2. Abre la página, ingresa con `cvalmacen3` y toca **Cargar datos desde Excel**.
3. Elige el archivo. La página muestra cuántos materiales y despachos históricos encontró, con una muestra.
4. Elige **Carga inicial** y toca **Cargar a Firebase**. Marca *Incluir historial* solo si quieres los despachos antiguos del Excel. Toma menos de un minuto.

Qué se carga:

- Lista oficial desde la hoja `STOCK`, con **SALDO** como stock actual (la columna STOCK se ignora): 3063 materiales.
- Historial de la hoja `DESCARGAR DESPACHO` (999 registros) como *histórico*. No vuelve a descontar stock porque SALDO ya lo incluye.

### Carga masiva de despachos

En *Cargar datos* toca **Descargar plantilla de despachos** (hoja `DESPACHOS`). Obligatorios: CODIGO, FECHA (dd/mm/aaaa) y CANTIDAD; lo demás del material se completa desde la lista oficial. Al subirla eliges:

- **Solo registrar, sin tocar el stock**: para salidas que el stock ya descontó.
- **Registrar y descontar del stock actual**: para salidas que todavía no se restaron (se aplican en orden de fecha).

La página muestra antes cuántos están listos, cuáles ya estaban cargados (no se duplican si subes el mismo archivo dos veces), qué códigos no existen y qué filas tienen errores.

### Carga masiva de materiales nuevos (después)

En *Cargar datos* toca **Descargar plantilla**, llénala (una fila por material) y súbela con la opción **Agregar solo materiales nuevos**. Los códigos que ya existen no se tocan. También sirve volver a subir el Excel original con filas nuevas agregadas en la hoja STOCK.

## Cómo se guardan los datos (y por qué)

El plan gratuito de Firestore da unas 50 000 lecturas y 20 000 escrituras al día. Si cada material fuera un documento, abrir la lista gastaría 3000 lecturas. Por eso se agrupan:

| Colección | Documentos | Contenido |
|---|---|---|
| `materiales` | `b000`, `b001`… (13 en total) | 250 materiales cada uno |
| `despachos` | `2026-10`, `2026-11`… y `hist-2020`… | Despachos del mes, historial por año |
| `conteos` | `2026-10`… | Registro de cada conteo con lo que cambió |

Abrir una pantalla cuesta unas 20 lecturas; cada despacho o conteo, 2 escrituras. Alcanza de sobra para el uso diario.

## Reglas de stock

- **Conteo de inventario**: el stock pasa a ser lo contado y la fila queda en verde.
- **Despacho**: stock nuevo = stock actual − cantidad.
- Cada operación es una transacción: dos despachos simultáneos del mismo material no se pisan.
- Registrar un despacho o conteo necesita señal. Sin señal la lista sigue visible con los últimos datos guardados en la tablet.
- Si un despacho deja el stock en negativo, la app pide confirmar que el material salió físicamente.
- Vale manual con formato `nn-año` (ej. `15-2024`); `2024-15` se reordena solo.

## Pendiente

- Anular un despacho mal digitado (hoy se corrige con un reconteo).
- Reiniciar la campaña de inventario (volver todas las filas a rojo).
