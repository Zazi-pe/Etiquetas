# ZAZI — Shopify, labels and worker: handoff (living document, last updated November 18, 2026)

Living handoff for the **Etiquetas** repo and everything around ZAZI's inventory system: the label printer page, the Cloudflare worker that bridges the inventory system, webhooks, and loading supplier shipments. It lives at `docs/handoff.md` in the Etiquetas repo and is updated at the end of every Claude Code session (see `CLAUDE.md`).

**Inventory moved from Bsale to Shopify (Nov 2026).** Bsale is being shut off. Shopify is already loaded with every Bsale model, and all **barcodes and SKUs were migrated unchanged**, so labels already printed keep scanning. The whole system (labels now, catalogs next) is being moved to Shopify; Bsale details are kept only where they still explain something.

It replaces the Nov 6 chat handoff. The catalog repos (Zazi, Zazi-Modelos) have their own handoff; section 7 summarizes what this work needs from them.

**Ground truth:** the code in this repo (including `worker/`), the worker deployed in Cloudflare, and Shopify itself. If this document and the code disagree, trust the code and update this document.

**Files outside the repo:** Stefano's zip `ZAZI-bsale-etiquetas-codigo.zip` has reference files: the BoxHero label template PDF, `Productos_BSale.xlsx` (the Excel originally used to create the products in Bsale) and `Stock-actual_ALJOVIN_06-11-2026.xlsx` (Bsale's stock export, a format the import page reads). Ask Stefano for any of them when needed. The worker code now lives in this repo (`worker/`).

---

## 1. Context and working rules

- **Business:** ZAZI, a shoe store in Lima. Legal entity SP SHOP S.A.C., **RUC 20604065144**, address Cal. Miguel Aljovín 410, Cercado de Lima. **Stefano** (Stefano Mateo Portalatino Tapia) is a backend developer and works there; his mother heads the business.
- **Language:** Stefano writes in English. All user-facing copy is **Spanish (Peru)**; code identifiers and comments are in Spanish.
- **How he works:**
  - Plan before building big things; ask the questions that matter first.
  - Don't add things he didn't ask for. Mention optional ideas, don't build them.
  - **Tools:** since Nov 2026 he works with **Claude Code** (Code tab of the Claude desktop app, Environment: Local). The repo is cloned on his MacBook at `~/ClaudeCode/Zazi-pe/Etiquetas/`. Claude edits files directly, tests, and commits and pushes with Git. Small changes can be pushed without asking; big changes need a plan and his OK first. The old chat workarounds (GitHub connector, uploading files by hand, byte-for-byte checks) are no longer needed.
  - He tests on a MacBook (Chrome) and iPhone; real printing is on a Windows PC. Give short test checklists.
  - **Credentials:** never write token, key or password values into files, commits or this document. The repo is public. Secret values live only in Cloudflare and with Stefano.
- **Earlier decisions (don't revisit unless he asks):**
  - The label copies his **BoxHero PDF design exactly**, including the barcode encoding, **enlarged to 75 × 50 mm** (see section 4).
  - Brand names on labels are **skipped for now** ("M:" prints empty). Shopify now has the brand in each product's Vendor field (e.g. "GELI", "ZAZI"), so printing it is possible if Stefano asks; not built.
  - Label type text is copied as-is (Shopify product type, plural: "Zapatillas", "Botines"…). Product names print as-is, including number prefixes ("1Acrilico", "3AllStar").

---

## 2. What exists now

| Piece | Where | Status |
|---|---|---|
| Label page | https://zazi-pe.github.io/Etiquetas/ (repo `Zazi-pe/Etiquetas`, file `index.html`). The repo also has `README.md`, `CLAUDE.md`, `docs/handoff.md` and `worker/` | Live. Since Nov 18 it reads Shopify through the new worker; Stefano ran the test checklist and confirmed it works |
| Worker (Shopify bridge) | https://zazi-shopify.stefanoportalatinotapia.workers.dev (Cloudflare, free plan; the old `zazi-bsale` worker renamed). Code: `worker/zazi-worker.js` | **Version 5** deployed Nov 18. Saved copy verified: 268 products, 1,411 variants, matching Shopify |
| KV storage | namespace `zazi-catalogo`, bound as `CATALOGO` | Working (keys `catalogo` and `token-shopify`) |
| Nightly refresh | Cron `0 8 * * *` (3 a.m. Lima) | Kept from the Bsale worker; check Settings → Triggers if refreshes look stale |
| Webhooks | Shopify `PRODUCTS_CREATE`, `PRODUCTS_UPDATE`, `PRODUCTS_DELETE` → `…/shopify/webhook` | **Registered Nov 18** (confirmed via `GET /webhooks`). A live test (rename a product, reload without Actualizar) is still to do |
| Shopify app | "ZAZI Connector", created in the Shopify Dev Dashboard, installed on the ZAZI store | Gives the worker its access token (client credentials). Scope `read_products` (Stefano may also have kept `write_products`) |
| Real printing | Windows PC with **Xprinter XP-365B** (also has an XP-318B) | Working. Requires a **75 × 50 mm custom paper size in the printer driver** (see section 4) |
| Products in Shopify | | All Bsale models migrated. **New Athletic and I-RUN models are not loaded yet** (see section 7) |
| Catalogs connected to Shopify | | Not started (next big task, section 7) |
| Bsale | | Being shut off. The old worker (version 4) is in this repo's git history |

---

## 3. Shopify: account facts and API findings

### Account (checked Nov 18)
- Store "ZAZI", address `y0mdhy-r0.myshopify.com`, currency PEN. Not a secret, but the worker reads it from configuration.
- **Counts:** 268 active products, 1,411 variants (no draft or archived products). Bsale had 257 / 1,281 on Nov 4.
- **One location**, named with the address "CAL.MIGUEL ALJOVIN NRO. 355 CERCADO DE LIMA". There is no Luren location.
- **Product types:** Botas, Botines, Sandalias, Zapatillas, Zapatos. **Vendor** = brand (e.g. GELI, ZAZI).
- **Structure (same as Bsale):** one **product = one model with all its colors** ("1Acrilico"); one **variant = color + size**, with options named exactly **"Color"** and **"Talla"**. Variant titles look like "Blanco / 37". **Always read color and size from the options, never parse the title.**
- **Codes:** barcodes are the migrated EAN-13s starting with `20`; SKUs look like `SKU-P8JJLF7X` (random, from Bsale). **Shopify does not generate barcodes or SKUs**: new products need them supplied (see section 7).

### API (Admin GraphQL)
- Version **2026-10**. Endpoint `https://<store>/admin/api/2026-10/graphql.json`, header `X-Shopify-Access-Token`.
- **Token:** apps made in the Dev Dashboard use the **client credentials grant**: `POST https://<store>/admin/oauth/access_token` with `grant_type=client_credentials`, `client_id`, `client_secret` (form-encoded). The token lasts 24 h (`expires_in` 86399); there is no token to copy from the admin. Works only when the app and store are in the same Shopify organization.
- `ProductVariant.barcode` is **deprecated** in 2026-10: use the `barcodes` connection (`barcodes(first: 1) { nodes { value } }`). A variant can hold up to 20 barcodes; the worker takes the first.
- Search filters: `productVariants(query: "product_status:active")` (lowercase value works), `productsCount(query: "status:active")`.
- **Rate limit:** cost-based, Standard plan 100 points/second. Paging 1,400 variants (~500 points per 100) would take about a minute, so the full download uses a **bulk operation** (`bulkOperationRunQuery`, poll `bulkOperation(id)`, download the JSONL from `url`). Nested connections come as separate JSONL lines with `__parentId`.
- `locations` needs the `read_locations` scope (the app doesn't have it; `/diagnostico` dropped it). Stock per location will need `read_inventory` (and probably `read_locations`) for the catalog work.
- **Webhooks:** registered through the API (`webhookSubscriptionCreate`, input `{ uri, format: JSON }`); signed with the app's **client secret** in `X-Shopify-Hmac-Sha256` (base64 HMAC-SHA256 of the raw body). The webhook API version is set in the app version (2026-10).
- Claude has a Shopify connector in Claude Code that can run read-only Admin GraphQL queries against the store, useful for checks.

### Bsale (historical, being shut off)
One product = one model, variant = color + size, attributes "Color"/"Talla"; branches ALJOVIN (1) and Luren (2); price list 5. Bsale's import Excel ("Carga masiva" sheet) and Stefano's upload rules (Marca in capitals, `Si` without accent, sold-out sizes included) applied to loading products into Bsale and are no longer the target. The label page's offline Excel backup still reads Bsale's product Excel (section 4).

---

## 4. Label page (`Zazi-pe/Etiquetas/index.html`)

Single HTML file (about 47 KB), all Spanish, BoxHero-like layout. Built and tested in Chromium only. It uses standard printing, so it should work in Safari and Firefox, but that hasn't been tested.

### Screen
- **Left side:**
  - Title "Imprimir etiquetas".
  - "Diseño de etiqueta": one fixed design (ZAZI, thermal label 75 × 50 mm), no option to add others.
  - "Artículos": status line ("1,411 artículos de Shopify, actualizados el …"), an **"Actualizar desde Shopify"** link, an **"Importar desde Excel"** button (opens the import page below), and a CLAVE form when there's no key. A backup link "Cargar productos desde un Excel (sin conexión)" appears only when the worker can't be reached; it loads the whole product list from **Bsale's** product Excel instead (not yet adapted to Shopify's product CSV export; pending, section 7).
  - Table with columns Artículo and Copias (✕ to remove), a **Buscar artículo** combobox, totals ("N artículos, N etiquetas en total"), and the **Imprimir** button.
- **Right side:** grey panel with each selected label rendered one below the other, with "N copias". On a phone it stacks below the list.
- **Search:** every word must match (AND). Text words match name, color, type and brand (accent- and case-insensitive). A number-only word matches the size exactly, or the name ("1acrilico"). Shows up to 200 suggestions with a scroll ("Se muestran 200 de N"). Clicking a suggestion adds 1 copy and keeps the list open (with a count badge). Arrow keys and Enter work. Scanning a full barcode and pressing Enter adds that item directly.
- **Data:** on load, `GET {WORKER}/articulos` with header `X-Clave`. The key is stored in `localStorage["zazi-etiquetas-clave"]`. A 401 asks for the key again. A network error shows a Spanish message suggesting the Excel backup. The worker address is the constant `WORKER` in the page.
- **Excel backup (product list):** reads Bsale's product Excel (import format or export). Columns are found by header; color and size fall back to parsing "Color / Talla" from Variante. This path includes Marca and SKU.

### Import page ("Importar desde Excel", copied from BoxHero's Upload File screen)
- Replaces the main screen. Title "Importar artículos", tabs **Subir archivo** (a **Descargar plantilla** button that generates `plantilla-etiquetas.xlsx` with columns SKU and Cantidad, plus a drag-and-drop or click-to-browse box) and **Copiar y pegar** (a textarea; rows split by tab, `;` or `,`; a header is optional, otherwise column 1 is SKU and column 2 is quantity).
- Reads only **SKU** and quantity. The header row is found by a cell exactly "SKU" (within the first 30 rows; Bsale's stock export has "Sucursal"/"Filtros" rows above the header). Quantity comes from the first column named exactly **"Copias"**, then **"Cantidad"**, then **"Stock"** (Bsale's stock export used Stock; Shopify's inventory export uses other column names, not checked yet). With no quantity column, it uses 1 per row and says so.
- **The quantity is only the number of labels.** It doesn't have to match the stock in Shopify (Stefano's rule).
- Repeated SKUs add up; quantities are capped at 999; a quantity of 0 shows grey ("0 copias: no se imprimirá").
- SKUs are matched against the Shopify articles from the worker (case- and accent-insensitive). **A SKU not in Shopify shows in red with a ⚠ icon** ("Este SKU no está en Shopify"), using the file's own Producto/Variante text, and is skipped.
- **Preview step:** summary ("8 artículos, 11 etiquetas listas para agregar. 1 SKU no está en Shopify y no se imprimirá."), a table (Artículo, SKU, Copias), **Atrás** (back one step) and **Siguiente**.
- **Siguiente** adds the matched items to the main list (**copies add to items already selected**), returns to the main screen with previews, and shows a toast ("Se agregaron N artículos (M etiquetas)").
- Tested with `Stock-actual_ALJOVIN_06-11-2026.xlsx` (8 Acrilico SKUs, 9 labels) plus an unknown SKU and a repeated row: all behaved as above.

### The label: 75 × 50 mm (BoxHero's design, enlarged)
Stefano's labels are **75 × 50 mm** (he first said 50 × 25, then 50 × 30; 75 × 50 is final). The design comes from his BoxHero PDF (142 × 85 pt = 50 × 30 mm) and is drawn as an SVG with **viewBox `0 0 142 94.667`** rendered at 75 × 50 mm:
- **Horizontally** everything is the BoxHero design ×1.5 (142 units = 75 mm).
- **Vertically** all y positions, line ends and the barcode height are multiplied by **K = 94.667 / 85 ≈ 1.1137** (constant `ALTO_U = 142 * 50 / 75`), so the extra 5 mm of height is spread between the rows. Font sizes and widths are not stretched.
- Font **Roboto Regular** (Google Fonts; text is measured on a canvas after `document.fonts.load`).

BoxHero's original positions, before the vertical factor K (x, baseline y, size in units):

| Element | Position and size |
|---|---|
| Size number | 2.835, 40.258, 37 pt (shrinks to fit 43 pt width) |
| Type | 2.835, 53.141, 7 pt |
| "M:" | 3.148, 68.410, 8 pt |
| Brand | 3.148, 77.410, 8 pt |
| "Nombre:" | 49.616, 8.268, 6 pt |
| Name | 49.616, 19.830, 11 pt (shrinks to fit 89 pt, min 5) |
| "Color:" | 49.616, 28.668, 6 pt |
| Color | rows at baselines 39.115 / 52.115, 11 pt |
| Horizontal line | y 58.283, x 2.835 → 138.898 |
| Vertical line | x 47.116, y 2.836 → 82.205 |

Lines are 1 unit thick (0.53 mm at 75 × 50).

**Color rules (Stefano's):**
1. Keep it on one row if it fits; it may shrink down to 10 pt to stay on one row.
2. Otherwise, use a second row at full 11 pt, breaking between words.
3. If it would need a third row, the second row is cut where it runs out of space and ends in "...".

**Barcode: exactly like BoxHero's PDF.** Code 128, no human-readable digits, box at x 53.148, y 63.434 (×K), 76.75 × 18.769 (height ×K) units, bars stretched to the full box width. Encoding matches BoxHero bar for bar:
- digit strings: **Code C pairs**, and if there's an odd digit left, **switch to Code B (value 100)** plus that digit,
- anything else: Code B.

It's implemented in-page with the standard 107-pattern table (no JsBarcode). An EAN-13 version with 2-dot bars was tried and **rejected by Stefano**: "copy exactly as the PDF, that one works."

**Printing:** `@page { size: 75mm 50mm; margin: 0 }`, one SVG per page in `#hoja`, `window.print()`. The page shows the hint "papel de 75 × 50 mm, sin márgenes y escala al 100 %".

**Printers:** a Windows PC with an **Xprinter XP-365B** (the one used day to day), and an **Xprinter XP-318B**; both 203 dpi.

**Printer setup (the cause of an early problem):** printing directly from Chrome uses the **driver's paper size**, not the page's `@page` size. With the driver's default (larger) paper, the label printed small in a corner, while "Guardar como PDF" (which honors `@page`) and then printing the PDF worked. Fix, done by Stefano:
1. Create a custom paper of **75 × 50 mm** in the driver's Printing preferences.
2. In Chrome's "Más opciones de configuración", choose that paper, **Márgenes: Ninguno**, scale 100, headers and footers off.

If a new PC or printer is added, repeat this setup. The fallback idea, not built, is to generate a PDF in the page, like BoxHero's "Download PDF".

### How it was verified (reuse this method)
- Playwright (Chromium) with routes intercepting the CDN (SheetJS 0.18.5 from npm), Google Fonts (Roboto woff2 from `@fontsource/roboto`), the worker (mocked responses), and the page served at `https://zazi-pe.github.io/Etiquetas/`.
- Print to PDF, rasterize with `pdftoppm`, decode with `pyzbar`. At 75 × 50 mm the thin bars are about 2.6 printer dots, and **76/76 sample labels decode at exactly 203 dpi**. (At the old 50 × 30 size, bars were 1.76 dots and didn't decode at 203 dpi, not even BoxHero's own PDF.)
- Overlay against `boxhero_360397_label-6.pdf` rasterized at 406 dpi (done at the 50 × 30 size, before the enlargement): layout and barcode matched bar for bar (sub-pixel differences only).
- Import page: test with a real stock export plus an unknown SKU and a repeated row; mock the worker with `sku` fields.
- Worker: Node with a mocked `fetch` (token endpoint, GraphQL answers, bulk JSONL), a Map-backed KV and a `ctx.waitUntil` collector; webhook bodies signed with `crypto.createHmac`. Details in `worker/README.md`.

---

## 5. Worker (`zazi-shopify`, version 5)

Full description and setup steps: **`worker/README.md`**. Summary:
- **Code:** `worker/zazi-worker.js`. To change it, edit it in the repo, test it locally, push, and Stefano pastes it into the Cloudflare editor and deploys (Claude can read the deployed code with the Cloudflare connector, but can't deploy).
- **Configuration in Cloudflare** (values known by Stefano; never write them down): variables `SHOPIFY_TIENDA` and `SHOPIFY_CLIENT_ID`, secrets `SHOPIFY_CLIENT_SECRET` and `CLAVE`, KV binding `CATALOGO`, cron `0 8 * * *`. The Bsale secrets (`BSALE_TOKEN`, `WEBHOOK`, `CPN_ID`) are no longer used.
- **Endpoints** (key in header `X-Clave` or `?clave=`): `GET /articulos` (saved copy; downloads if missing, older than 24 h or format `v` ≠ `FORMATO` = 3), `GET|POST /actualizar`, `GET /diagnostico` (saved-copy summary and live counts), `GET /webhooks` (list) and `POST /webhooks` (register missing), `POST /shopify/webhook` (Shopify notices, signature checked), `scheduled()` (cron). CORS: only `https://zazi-pe.github.io`.
- **Answer for the page (unchanged from Bsale):** `{ actualizado, articulos: [{codigo, sku, nombre, tipo, color, talla}] }`. Variants without a barcode are left out.
- **Saved copy:** `{ v: 3, actualizado, productos: {id: {n, t}}, articulos: {variantId: {c, s, p, co, ta}} }` (numeric Shopify ids). The access token is cached in KV (`token-shopify`) and renewed about once a day; a 401 gets a new token and retries once.
- **Full download:** one bulk operation: 1 token request (when needed) + 1 start + up to 40 status checks + 1 file download, within the ~50 outgoing requests allowed per run.
- **Webhooks:** only the product id is used; the product is re-read from Shopify and its variants replaced (removed if no longer ACTIVE or deleted). **KV is written only if something on the labels changed** (name, type, SKU, barcode, color, size), so price and stock edits that fire `products/update` don't use KV writes. A product with more than 100 variants triggers a full download.

### Cloudflare free plan
As far as known: about 100k worker requests a day, about 50 outgoing requests per run, a CPU time limit, and KV about 100k reads and **about 1,000 writes a day** (about 1 write per second per key). Opening the page is a read. For catalog stock later, stock changes must be **batched** or kept out of KV writes; the paid plan (about $5/month) is the fallback.

---

## 6. Suppliers and box labels (for the import work)

- **New Athletic (NA):** about 400 pairs per purchase, almost every model different.
  - **Code anatomy:** `NACA` + line (`BAS`, `FUT`, `LIF`, `OUT`, `RUN`, `SKA`) + 4-digit model + age group (`A` adulto, `J` juvenil, `N` niño) + 4-digit color code. Example: `NACAOUT0133A5121`.
  - **Color codes are global across models** (`0201` = NEGRO-BLANCO, `0202` = NEGRO-NEGRO, `2923` = IVORY-CORAL, `0272` = NEGRO-VERDE KAKI).
  - **The box barcode = article code + size** (`NACAOUT0133A512140`), so it's unique per variant: no labels needed for NA, if that code is used as the variant's barcode in Shopify.
  - **The box label** has code, model name (e.g. "MONTFOR"), color in English ("BROWNNESS/D. BEIGE") and size range.
  - **The guía de remisión** has code, sizes with quantities ("30(1), 32(3)"), and a description (NEW ATHLETIC-CALZADO-OUTDOOR-NIÑO-NEGRO-BLANCO) but **no model name and no prices**.
  - **NA also prints a size-matrix pivot table** ("Etiquetas de fila" header, so it comes from Excel). Stefano can ask NA for the Excel each time.
- **I-RUN:** more serial (same style in several colors).
  - **The factura** lists one line per style + color code + size (`354M M6 39`), with quantity, price, discount and total. Unit cost **includes IGV** (82.00 − 12.00 = 70.00, so 59.32 net).
  - **The pedido** sheet has a style × size matrix (styles 340M, 354F, 354M, 415F, B023F, B025M; colors M3, F9, M6, F7, F7, M4; 144 pairs).
  - **Color names appear only on the boxes**, not on the factura.
  - **The I-RUN box barcode is a placeholder (`0123456789128`, the same on every box)**: never import it; I-RUN needs ZAZI labels.
  - The box label shows "I-RUN 208J4"; how that maps to factura codes is unknown (a box photo is needed).
- **You (Depazleyva):** label with STYLE (`YSW P157B`), ART (WOMEN), COLOUR, SIZE; **no barcode**.
- **ZAZI's own models:** already in Shopify (migrated from Bsale) with ZAZI labels (BoxHero-generated EAN-13 codes).
- Only some boxes arrive with supplier barcodes. Bigger brands send a factura (an Excel can be requested); smaller suppliers' shipments are counted by ZAZI itself.

---

## 7. Next steps (in Stefano's priority order)

1. **Catalogs ↔ Shopify (current focus).** Phases 1 (worker) and 2 (label page) of the Shopify move are done. Phase 3 connects the two catalog sites:
   - Two static catalog sites, `Zazi-pe/Zazi` and `Zazi-pe/Zazi-Modelos`, on GitHub Pages (same origin as this page). Their data is `productos.json`, edited through `admin.html`; one catalog product = **one model + one color**. Each product has an empty `sku` field reserved for the inventory link. Details in the catalogs' own `docs/handoff.md`.
   - **Agreed with Stefano:** Shopify controls **sizes, stock and prices**; photos, descriptions, "Nuevo" and the vitrina stay in `productos.json`.
   - **Planned approach:** the public stores read price and per-size availability directly from Shopify's **Storefront API** (its token is meant to be public; it gives available yes/no, not counts), so the worker isn't needed for the stores. Products must be published to the sales channel the Storefront token uses. The admin replaces its price and size fields with a link to a Shopify product + color.
   - Match catalog products to Shopify by **product + color** (one Shopify product = one model with all its colors).
   - To plan first with Stefano: the exact link field in `productos.json`, what the store shows while Shopify loads or if it fails, and whether the catalog's price is dropped entirely.
2. **Test the webhooks live:** rename a product (or change a barcode) in Shopify, wait about 10 s, reload the label page **without** clicking Actualizar, and search for it. If it fails, check the worker's Observability/Logs and `GET /webhooks`.
3. **Adapt the Excel paths in the label page to Shopify:** the offline backup ("Cargar productos desde un Excel") still expects Bsale's product Excel; it should read Shopify's product CSV export (columns like Title, Option1/Option2 Name/Value, Variant SKU, Variant Barcode). Also check that the import page finds the quantity in Shopify's inventory export.
4. **Load new shipments into Shopify** (New Athletic, I-RUN). Workflow idea from the Bsale plan: Stefano sends the documents (factura, guía, NA Excel, box photos) and Claude returns a file to import plus a SKU + Cantidad file for the label page's import. Now the target is **Shopify's product CSV import** (or the Admin API, which would need write access). Always cross-check totals against the document and flag mismatches.
   - **New open question:** Shopify doesn't generate SKUs or barcodes the way Bsale did. New variants need them: e.g. new EAN-13s starting with `20` (checked as unique against the worker's `/articulos`) and SKUs in the same `SKU-XXXXXXXX` style, or another rule Stefano picks.
   - **Pilot: the I-RUN factura (144 pairs). Waiting on Stefano:** color names for M3, F7, F9, M4, M6 (box photos); product naming ("354M" vs "I-RUN 354M"…); sale price per style.
   - Open for NA: use NA's code+size as the variant barcode (so NA boxes need no labels), or ZAZI codes and labels; product naming (NA's model name from the box, or the code).
5. Later or optional:
   - brand names on labels from Shopify's Vendor (section 1),
   - "print labels for a reception" read directly from Shopify,
   - Safari/Firefox print testing.
