/* ============================================================
   ZAZI — puente con Shopify (Cloudflare Worker)
   Versión 5: guarda una copia de los artículos activos de Shopify y se la da
   a la página de etiquetas (zazi-pe.github.io/Etiquetas).
   Solo lectura: no crea ni cambia productos en Shopify (solo registra sus propios webhooks).

   Configuración en Cloudflare:
     Variables  SHOPIFY_TIENDA          dirección .myshopify.com de la tienda (sin https://)
                SHOPIFY_CLIENT_ID       Client ID de la app "ZAZI etiquetas" (Dev Dashboard)
     Secretos   SHOPIFY_CLIENT_SECRET   Secret de esa app (también firma los webhooks)
                CLAVE                   contraseña para usar este worker
     Enlace KV  CATALOGO                donde se guardan la copia y el token
     Cron       0 8 * * *               actualización completa cada noche (3 a. m. en Lima)

   Direcciones (con la clave en la cabecera X-Clave o en ?clave=):
     GET  /articulos      la copia guardada (si no hay copia o es de más de 24 h, la descarga)
     POST /actualizar     descarga todo de nuevo ahora
     GET  /diagnostico    resumen de la copia y conteos en vivo
     GET  /webhooks       webhooks registrados;  POST /webhooks  los registra
   Webhooks de Shopify (productos creados, cambiados o eliminados):
     POST /shopify/webhook   (firmados por Shopify; se comprueba la firma)
   ============================================================ */

const VERSION_API = "2026-10";
const ORIGENES = ["https://zazi-pe.github.io"];      // páginas que pueden pedir el catálogo
const VIGENCIA = 24 * 3600 * 1000;                   // una copia de más de 24 h se renueva
const CLAVE_KV = "catalogo";
const CLAVE_TOKEN = "token-shopify";
const FORMATO = 3;                                   // sube cuando cambia lo que se guarda (3 = Shopify)
const TEMAS = ["PRODUCTS_CREATE", "PRODUCTS_UPDATE", "PRODUCTS_DELETE"];
const RUTA_WEBHOOK = "/shopify/webhook";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = cabecerasCors(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname === "/") return texto("ZAZI Shopify: activo.");

    // Webhooks de Shopify: se comprueba la firma antes de hacer nada
    if (url.pathname === RUTA_WEBHOOK) {
      if (request.method !== "POST") return json({ error: "No existe." }, 404);
      const cuerpo = await request.text();
      if (!(await firmaValida(env, cuerpo, request.headers.get("X-Shopify-Hmac-Sha256")))) return json({ error: "Firma no válida." }, 401);
      const tienda = request.headers.get("X-Shopify-Shop-Domain");
      if (tienda && env.SHOPIFY_TIENDA && tienda !== env.SHOPIFY_TIENDA) return json({ ok: true });   // otra tienda: se ignora
      let aviso = null;
      try { aviso = JSON.parse(cuerpo); } catch (e) { /* cuerpo vacío o mal escrito */ }
      const tema = request.headers.get("X-Shopify-Topic") || "";
      ctx.waitUntil(procesarWebhook(env, tema, aviso).catch((e) => console.log("webhook", String(e))));
      return json({ ok: true });                     // se responde enseguida; el trabajo sigue aparte
    }

    const clave = request.headers.get("X-Clave") || url.searchParams.get("clave");
    if (!env.CLAVE || clave !== env.CLAVE) return json({ error: "Clave incorrecta." }, 401, cors);
    const falta = ["SHOPIFY_TIENDA", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET"].find((n) => !env[n]);
    if (falta) return json({ error: "Falta la configuración " + falta + "." }, 500, cors);
    if (!env.CATALOGO) return json({ error: "Falta el enlace KV CATALOGO." }, 500, cors);

    try {
      if (url.pathname === "/articulos" && request.method === "GET") {
        let c = await leer(env);
        if (!c || c.v !== FORMATO || Date.now() - c.actualizado > VIGENCIA) c = await descargar(env);
        return json(paraPagina(c), 200, cors);
      }
      if (url.pathname === "/actualizar" && (request.method === "POST" || request.method === "GET")) {
        return json(paraPagina(await descargar(env)), 200, cors);
      }
      if (url.pathname === "/diagnostico") return json(await diagnostico(env), 200, cors);
      if (url.pathname === "/webhooks") {
        if (request.method === "POST") return json(await registrarWebhooks(env, url.origin + RUTA_WEBHOOK), 200, cors);
        return json(await listarWebhooks(env), 200, cors);
      }
    } catch (e) {
      return json({ error: "No se pudo leer Shopify: " + String(e.message || e) }, 502, cors);
    }
    return json({ error: "Esta dirección no existe." }, 404, cors);
  },

  // Cron: actualización completa cada noche (por si se perdió algún webhook)
  async scheduled(evento, env, ctx) {
    ctx.waitUntil(descargar(env));
  }
};

/* ---------- Cabeceras ---------- */
function cabecerasCors(request) {
  const origen = request.headers.get("Origin");
  if (!origen || !ORIGENES.includes(origen)) return {};
  return {
    "Access-Control-Allow-Origin": origen,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "X-Clave",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
const json = (datos, estado = 200, extra = {}) => new Response(JSON.stringify(datos), {
  status: estado, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra }
});
const texto = (t) => new Response(t, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Shopify: token y consultas ----------
   El token sale de la app (client credentials) y dura 24 h; se guarda en KV para no pedirlo cada vez. */
let tokenEnMemoria = null;                           // { t, vence } mientras viva esta instancia

async function token(env, nuevo) {
  const ahora = Date.now();
  if (!nuevo && tokenEnMemoria && tokenEnMemoria.vence - ahora > 5 * 60 * 1000) return tokenEnMemoria.t;
  if (!nuevo) {
    const g = await env.CATALOGO.get(CLAVE_TOKEN, "json");
    if (g && g.vence - ahora > 5 * 60 * 1000) { tokenEnMemoria = g; return g.t; }
  }
  const r = await fetch(`https://${env.SHOPIFY_TIENDA}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: env.SHOPIFY_CLIENT_ID, client_secret: env.SHOPIFY_CLIENT_SECRET })
  });
  if (!r.ok) throw new Error(`Shopify no dio el token (${r.status})`);
  const d = await r.json();
  const segundos = Number(d.expires_in) || 86399;
  tokenEnMemoria = { t: d.access_token, vence: ahora + segundos * 1000 };
  await env.CATALOGO.put(CLAVE_TOKEN, JSON.stringify(tokenEnMemoria), { expirationTtl: Math.max(60, segundos - 600) });
  return tokenEnMemoria.t;
}

async function shopify(env, consulta, variables, reintento) {
  const r = await fetch(`https://${env.SHOPIFY_TIENDA}/admin/api/${VERSION_API}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-Shopify-Access-Token": await token(env, reintento === "token") },
    body: JSON.stringify({ query: consulta, variables: variables || {} })
  });
  if (r.status === 401 && reintento !== "token") return shopify(env, consulta, variables, "token");   // token vencido: otro
  if (!r.ok) throw new Error(`Shopify respondió ${r.status}`);
  const d = await r.json();
  if (d.errors && d.errors.length) {
    const limite = d.errors.some((e) => e.extensions && e.extensions.code === "THROTTLED");
    if (limite && reintento !== "limite") { await esperar(2000); return shopify(env, consulta, variables, "limite"); }
    throw new Error(d.errors.map((e) => e.message).join("; "));
  }
  return d.data;
}

const numero = (gid) => String(gid || "").split("/").pop();   // gid://shopify/Product/123 -> "123"

/* ---------- La copia guardada ----------
   { v, actualizado, productos: {id: {n, t}}, articulos: {idVariante: {c, s, p, co, ta}} }
   n = nombre, t = tipo (productType), c = código de barras, s = SKU, p = id del producto, co = color, ta = talla */
const leer = (env) => env.CATALOGO.get(CLAVE_KV, "json");
const guardar = (env, c) => env.CATALOGO.put(CLAVE_KV, JSON.stringify(c));

// Lo que recibe la página: la misma lista que con Bsale
function paraPagina(c) {
  const articulos = [];
  for (const id in c.articulos) {
    const a = c.articulos[id], p = c.productos[a.p];
    if (!p || !a.c) continue;
    articulos.push({ codigo: a.c, sku: a.s || "", nombre: p.n, tipo: p.t || "", color: a.co, talla: a.ta });
  }
  return { actualizado: c.actualizado, articulos };
}

// Opciones de la variante -> { co, ta }  (se leen por el nombre de la opción: "Color" y "Talla")
function colorYTalla(opciones) {
  const r = { co: "", ta: "" };
  (opciones || []).forEach((o) => {
    const n = String(o.name || "").trim().toLowerCase();
    if (n === "color") r.co = String(o.value || "").trim();
    else if (n === "talla") r.ta = String(o.value || "").trim();
  });
  return r;
}
const aProducto = (p) => ({ n: String(p.title || "").trim(), t: String(p.productType || "").trim() });
const aArticulo = (v, pid, codigo) => ({ c: String(codigo || "").trim(), s: String(v.sku || "").trim(), p: pid, ...colorYTalla(v.selectedOptions) });

/* ---------- Descarga completa (operación masiva de Shopify) ----------
   Shopify arma un archivo con todas las variantes activas; se espera a que termine y se lee.
   Así no importa el límite de costo por consulta. Unas 10 a 40 peticiones en total. */
const CONSULTA_MASIVA = `{
  productVariants(query: "product_status:active") {
    edges { node {
      id sku
      selectedOptions { name value }
      product { id title productType status }
      barcodes { edges { node { value } } }
    } }
  }
}`;

async function descargar(env) {
  const inicio = await shopify(env, `mutation($q: String!) {
    bulkOperationRunQuery(query: $q, groupObjects: false) { bulkOperation { id status } userErrors { field message } }
  }`, { q: CONSULTA_MASIVA });
  const res = inicio.bulkOperationRunQuery;
  if (res.userErrors && res.userErrors.length) throw new Error(res.userErrors.map((e) => e.message).join("; "));
  const id = res.bulkOperation.id;

  let op = null;
  for (let i = 0; i < 40; i++) {                     // hasta ~75 s; normalmente unos segundos
    await esperar(i < 5 ? 1000 : 2000);
    op = (await shopify(env, `query($id: ID!) { bulkOperation(id: $id) { status errorCode url } }`, { id })).bulkOperation;
    if (op && !["CREATED", "RUNNING"].includes(op.status)) break;
  }
  if (!op || op.status !== "COMPLETED") throw new Error("La descarga masiva no terminó (" + (op ? op.status + (op.errorCode ? " " + op.errorCode : "") : "sin estado") + ")");

  const c = { v: FORMATO, actualizado: 0, productos: {}, articulos: {} };
  if (op.url) {                                       // sin url = no hay variantes
    const r = await fetch(op.url);
    if (!r.ok) throw new Error(`No se pudo bajar el archivo de Shopify (${r.status})`);
    leerJsonl(c, await r.text());
  }
  c.actualizado = Date.now();
  await guardar(env, c);
  return c;
}

// Cada línea es una variante, o un código de barras con __parentId = la variante a la que pertenece
function leerJsonl(c, textoJsonl) {
  const codigos = {};
  textoJsonl.split("\n").forEach((linea) => {
    if (!linea.trim()) return;
    const o = JSON.parse(linea);
    if (o.__parentId) {
      const vid = numero(o.__parentId);
      if (!codigos[vid] && o.value) codigos[vid] = o.value;     // el primer código de la variante
      return;
    }
    if (!o.product || o.product.status !== "ACTIVE") return;
    const pid = numero(o.product.id);
    c.productos[pid] = aProducto(o.product);
    c.articulos[numero(o.id)] = aArticulo(o, pid, "");
  });
  for (const vid in codigos) if (c.articulos[vid]) c.articulos[vid].c = String(codigos[vid]).trim();
}

/* ---------- Webhooks: solo se usa el id; el producto se lee de nuevo desde Shopify ---------- */
async function firmaValida(env, cuerpo, firma) {
  if (!env.SHOPIFY_CLIENT_SECRET || !firma) return false;
  const llave = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SHOPIFY_CLIENT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", llave, new TextEncoder().encode(cuerpo)));
  const calculada = btoa(String.fromCharCode(...bytes));
  if (calculada.length !== firma.length) return false;
  let dif = 0;
  for (let i = 0; i < calculada.length; i++) dif |= calculada.charCodeAt(i) ^ firma.charCodeAt(i);
  return dif === 0;
}

const CONSULTA_PRODUCTO = `query($id: ID!) {
  product(id: $id) {
    id title productType status
    variants(first: 100) {
      pageInfo { hasNextPage }
      nodes { id sku selectedOptions { name value } barcodes(first: 1) { nodes { value } } }
    }
  }
}`;

async function procesarWebhook(env, tema, aviso) {
  if (!aviso || !/^\d+$/.test(String(aviso.id || ""))) return;
  if (!["products/create", "products/update", "products/delete"].includes(tema)) return;
  const pid = String(aviso.id);
  const c = await leer(env);
  if (!c || c.v !== FORMATO) { await descargar(env); return; }
  const antes = JSON.stringify([c.productos[pid] || null, variantesDe(c, pid)]);

  // Primero se quitan el producto y sus variantes; luego se vuelven a poner si sigue activo
  delete c.productos[pid];
  for (const k in c.articulos) if (c.articulos[k].p === pid) delete c.articulos[k];

  if (tema !== "products/delete") {
    const p = (await shopify(env, CONSULTA_PRODUCTO, { id: "gid://shopify/Product/" + pid })).product;
    if (p && p.status === "ACTIVE") {
      if (p.variants.pageInfo.hasNextPage) { await descargar(env); return; }   // más de 100 variantes: todo de nuevo
      c.productos[pid] = aProducto(p);
      p.variants.nodes.forEach((v) => {
        const codigo = v.barcodes && v.barcodes.nodes[0] ? v.barcodes.nodes[0].value : "";
        c.articulos[numero(v.id)] = aArticulo(v, pid, codigo);
      });
    }
  }
  // Solo se escribe si cambió algo que importa a las etiquetas (stock y precio no se guardan aquí)
  if (JSON.stringify([c.productos[pid] || null, variantesDe(c, pid)]) === antes) return;
  await guardar(env, c);
}
function variantesDe(c, pid) {
  return Object.keys(c.articulos).filter((k) => c.articulos[k].p === pid).sort().map((k) => [k, c.articulos[k]]);
}

/* ---------- /webhooks: ver y registrar los webhooks de la app ---------- */
async function listarWebhooks(env) {
  const d = await shopify(env, `{ webhookSubscriptions(first: 50) { nodes { id topic uri } } }`);
  return { webhooks: d.webhookSubscriptions.nodes.map((w) => ({ tema: w.topic, direccion: w.uri })) };
}
async function registrarWebhooks(env, direccion) {
  const actuales = (await shopify(env, `{ webhookSubscriptions(first: 50) { nodes { topic uri } } }`)).webhookSubscriptions.nodes;
  const resultado = [];
  for (const tema of TEMAS) {
    if (actuales.some((w) => w.topic === tema && w.uri === direccion)) { resultado.push({ tema, estado: "ya estaba" }); continue; }
    const d = await shopify(env, `mutation($t: WebhookSubscriptionTopic!, $u: String!) {
      webhookSubscriptionCreate(topic: $t, webhookSubscription: { uri: $u, format: JSON }) { webhookSubscription { id } userErrors { message } }
    }`, { t: tema, u: direccion });
    const e = d.webhookSubscriptionCreate.userErrors;
    resultado.push({ tema, estado: e && e.length ? "error: " + e.map((x) => x.message).join("; ") : "registrado" });
  }
  return { direccion, resultado };
}

/* ---------- /diagnostico ---------- */
async function diagnostico(env) {
  const c = await leer(env);
  const d = await shopify(env, `{
    shop { name }
    productos: productsCount(query: "status:active") { count }
    variantes: productVariantsCount(query: "product_status:active") { count }
  }`);
  return {
    copiaGuardada: c && c.v === FORMATO ? { actualizado: new Date(c.actualizado).toISOString(), productos: Object.keys(c.productos).length, variantes: Object.keys(c.articulos).length } : null,
    tienda: d.shop.name,
    productosActivos: d.productos.count,
    variantesActivas: d.variantes.count
  };
}
