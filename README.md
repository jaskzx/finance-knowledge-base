# Finance Knowledge Base / 金融知识库

An interactive, bilingual (English / 中文) knowledge graph of finance terms. Every
term is a node; related terms are linked; and each node is colored by **how
cleanly the concept crosses between English and Chinese**. It's a static site —
plain HTML, CSS, and vanilla JavaScript, with [Cytoscape.js](https://js.cytoscape.org/)
(loaded from a CDN) drawing the force-directed graph. No build step, no framework.

## The A/B/C idea: cross-language conceptual distance

The coloring is **not** good/bad or risk — it encodes how far apart the two
languages treat a concept:

| Bucket | Meaning | Color |
|--------|---------|-------|
| **A** | Translates cleanly — a clean cross-language equivalent | green |
| **B** | Same concept, treated differently across languages/standards | amber |
| **C** | No real equivalence — the idea doesn't map across | red |

(The palette is a preference; note that green/amber/red is a traffic-light scheme
and green–red is the hardest pair for red-green color vision deficiency, so the
shades also differ in lightness.)

## Features

- **Force-directed graph** of all terms, labeled in the current language.
- **Layer toggles** — show/hide the five knowledge layers (additive).
- **Bucket toggles** — show/hide by A/B/C bucket (additive; combines with layers).
- **Divergence spotlight** — dim everything except bucket C so the no-equivalence
  terms stand out.
- **Language toggle (EN ⇄ 中)** — flips every label and all UI chrome; remembered
  for the session.
- **Search** — center a term by name or alias.
- **Hover tooltip** (desktop) and **click/tap detail panel** — definition, nuance
  note, formula, and clickable connected terms.
- **Navigation** — scroll / Ctrl-wheel zoom / arrow keys (mouse); pinch + drag
  (touch); double-tap to zoom in to a readable level, triple-tap to zoom out.
- Works on phone-width screens.

## Data

`data/finance_kb.json` is the single source of truth (the app only reads it). Its
shape is `{ meta, nodes, edges }`.

**meta**: `schema_version`, `default_language`, `node_count`, `edge_count`.

**node** fields:

| field | notes |
|-------|-------|
| `id` | unique id (edge endpoints reference this) |
| `en`, `zh` | term in each language |
| `aliases_en[]`, `aliases_zh[]` | alternative names (searchable) |
| `layer` | one of the five layers (below) |
| `subgroup` | finer grouping within a layer |
| `bucket` | `A` \| `B` \| `C` — cross-language distance |
| `priority` | boolean |
| `definition_en`, `definition_zh` | full definitions |
| `nuance_note_en`, `nuance_note_zh` | cross-language nuance |
| `formula_display` | formula string, when applicable |

**edge** fields: `source`, `target`, `type` (`formula` \| `family`), optional `label`.

**Layers** (`layer` value → 中文 / English):

- `company_fundamentals` → 个股与基本面 / Company & Fundamentals
- `trading` → 交易 / Trading
- `asset_classes` → 资产类别 / Asset Classes
- `market` → 市场 / Market Structure
- `macro_policy` → 宏观与政策 / Macro & Policy

## Run locally

`fetch()` of a local file is blocked on `file://`, so serve it over HTTP:

```sh
python3 -m http.server
```

Then open <http://localhost:8000>.

## Deploy (GitHub Pages)

This is a static site, so GitHub Pages serves it as-is from the repo root. See the
Pages settings (Settings → Pages → deploy from `main`, `/root`).

## Files

- `index.html` — page structure
- `style.css` — styling (light/dark aware, responsive)
- `app.js` — data load, graph rendering, and all interactions
- `data/finance_kb.json` — the knowledge base (read-only source of truth)

## Credits

Term data was assembled from a bilingual finance glossary.
