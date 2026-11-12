# Agent Instructions — Snakes & Ladders (Pluggable Cloud Editions)

When a user asks you to create, customize, or update a **Snakes & Ladders Edition Pack** (for example, *"Create a Google Cloud × Wiz edition"* or *"Add an Apigee API Management pack"*), follow this exact workflow:

## 1. Architecture Overview
- **`packs/manifest.json`**: Registry of all available edition packs and the `"defaultPack"` ID.
- **`packs/<pack-id>.json`**: Self-contained pack JSON containing `meta` (including `tiers` and `milestones`), `ladders`, `snakes`, and `shields`.
- **`scripts/validate_pack.py`**: Zero-dependency Python validator that enforces every schema rule and board layout constraint.
- **`scripts/bundle_packs.py`**: Bundles all packs registered in `packs/manifest.json` into `scenarios.js` for offline `file://` support.
- **`game.js`**: Topic-agnostic 10×10 boustrophedon board engine. Supports switching packs via the header dropdown (`#pack-select`) or `?pack=<pack-id>` URL query parameter.
- **`server.py`**: Hardened zero-dependency Python HTTP server with CSP, gzip pre-compression, ETag caching, per-IP rate limiting, and `/packs/*.json` serving.

## 2. Rules for Authoring a New Pack (`packs/<pack-id>.json`)
1. Read [`CUSTOMIZE.md`](CUSTOMIZE.md) and inspect [`packs/cloud-databases.json`](packs/cloud-databases.json) as a reference implementation.
2. Ensure minimum pool counts so the random board generator can always build a varied 100-tile board:
   - At least **18 ladders** in `"ladders"` (each with `"q"`, `"opts"` of length 3, `"ans"` in `0..2`, `"why"`)
   - At least **18 snakes** in `"snakes"` (each with `"prevent"`, `"detect"`, `"recover"`, `"q"`, `"opts"` of length 3, `"ans"` in `0..2`, `"why"`)
   - At least **16 shields** in `"shields"`
   - **2 milestones** (`"1"` and `"100"`) inside `meta.milestones`
3. Every scenario `"shortTag"` MUST be **12 characters or fewer** (`len(shortTag) <= 12`).
4. Every `"docUrl"` MUST start with `https://` and match a hostname listed in `meta.allowedDocHosts`.
5. Register the new pack in `packs/manifest.json`.
6. Always run both commands after editing any pack:
   ```bash
   python3 scripts/validate_pack.py
   python3 scripts/bundle_packs.py
   ```

## 3. Security Guardrails
- Never use `innerHTML`, `outerHTML`, `document.write`, or inline `style` attributes in `game.js` or `index.html` (strict CSP `script-src 'self'; style-src 'self'` is enforced).
- Always construct DOM elements with `document.createElement` and `textContent`.
