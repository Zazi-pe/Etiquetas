/* ============================================================
   ZAZI — puente con Bsale (Cloudflare Worker)
   Versión 4 (envía también el SKU): guarda una copia del catálogo activo de Bsale y se la da
   a la página de etiquetas (zazi-pe.github.io/Etiquetas).
   Solo lectura: no crea ni cambia nada en Bsale.

   Configuración en Cloudflare:
     Secretos  BSALE_TOKEN   access_token de Bsale
               CLAVE         contraseña para usar este worker
               WEBHOOK       palabra secreta para la dirección de los webhooks (opcional)
     Enlace KV CATALOGO      donde se guarda la copia del catálogo
     Cron      0 8 * * *     actualización completa cada noche (3 a. m. en Lima)

   Direcciones (con la clave en la cabecera X-Clave o en ?clave=):
     GET  /articulos      el catálogo guardado (si no hay copia o es de más de 24 h, lo descarga)
     POST /actualizar     descarga el catálogo de nuevo ahora
     GET  /diagnostico    muestras de cómo vienen los datos
   Webhooks de Bsale (productos y variantes):
     POST /bsale/<WEBHOOK>
   ============================================================ */

const BSALE = "https://api.bsale.io";
const ORIGENES = ["https://zazi-pe.github.io"];      // páginas que pueden pedir el catálogo
const POR_PAGINA = 50;                               // máximo que permite Bsale
const A_LA_VEZ = 6;                                  // consultas en paralelo
const VIGENCIA = 24 * 3600 * 1000;                   // una copia de más de 24 h se renueva
const CLAVE_KV = "catalogo";
const FORMATO = 2;                                   // sube cuando cambia lo que se guarda (2 = con SKU)

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = cabecerasCors(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname === "/") return texto("ZAZI Bsale: activo.");

    // Webhooks de Bsale: la dirección lleva la palabra secreta
    if (url.pathname.startsWith("/bsale/")) {
      if (!env.WEBHOOK || url.pathname !== "/bsale/" + env.WEBHOOK || request.method !== "POST") return json({ error: "No existe." }, 404);
      let aviso = null;
      try { aviso = await request.json(); } catch (e) { /* cuerpo vacío o mal escrito */ }
      ctx.waitUntil(procesarWebhook(env, aviso).catch((e) => console.log("webhook", String(e))));
      return json({ ok: true });                     // se responde enseguida; el trabajo sigue aparte
    }

    const clave = request.headers.get("X-Clave") || url.searchParams.get("clave");
    if (!env.CLAVE || clave !== env.CLAVE) return json({ error: "Clave incorrecta." }, 401, cors);
    if (!env.BSALE_TOKEN) return json({ error: "Falta el secreto BSALE_TOKEN." }, 500, cors);
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
    } catch (e) {
      return json({ error: "No se pudo leer Bsale: " + String(e.message || e) }, 502, cors);
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

/* ---------- Bsale ---------- */
async function bsale(env, ruta) {
  const r = await fetch(BSALE + ruta, { headers: { access_token: env.BSALE_TOKEN, Accept: "application/json" } });
  if (!r.ok) throw new Error(`Bsale respondió ${r.status} en ${ruta.split("?")[0]}`);
  return r.json();
}
async function enGrupos(env, rutas) {
  const salida = [];
  for (let i = 0; i < rutas.length; i += A_LA_VEZ) salida.push(...await Promise.all(rutas.slice(i, i + A_LA_VEZ).map((r) => bsale(env, r))));
  return salida;
}
const items = (d) => (d && Array.isArray(d.items) ? d.items : []);
const paginas = (ruta, total) => Array.from({ length: Math.ceil(total / POR_PAGINA) }, (_, i) => `${ruta}&limit=${POR_PAGINA}&offset=${i * POR_PAGINA}`);

/* ---------- El catálogo guardado ----------
   { v, actualizado, tipos: {id: nombre}, atributos: {id: "color"|"talla"},
     productos: {id: {n, t}}, articulos: {idVariante: {c, s, p, co, ta}} } */
const leer = (env) => env.CATALOGO.get(CLAVE_KV, "json");
const guardar = (env, c) => env.CATALOGO.put(CLAVE_KV, JSON.stringify(c));

// Lo que recibe la página: una lista lista para buscar (unas 41 consultas a Bsale para armarlo)
function paraPagina(c) {
  const articulos = [];
  for (const id in c.articulos) {
    const a = c.articulos[id], p = c.productos[a.p];
    if (!p || !a.c) continue;
    articulos.push({ codigo: a.c, sku: a.s || "", nombre: p.n, tipo: c.tipos[p.t] || "", color: a.co, talla: a.ta });
  }
  return { actualizado: c.actualizado, articulos };
}

// Atributos de una variante -> { color, talla }
function colorYTalla(c, v) {
  const r = { color: "", talla: "" };
  ((v.attribute_values && v.attribute_values.items) || []).forEach((x) => {
    const tipo = c.atributos[String(x.attribute && x.attribute.id)];
    if (tipo) r[tipo] = String(x.description || "").trim();
  });
  return r;
}
const aArticulo = (c, v) => {
  const ct = colorYTalla(c, v);
  return { c: String(v.barCode || "").trim(), s: String(v.code || "").trim(), p: String(v.product && v.product.id), co: ct.color, ta: ct.talla };
};

/* ---------- Descarga completa ---------- */
async function descargar(env) {
  const c = { v: FORMATO, actualizado: 0, tipos: {}, atributos: {}, productos: {}, articulos: {} };

  items(await bsale(env, "/v1/product_types.json?limit=50")).forEach((t) => { c.tipos[String(t.id)] = t.name; });
  (await enGrupos(env, Object.keys(c.tipos).map((id) => `/v1/product_types/${id}/attributes.json?limit=50`)))
    .forEach((d) => items(d).forEach((a) => {
      const n = String(a.name || "").trim().toLowerCase();
      if (n === "color" || n === "talla") c.atributos[String(a.id)] = n;
    }));

  const nProd = (await bsale(env, "/v1/products/count.json?state=0")).count || 0;
  (await enGrupos(env, paginas("/v1/products.json?state=0", nProd)))
    .forEach((d) => items(d).forEach((p) => {
      c.productos[String(p.id)] = { n: String(p.name || "").trim(), t: String(p.product_type && p.product_type.id || "") };
    }));

  const nVar = (await bsale(env, "/v1/variants/count.json?state=0")).count || 0;
  (await enGrupos(env, paginas("/v1/variants.json?state=0&expand=[attribute_values]", nVar)))
    .forEach((d) => items(d).forEach((v) => { c.articulos[String(v.id)] = aArticulo(c, v); }));

  c.actualizado = Date.now();
  await guardar(env, c);
  return c;
}

/* ---------- Webhooks: solo se usa el id; los datos se leen de nuevo desde Bsale ---------- */
async function procesarWebhook(env, aviso) {
  if (!aviso || !aviso.resourceId || !/^\d+$/.test(String(aviso.resourceId))) return;
  if (env.CPN_ID && String(aviso.cpnId) !== String(env.CPN_ID)) return;     // solo nuestra empresa
  const id = String(aviso.resourceId);
  let c = await leer(env);
  if (!c || c.v !== FORMATO) { await descargar(env); return; }

  if (aviso.topic === "variant") {
    const v = await bsale(env, `/v1/variants/${id}.json?expand=[attribute_values]`);
    if (Number(v.state) !== 0) delete c.articulos[id];                         // desactivada
    else {
      const pid = String(v.product && v.product.id);
      if (!c.productos[pid]) {                                               // producto nuevo
        const p = await bsale(env, `/v1/products/${pid}.json`);
        c.productos[pid] = { n: String(p.name || "").trim(), t: String(p.product_type && p.product_type.id || "") };
      }
      const a = aArticulo(c, v);
      if (!a.co && !a.ta) { await descargar(env); return; }                  // tipo o atributo nuevo: todo de nuevo
      c.articulos[id] = a;
    }
  } else if (aviso.topic === "product") {
    const p = await bsale(env, `/v1/products/${id}.json`);
    if (Number(p.state) !== 0) {                                             // producto desactivado: fuera sus variantes
      delete c.productos[id];
      for (const k in c.articulos) if (c.articulos[k].p === id) delete c.articulos[k];
    } else {
      const t = String(p.product_type && p.product_type.id || "");
      if (!c.tipos[t]) { await descargar(env); return; }                     // tipo nuevo: todo de nuevo
      c.productos[id] = { n: String(p.name || "").trim(), t };
    }
  } else return;
  await guardar(env, c);
}

/* ---------- /diagnostico ---------- */
async function diagnostico(env) {
  const c = await leer(env);
  return {
    copiaGuardada: c ? { actualizado: new Date(c.actualizado).toISOString(), productos: Object.keys(c.productos).length, variantes: Object.keys(c.articulos).length } : null,
    cantidadProductos: await bsale(env, "/v1/products/count.json?state=0"),
    cantidadVariantes: await bsale(env, "/v1/variants/count.json?state=0"),
    sucursales: items(await bsale(env, "/v1/offices.json")).map((o) => ({ id: o.id, nombre: o.name }))
  };
}
