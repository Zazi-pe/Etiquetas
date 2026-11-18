# Etiquetas (label printing page for Shopify)

Page: https://zazi-pe.github.io/Etiquetas/ · Single file: `index.html`

## Start of every session
1. Run `git pull` first.
2. Before any non-trivial task, read `docs/handoff.md`. It has the full background, Shopify API findings, supplier details, the exact label spec and the open tasks. The code is the ground truth; if the handoff and the code disagree, trust the code, tell Stefano, and fix the handoff.

## Business context
- ZAZI is a shoe store in Lima, Peru (SP SHOP S.A.C.). Stefano is a backend developer who works there; his mother heads the business, so he doesn't control every decision.
- Inventory moved from BoxHero to Bsale, and in Nov 2026 from Bsale to **Shopify** (Bsale is being shut off). All barcodes and SKUs were migrated unchanged. One Shopify product = one model with all its colors; one variant = color + size (options "Color" and "Talla"). One location. Shopify doesn't generate SKUs or barcodes for new products (open question, handoff section 7).
- This page prints thermal labels for Shopify variants, copying Stefano's BoxHero design. The current big task is connecting the catalog repos `Zazi` and `Zazi-Modelos` (siblings in `~/ClaudeCode/Zazi-pe/`) to Shopify; loading New Athletic and I-RUN shipments comes after (handoff, section 7).

## How Stefano works
- He writes in English. All user-facing copy is Spanish (Peru). Code identifiers and comments are in Spanish.
- Plan before building anything big: propose steps and ask the questions that matter first. Small changes can be committed and pushed directly; he tests afterwards.
- Don't add things he didn't ask for. Mention optional ideas; don't build them.
- He tests on MacBook (Chrome) and iPhone; real printing is on a Windows PC with an Xprinter XP-365B. End changes with a short test checklist.

## How it fits together
- `index.html` loads articles from the Cloudflare worker `zazi-shopify` (constant `WORKER`): `GET /articulos` with header `X-Clave`; the key is stored in `localStorage["zazi-etiquetas-clave"]`.
- **The worker code is in `worker/zazi-worker.js`** (version 5; `worker/README.md` explains it). It reads Shopify's Admin API with a token from the "ZAZI Connector" app (client credentials), downloads with a bulk operation, keeps a copy in KV `CATALOGO`, and has a nightly cron and Shopify product webhooks. Edit and test it here (Node with mocked `fetch` and KV), push, then Stefano pastes it into Cloudflare and deploys. The Cloudflare connector can read the deployed code to check it.
- Shopify's Admin API version is 2026-10: `ProductVariant.barcode` is deprecated, use `barcodes`. The Shopify connector in Claude Code can run read-only queries against the store.
- The worker's CORS allows only `https://zazi-pe.github.io`, so opening `index.html` as a local file won't load data. Test with Playwright and mocked routes instead.
- "Importar desde Excel" reads SKU plus quantity (columns `Copias`, then `Cantidad`, then `Stock`). The quantity is only the number of labels; it doesn't have to match the stock in Shopify.

## Decisions (don't revisit unless Stefano asks)
- Labels are **75 × 50 mm**: the BoxHero design enlarged (×1.5 horizontally; vertical positions × K, `ALTO_U = 142 * 50 / 75`). Font Roboto Regular. Exact positions are in the handoff, section 4.
- Barcode: **Code 128 exactly like BoxHero's PDF**, no human-readable digits; digit strings as Code C pairs, an odd last digit switches to Code B. Implemented in-page; no JsBarcode. EAN-13 bars were tried and rejected.
- Color text rules: one row if it fits (may shrink to 10 pt), else two rows at 11 pt breaking between words, a third row is cut with "...".
- Brand names are skipped for now ("M:" prints empty). Type text (Shopify product type) and product names print exactly as in Shopify.
- Always read color and size from the variant options ("Color", "Talla"), never by parsing the variant title.
- Printing uses `@page { size: 75mm 50mm; margin: 0 }`. On a new PC or printer, a 75 × 50 mm custom paper must be created in the printer driver.

## Critical rules
- **Never write token, key or secret values (SHOPIFY_CLIENT_SECRET, CLAVE) into any file.** The repo is public.
- Verify label changes the way the handoff describes: Playwright (Chromium) print to PDF, rasterize with `pdftoppm`, decode with `pyzbar` at 203 dpi.

## Updating the handoff (when and how)
**When:** update the handoff as soon as Stefano says anything like "I'll migrate to another chat", "moving to a new session", "let's wrap up", "update the handoff" or "handoff". Do it right away as the last task of the session, without asking for confirmation. Also do it after a big milestone is finished and pushed. If the conversation is getting long, suggest it to him.

**How:**
1. Edit the existing sections of `docs/handoff.md` (current state, decisions, next steps, open questions) so the document describes the project as it is now. Don't just append a session log, and remove anything that is no longer true.
2. Update the "last updated" date in the title.
3. Move any new permanent rule into this `CLAUDE.md` as well.
4. Never write secret values (tokens, keys, passwords).
5. Commit with a descriptive message and push.
6. Tell Stefano it's done, with a one-line summary of what changed, so he can start the next session.
