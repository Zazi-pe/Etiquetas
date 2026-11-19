# zazi-shopify worker — how it works

Cloudflare Worker (free plan) that bridges **Shopify** and ZAZI's label page
(`https://zazi-pe.github.io/Etiquetas/`). Code: `zazi-worker.js` (version 6). It replaces the Bsale
worker (version 4, in this file's git history) and keeps the same answer for the page.
It **never edits or deletes existing products**. It creates only: its own webhook subscriptions, and new
models sent by the page's "Nuevos modelos" tool (`POST /crear`).

## What it does
1. Downloads every variant of the active Shopify products with a **bulk operation** (Shopify builds one
   file with everything; the worker waits for it and reads it). This avoids the per-query cost limit:
   paging 1,400+ variants normally would take about a minute on the Standard plan.
2. Saves a compact copy in Cloudflare KV.
3. Serves it to the label page as the same flat list as before:
   `{ actualizado, articulos: [{ codigo, sku, nombre, tipo, color, talla }] }`
   - `codigo` = the variant's first barcode, `sku` = variant SKU
   - `nombre` = product title, `tipo` = product type (Zapatillas, Botines…)
   - `color` / `talla` = the variant options named exactly **Color** and **Talla** (never parsed from the title)
   - variants without a barcode are left out of the list (same rule as with Bsale).
4. Keeps the copy fresh three ways: nightly cron, `/actualizar`, and Shopify webhooks.

## Configuration (Cloudflare dashboard)
| Name | Kind | Purpose |
|---|---|---|
| `SHOPIFY_TIENDA` | Variable | The store's `xxxx.myshopify.com` address, without `https://` |
| `SHOPIFY_CLIENT_ID` | Variable | Client ID of the Shopify app (Dev Dashboard) |
| `SHOPIFY_CLIENT_SECRET` | Secret | Client secret of that app. Also used to check webhook signatures |
| `CLAVE` | Secret | Password the page/tests must send (header `X-Clave` or `?clave=`) |
| `CATALOGO` | KV binding | Namespace `zazi-catalogo`; keys `catalogo` (the copy) and `token-shopify` (the access token) |
| Cron `0 8 * * *` | Trigger | Full download every night (3 a.m. Lima) |

Values live only in Cloudflare; never write them into code or docs.

**Access token:** the worker asks Shopify for one with the app's client ID and secret
(client credentials grant). It lasts 24 h and is kept in KV, so a new one is requested about once a day.
If Shopify rejects it (401), the worker asks for a new one and retries once.

## Endpoints
- `GET /` → "ZAZI Shopify: activo." (no key needed)
- `GET /articulos` → the saved copy. Downloads first if there's no copy, it's older than 24 h,
  or its format version `v` ≠ `FORMATO` (currently 3 = Shopify).
- `GET|POST /actualizar` → full download now, returns the same shape.
- `GET /diagnostico` → saved-copy summary + live product/variant counts.
- `POST /crear` → creates new models (see below). Body `{ modelos: [...] }`, at most 10 per call.
- `GET /webhooks` → the app's webhook subscriptions. `POST /webhooks` → registers the missing ones
  (`PRODUCTS_CREATE`, `PRODUCTS_UPDATE`, `PRODUCTS_DELETE`) pointing at this worker's `/shopify/webhook`.
- `POST /shopify/webhook` → Shopify notices. The `X-Shopify-Hmac-Sha256` signature is checked with the
  client secret (invalid → 401); notices from another store are ignored. Replies 200 immediately; the work
  continues in `ctx.waitUntil`.
- `scheduled()` → the cron: full download.
- CORS: only origin `https://zazi-pe.github.io` (allowed header `X-Clave`).

## Webhooks (`procesarWebhook`)
Only the product `id` from the notice is used; the product is always re-read from Shopify.
- `products/create` / `products/update`: the product's variants are replaced with what Shopify has now.
  If the product is no longer ACTIVE (draft or archived), it and its variants are removed.
- `products/delete`: the product and its variants are removed.
- **KV is written only if something the labels use changed** (name, type, SKU, barcode, color, size).
  `products/update` also fires for price or stock edits; those don't cost a KV write.
- A product with more than 100 variants, or a missing/old-format copy → full download.

## Creating models (`POST /crear`)
Body: `{ modelos: [{ nombre, tipo, marca, variantes: [{ color, talla, codigo, sku, stock, costo, precio }] }] }`
(one variant per color + size; `costo` without IGV; `precio` is the sale price). Answer:
`{ resultados: [{ nombre, ok, errores, avisos, articulos: [{ codigo, sku, nombre, tipo, color, talla, stock }] }] }`.
- **Checks (errors skip that model, the rest go on):** name and type required; color, size and price > 0 per row;
  stock a whole number ≥ 0 (empty = 0); no repeated color + size; a given barcode or SKU must not exist in the
  saved copy, earlier in the same call, or in another row of the model; **a model that already exists is never
  touched** (checked against the saved copy and live with a title search): "El modelo ya existe en Shopify…".
- **Codes:** empty barcode → a new **EAN-13 starting with `20`** (valid check digit, unique); empty SKU → same as
  the barcode. Codes given in the sheet are used as they are.
- **Creation:** `productSet` (synchronous) with options Color and Talla, `productType`, `vendor` (Marca), status
  ACTIVE, and per variant: price, SKU, barcode, `inventoryPolicy: DENY`, taxable, `inventoryItem { tracked, cost }`
  and `inventoryQuantities` "available" at the first active location. Then `publishablePublish` to the Online Store
  and Point of Sale publications (matched by catalog title). A publishing failure is returned as an `aviso`.
- The new variants are added to the saved copy at once (one KV write per call), so the label page sees them and
  the same model can't be created twice; the `products/create` webhook then finds nothing new to write.
- Outgoing requests per call: token (if needed) + 1 config query + 3 per model (search, create, publish) ≤ 34.

## Free-plan limits to keep in mind
~100k worker requests/day, ~50 outgoing requests per run (a full download uses 1 token + 1 start +
up to 40 status checks + 1 file download), KV ~1,000 writes/day. Page opens are reads.

## Setup (one time)
1. **Shopify app** (dev.shopify.com → Dev Dashboard, same organization as the store):
   create an app (e.g. "ZAZI Connector"), create a version with the scopes
   **`read_products, write_products, read_inventory, write_inventory, read_locations, write_publications`** and
   Webhooks API version **2026-10**, release it, and install it on the ZAZI store.
   Copy its Client ID and Client secret.
2. **Cloudflare** → Workers → the old `zazi-bsale` worker → Settings:
   - rename it to `zazi-shopify` (the address becomes `https://zazi-shopify.<account>.workers.dev`),
   - add `SHOPIFY_TIENDA` and `SHOPIFY_CLIENT_ID` as variables and `SHOPIFY_CLIENT_SECRET` as a secret,
   - keep `CLAVE`, the KV binding `CATALOGO` and the cron; delete `BSALE_TOKEN`, `WEBHOOK` and `CPN_ID`.
3. Edit code → paste `zazi-worker.js` → Deploy.
4. Check: open `/diagnostico?clave=…`, then `/actualizar?clave=…` (should list ~1,400 articles).
5. Register the webhooks: `curl -X POST -H "X-Clave: <clave>" https://zazi-shopify.<account>.workers.dev/webhooks`,
   then `GET /webhooks?clave=…` should list the three topics.
6. Point the label page's `WORKER` constant at the new address.

**After changing the app's scopes:** the token is cached for 24 h in KV under `CLAVE_TOKEN`. Changing that
constant's name in the code (as version 6 did: `token-shopify-v6`) forces a fresh token with the new scopes.

**Webhook test:** rename a product or change a variant's barcode in Shopify, wait about 10 s, reload the
label page **without** clicking Actualizar, and search for it. If it fails, check the worker's
Observability/Logs.

## Testing locally
Import the module in Node and call `fetch(request, env, ctx)` with a mocked global `fetch`
(fake token endpoint, GraphQL answers and bulk JSONL file), a Map-backed KV object
(`get(key, "json")`, `put`), and `ctx.waitUntil` that collects promises. Sign fake webhook bodies with
`crypto.createHmac("sha256", secret).update(body).digest("base64")`.
