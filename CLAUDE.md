# CLAUDE.md

Guidance for Claude Code working in this repo. Keep it short; update it when the rules change.

## What this is
A static, bilingual (EN / 中) interactive knowledge graph of finance terms, rendered
with Cytoscape.js. Nodes are terms, colored A/B/C by cross-language conceptual
distance. See `README.md` for the human-facing overview.

## Hard rules
- **`data/finance_kb.json` is the single source of truth. NEVER edit it.** The app only reads/renders it.
- **Static site only** — no build step, no framework, no bundler. Plain HTML + CSS + vanilla JS; libraries via CDN. Must run on GitHub Pages as-is.
- **Use relative asset paths** (`app.js`, `data/finance_kb.json`, …), never leading-slash absolutes — the site is served from a Pages subpath (`/finance-knowledge-base/`).
- Write plain, well-commented, conventional code; prefer clarity over cleverness. Add a one-line comment when a choice is non-obvious.

## Run locally
`fetch` is blocked on `file://`, so serve over HTTP:
```sh
python3 -m http.server   # then open http://localhost:8000
```

## Deploy
- Push to **`main`** → GitHub Pages auto-rebuilds (~1–2 min). Live: https://jaskzx.github.io/finance-knowledge-base/
- No re-config needed. If a first-of-day deploy shows a transient "Deployment failed, try again later", just push again or request a rebuild (`gh api --method POST /repos/jaskzx/finance-knowledge-base/pages/builds`).

## Files
- `index.html` — structure  ·  `style.css` — styling (responsive)  ·  `app.js` — data load, graph, all interactions  ·  `data/finance_kb.json` — read-only KB.

## Data shape
`{ meta, nodes, edges }`. Node fields: `id, en, zh, aliases_en[], aliases_zh[], layer, subgroup, bucket (A|B|C), priority, definition_en, definition_zh, nuance_note_en, nuance_note_zh, formula_display`. Edge fields: `source, target, type (formula|family), label?`. All edges are within a single layer.

## Domain notes
- **Bucket** = cross-language distance (not good/bad): A = translates cleanly, B = same concept treated differently, C = no real equivalence. Colors live in one place: the `BUCKET_COLORS` constant in `app.js` (currently green/amber/red per user preference).
- **Layers** (value → 中文 / English): `company_fundamentals` 个股与基本面 / Company & Fundamentals · `trading` 交易 / Trading · `asset_classes` 资产类别 / Asset Classes · `market` 市场 / Market Structure · `macro_policy` 宏观与政策 / Macro & Policy. Layer list + display names live in the `LAYERS` constant.

## Conventions
- Everything is bilingual: node labels swap en/zh and all UI chrome switches via `UI_TEXT` + `applyLanguage()`. Language choice persists in `sessionStorage`.
- Layout is cose-bilkent (CDN) via `LAYOUT_BASE`, with a fallback to built-in `cose`.
- A node is visible only when both its **layer** and **bucket** toggles are on.
