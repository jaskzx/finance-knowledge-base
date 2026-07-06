// Finance Knowledge Base — spread layout, scroll/arrow navigation, search (Step 7).
// Layout uses cose-bilkent (nodeDimensionsIncludeLabels so labels never overlap,
// tile:false + weak gravity + strong repulsion so nodes spread across the page
// instead of a central column). Navigate by mouse wheel (pan; Ctrl+wheel zooms)
// or arrow keys. A search box centers the matching node (revealing its layer if
// hidden) and does nothing if nothing matches. Toggling a layer reflows the
// visible nodes; positions are cached per visible-state so re-toggling restores
// the exact prior arrangement. Nodes are colored by bucket; EN/中 language toggle.

// Path is relative to index.html, so this works under GitHub Pages subpaths too.
const DATA_URL = "data/finance_kb.json";

// Layer value -> bilingual display name, in the spec's order. This is the single
// place the layer list and order live, so the toggles stay consistent.
const LAYERS = [
  { id: "company_fundamentals", en: "Company & Fundamentals", zh: "个股与基本面" },
  { id: "trading", en: "Trading", zh: "交易" },
  { id: "asset_classes", en: "Asset Classes", zh: "资产类别" },
  { id: "market", en: "Market Structure", zh: "市场" },
  { id: "macro_policy", en: "Macro & Policy", zh: "宏观与政策" },
];

// Bucket -> color, from the validated blue ordinal ramp (light A -> dark C).
// Light = small conceptual distance, dark = large. Contrast on the #fafafa
// surface: A 2.02:1, B 4.23:1, C 9.50:1 (A clears the 2:1 ordinal floor).
const BUCKET_COLORS = {
  A: "#86b6ef", // translates cleanly
  B: "#2a78d6", // same concept, treated differently
  C: "#104281", // no real equivalence
};

// All translatable UI chrome, keyed by language. status() is a function so the
// visible counts can be spliced into the sentence for each language.
const UI_TEXT = {
  en: {
    title: "Finance Knowledge Base",
    legendTitle: "Cross-language distance",
    bucket: {
      A: "Translates cleanly",
      B: "Same concept, treated differently",
      C: "No real equivalent",
    },
    status: (n, e) => `${n} nodes, ${e} edges visible.`,
    recenter: "Recenter",
  },
  zh: {
    title: "金融知识库",
    legendTitle: "跨语言概念距离",
    bucket: {
      A: "可直接对应翻译",
      B: "同一概念，处理方式不同",
      C: "没有真正对应的概念",
    },
    status: (n, e) => `显示 ${n} 个节点，${e} 条连线`,
    recenter: "重新居中",
  },
};

const LANG_KEY = "fkb-lang"; // sessionStorage key for the remembered language

// cose-bilkent if the extension loaded, else fall back to the built-in cose
// (which can't reserve label boxes, but at least still lays the graph out).
const LAYOUT_NAME =
  typeof window.cytoscapeCoseBilkent !== "undefined" ? "cose-bilkent" : "cose";

// Shared layout tuning. nodeDimensionsIncludeLabels reserves each node's label
// box (no overlap); weak gravity + strong repulsion spread nodes wide.
const LAYOUT_BASE = {
  name: LAYOUT_NAME,
  nodeDimensionsIncludeLabels: true, // spacing accounts for labels -> no overlap
  tile: false, // keep an organic cloud, not a tiled grid
  idealEdgeLength: 70,
  nodeRepulsion: 4500,
  gravity: 0.5, // pull the cloud together so gaps stay small
  gravityRange: 3.8,
  padding: 30,
};

let kb = null; // the loaded knowledge base { meta, nodes, edges }
let cy = null; // the single Cytoscape instance holding all nodes
let lang = readLang(); // "en" | "zh"; default English, or the session's choice
// Which layers are currently shown. Start with every layer on (all visible).
const visibleLayers = new Set(LAYERS.map((l) => l.id));
let nodeLayerById = new Map(); // node id -> layer, for counting visible edges
// Cache of node positions per visible-state so re-toggling restores the exact
// prior arrangement. Key = which layers are on; value = Map(nodeId -> {x,y}).
const posCache = new Map();

// Read the remembered language for this session; default to English. Wrapped
// because sessionStorage can throw when storage is blocked.
function readLang() {
  try {
    const saved = sessionStorage.getItem(LANG_KEY);
    if (saved === "en" || saved === "zh") return saved;
  } catch (e) {
    /* storage unavailable — fall through to the default */
  }
  return "en";
}

function saveLang(value) {
  try {
    sessionStorage.setItem(LANG_KEY, value);
  } catch (e) {
    /* storage unavailable — the choice just won't persist */
  }
}

async function main() {
  const statusEl = document.getElementById("status");

  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    kb = await response.json();
  } catch (err) {
    // Most common cause: opening index.html via file:// so fetch is blocked.
    statusEl.textContent =
      "Failed to load data. Serve over http:// (e.g. python3 -m http.server).";
    statusEl.classList.add("error");
    console.error(err);
    return;
  }

  nodeLayerById = new Map(kb.nodes.map((n) => [n.id, n.layer]));

  cy = createGraph();
  loadAllElements();
  buildToggles();
  buildLangToggle();
  // Recenter button: fit the visible nodes back into view (no re-layout).
  document.getElementById("recenter-btn").addEventListener("click", centerOnVisible);
  applyVisibility(); // all layers on to start, so nothing is hidden yet
  applyLanguage(); // apply the remembered/default language to labels + all chrome
  initialLayout(); // lay the full graph out once and cache it as the "all on" state
}

// Create an empty Cytoscape instance; loadAllElements() fills it.
function createGraph() {
  // One style rule per bucket, built from BUCKET_COLORS so colors live in one place.
  const bucketStyles = Object.entries(BUCKET_COLORS).map(([bucket, color]) => ({
    selector: `node[bucket = "${bucket}"]`,
    style: { "background-color": color },
  }));

  return cytoscape({
    container: document.getElementById("cy"),

    style: [
      {
        selector: "node",
        style: {
          "background-color": "#8a94a6", // fallback for any node missing a bucket
          "border-width": 1,
          "border-color": "rgba(0,0,0,0.25)", // thin ring so light (A) nodes still read
          width: 18,
          height: 18,
          label: "data(label)", // label is swapped between en/zh by applyLanguage
          "font-size": 10,
          color: "#333",
          "text-valign": "bottom",
          "text-halign": "center",
          "text-margin-y": 3,
          "text-wrap": "wrap", // wrap long labels...
          "text-max-width": "90px", // ...so they don't overlap sideways
          "min-zoomed-font-size": 6, // hide labels only when zoomed far out
        },
      },
      // Bucket color overrides (more specific, so they win over the base rule).
      ...bucketStyles,
      {
        selector: "edge",
        style: {
          width: 1,
          "line-color": "#dfe3e9", // light gray so edges recede behind the nodes
          "curve-style": "bezier",
        },
      },
    ],

    // pan (drag) and node-drag stay on by default.
  });
}

// Add every node and edge once. Layout is run separately (initialLayout).
function loadAllElements() {
  const nodeEls = kb.nodes.map((n) => ({
    // Carry both languages so the label can be swapped without a re-layout.
    data: {
      id: n.id,
      label: n.en, // starting label; applyLanguage sets the real one
      label_en: n.en,
      label_zh: n.zh,
      bucket: n.bucket,
      layer: n.layer,
    },
  }));

  // Guard: only draw edges whose endpoints both exist, else Cytoscape throws.
  const nodeIds = new Set(kb.nodes.map((n) => n.id));
  const edgeEls = kb.edges
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map((e, i) => ({ data: { id: `e${i}`, source: e.source, target: e.target } }));

  cy.add({ nodes: nodeEls, edges: edgeEls });
}

// The set of currently-on layers, as a stable cache key.
function stateKey() {
  return LAYERS.filter((l) => visibleLayers.has(l.id))
    .map((l) => l.id)
    .join("|");
}

// Snapshot positions of a node collection into a Map(id -> {x, y}).
function capturePositions(nodes) {
  const m = new Map();
  nodes.forEach((n) => m.set(n.id(), { x: n.position("x"), y: n.position("y") }));
  return m;
}

// Lay the whole (all-on) graph out once, then remember it as the full state.
function initialLayout() {
  const layout = cy.layout({ ...LAYOUT_BASE, randomize: true, animate: false, fit: true });
  layout.one("layoutstop", () => posCache.set(stateKey(), capturePositions(cy.nodes())));
  layout.run();
}

// After a toggle: reflow the visible nodes to fill the freed space, or — if we
// have seen this exact visible-state before — animate back to that arrangement.
function reflow() {
  const visible = cy.nodes(":visible");
  if (visible.empty()) return; // nothing to show

  const key = stateKey();
  const cached = posCache.get(key);
  if (cached) {
    // Seen before: glide every visible node back to its remembered spot.
    visible.forEach((n) => {
      const p = cached.get(n.id());
      if (p) n.animate({ position: p }, { duration: 400, easing: "ease-in-out" });
    });
    centerOnVisible();
    return;
  }

  // New state: re-run the layout on just the visible elements. randomize:false
  // starts from current positions, so nodes flow in from where they are;
  // animate:"end" tweens them to the compact result. Cache it when it settles.
  const layout = cy.elements(":visible").layout({
    ...LAYOUT_BASE,
    randomize: false,
    animate: "end",
    animationDuration: 450,
    fit: true,
  });
  layout.one("layoutstop", () =>
    posCache.set(key, capturePositions(cy.nodes(":visible")))
  );
  layout.run();
}

// Build the toggle bar from LAYERS; all start on (.active). Each button holds
// both language names; CSS shows the one matching the current UI language.
function buildToggles() {
  const nav = document.getElementById("layer-toggles");
  LAYERS.forEach((layer) => {
    const btn = document.createElement("button");
    btn.className = "toggle active"; // active = layer currently shown
    btn.type = "button";
    btn.dataset.layer = layer.id;
    btn.setAttribute("aria-pressed", "true");
    btn.innerHTML =
      `<span class="toggle-en">${layer.en}</span>` +
      `<span class="toggle-zh">${layer.zh}</span>`;
    btn.addEventListener("click", () => toggleLayer(layer.id, btn));
    nav.appendChild(btn);
  });
}

// Flip one layer on/off, refresh visibility, then reflow what's left.
function toggleLayer(layerId, btn) {
  const nowOn = !visibleLayers.has(layerId);
  if (nowOn) {
    visibleLayers.add(layerId);
  } else {
    visibleLayers.delete(layerId);
  }
  btn.classList.toggle("active", nowOn);
  btn.setAttribute("aria-pressed", String(nowOn));

  applyVisibility();
  updateStatus();
  reflow(); // compact the remaining nodes / restore the prior arrangement
}

// Show/hide elements based on visibleLayers. Nodes follow their own layer; an
// edge is shown only when BOTH endpoint layers are currently visible.
function applyVisibility() {
  cy.batch(() => {
    cy.nodes().forEach((n) => {
      const on = visibleLayers.has(n.data("layer"));
      n.style("display", on ? "element" : "none");
    });
    cy.edges().forEach((e) => {
      const bothOn =
        visibleLayers.has(e.source().data("layer")) &&
        visibleLayers.has(e.target().data("layer"));
      e.style("display", bothOn ? "element" : "none");
    });
  });
}

// Animate the viewport to fit the currently visible nodes (centers + zooms).
// Used by the Recenter button and after a cached reflow.
function centerOnVisible() {
  const visible = cy.nodes(":visible");
  if (visible.empty()) return; // nothing to center on
  cy.animate({
    fit: { eles: visible, padding: 50 },
    duration: 300,
    easing: "ease-in-out",
  });
}

// Wire the EN | 中 buttons to switch language.
function buildLangToggle() {
  document.querySelectorAll("#lang-toggle .lang-btn").forEach((btn) => {
    btn.addEventListener("click", () => setLanguage(btn.dataset.lang));
  });
}

// Change language, remember it for the session, and re-render everything.
function setLanguage(next) {
  if (next !== "en" && next !== "zh") return;
  lang = next;
  saveLang(lang);
  applyLanguage();
}

// Apply the current language to node labels and all UI chrome.
function applyLanguage() {
  const t = UI_TEXT[lang];

  // Root class drives the CSS that picks each toggle's language; lang attr helps a11y.
  document.body.classList.toggle("lang-zh", lang === "zh");
  document.body.classList.toggle("lang-en", lang === "en");
  document.documentElement.lang = lang === "zh" ? "zh" : "en";

  // Page title and recenter button label.
  document.getElementById("app-title").textContent = t.title;
  document.getElementById("recenter-btn").textContent = t.recenter;

  // Node labels: swap each to the chosen language's stored value.
  cy.batch(() => {
    cy.nodes().forEach((n) =>
      n.data("label", lang === "zh" ? n.data("label_zh") : n.data("label_en"))
    );
  });

  // Mark the active language button.
  document.querySelectorAll("#lang-toggle .lang-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.lang === lang);
  });

  buildLegend(); // legend text is language-dependent
  updateStatus(); // status sentence is language-dependent
}

// Build the bucket legend in the current language, from the shared constants.
function buildLegend() {
  const t = UI_TEXT[lang];
  const rows = ["A", "B", "C"]
    .map(
      (b) =>
        `<div class="legend-row">` +
        `<span class="legend-swatch" style="background:${BUCKET_COLORS[b]}"></span>` +
        `<span class="legend-key">${b}</span>` +
        `<span class="legend-meaning">${t.bucket[b]}</span>` +
        `</div>`
    )
    .join("");
  document.getElementById("legend").innerHTML =
    `<div class="legend-title">${t.legendTitle}</div>${rows}`;
}

// Status line: how many nodes/edges are currently visible, in the current language.
function updateStatus() {
  const nVisible = kb.nodes.filter((n) => visibleLayers.has(n.layer)).length;
  const eVisible = kb.edges.filter(
    (e) =>
      visibleLayers.has(nodeLayerById.get(e.source)) &&
      visibleLayers.has(nodeLayerById.get(e.target))
  ).length;
  document.getElementById("status").textContent = UI_TEXT[lang].status(
    nVisible,
    eVisible
  );
}

main();
