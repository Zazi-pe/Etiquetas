# ZAZI — start here for a new chat (November 20, 2026)

A short entry point for a new Claude Code session. It doesn't replace the living handoffs; it tells you where things are and what's next. Details are in:
- `Etiquetas/docs/handoff.md`: labels, Nuevos modelos, the Cloudflare worker, Shopify API findings, suppliers.
- `Zazi/docs/handoff.md` (identical copy in `Zazi-Modelos`): both catalog stores and admins, `shopify.js`, Pendientes, deploy.
- Each repo's `CLAUDE.md`: the working rules. Read them first.

The code is the ground truth. If a handoff and the code disagree, trust the code and fix the handoff.

## First steps in the new chat
1. `git pull` in `~/ClaudeCode/Zazi-pe/Etiquetas`, `Zazi` and `Zazi-Modelos` (the admin commits straight to `main` from Stefano's phone).
2. Read the `CLAUDE.md` of the repo you'll work in, then the relevant handoff.
3. Plan big changes first and ask; small changes can be pushed directly. End with a short test checklist.

## Where everything stands (all live and working)
| Piece | State |
|---|---|
| Inventory | In **Shopify** (Bsale is being shut off). One product = one model with all its colors; variant = Color + Talla. One location (Aljovín). |
| Label page (`Etiquetas/index.html`) | **Imprimir etiquetas** reads Shopify through the worker; each imported lot prints on its own. **Nuevos modelos** creates models from a Bsale-style Excel, or adds only the missing colors/sizes to an existing model (price must match Shopify's). Optionally sends them to a catalog's `pendientes.json`. |
| Worker `zazi-shopify` v6 (`Etiquetas/worker/`) | Deployed. `/articulos`, `/actualizar`, `/diagnostico`, `/webhooks`, `/shopify/webhook`, `POST /crear`. Stefano pastes and deploys it in Cloudflare; Claude can read the deployed code with the Cloudflare connector. |
| Shopify app "ZAZI Connector" | Version 3 scopes: read/write products and inventory, read_locations, write_publications. Token via client credentials, cached in KV. |
| Catalog stores (Zazi, Zazi-Modelos) | Render at once with saved data; connected products are locked ("Verificando stock…") until Shopify answers; if Shopify fails, buying unlocks with a WhatsApp note. Photos as WebP (400/800/full) via `<picture>`, made at deploy. Two-job Pages deploy. |
| Catalog admins | Connect a product by typing/scanning any SKU of that color. Pendientes section with Publicar (photo + swatch required) and "Quitar de pendientes". |
| Data | Zazi: 30 products (Anda and You connected to Shopify, I-RUN manual); 7 pending (Anda D307 ×4, D315 ×3). Modelos: 1 product (Pasador, connected). |

## Next steps (Stefano's order)
1. **Stock upload tool** (new, not designed yet): add stock to existing variants by barcode/SKU + quantity. Plan it with Stefano first.
2. **Load New Athletic and I-RUN shipments** with Nuevos modelos. The I-RUN pilot waits on Stefano: color names for codes M3, F7, F9, M4, M6, product naming, sale price per style. Then connect I-RUN in the Zazi admin.
3. **Publish the 7 pending Anda colors** (Stefano, from the Zazi admin, with photos).
4. **Test webhooks live** (rename a product in Shopify, reload labels without Actualizar).
5. **Label page Excel paths:** read the label import raw (long numeric SKUs), adapt the offline backup to Shopify's export.
6. Optional, mention only: brand on labels, `og:image`, required checkout fields, Culqi.

## Housekeeping
- Untracked in `Etiquetas`: `carga-anda-d318.xlsx` and `carga-modelos-catalogo-zazi.xlsx` (one-off sheets made for loading). Not committed; Stefano can delete them.
- Zazi's `filtros` has an empty `intento` line left from the first test; ask before removing it.
- If "PRUEBA Nuevos Modelos – borrar" is still in Shopify, delete it.

## Rules that bite if forgotten
- Never write tokens, keys or the CLAVE into any file: the repos are public.
- Never call `POST /crear` (or anything that creates) as a check.
- Shared catalog files (`index.html`, `admin.html`, `validar.js`, `shopify.js`, `publicar.yml`, `ESTRUCTURA.md`, `docs/handoff.md`) must be byte-identical in Zazi and Zazi-Modelos: copy and `cmp`.
- `node validar.js` before every catalog commit. After editing `publicar.yml`, run `bash -n` on each `run:` script.
- Shopify Admin API 2026-10: use `barcodes`, not `barcode`. Read color and size from the options, never the variant title.
- The `modern-web-guidance` skill is installed (user scope) for web work in the catalogs.
