// Finance Knowledge Base — additive layer toggles (Step 4-toggles).
// Every node is loaded once and laid out once, so positions stay stable. Five
// toggles (one per layer, all on by default) additively show/hide their layer's
// nodes. An edge shows only when BOTH its endpoints are visible. Nodes are still
// colored by bucket; no click behavior yet. Labels are English for now — the
// language toggle comes next.

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

// One-line meaning per bucket, shown in the legend. English = current UI
// language (meta.default_language is "en"); a language toggle comes next.
const BUCKET_MEANINGS = {
  A: "Translates cleanly",
  B: "Same concept, treated differently",
  C: "No real equivalent",
};

let kb = null; // the loaded knowledge base { meta, nodes, edges }
let cy = null; // the single Cytoscape instance holding all nodes
// Which layers are currently shown. Start with every layer on (all visible).
const visibleLayers = new Set(LAYERS.map((l) => l.id));
let nodeLayerById = new Map(); // node id -> layer, for counting visible edges

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
  buildLegend();
  applyVisibility(); // all layers on to start, so nothing is hidden yet
  updateStatus();
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
          label: "data(label)",
          "font-size": 10,
          color: "#333",
          "text-valign": "bottom",
          "text-halign": "center",
          "text-margin-y": 3,
          "text-wrap": "wrap", // wrap long English labels...
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

    // pan / zoom / node-drag are all enabled by default in Cytoscape.
  });
}

// Add every node and edge once, then lay the whole graph out a single time.
// Keeping one stable layout means toggling a layer never re-scatters the rest.
function loadAllElements() {
  const nodeEls = kb.nodes.map((n) => ({
    data: { id: n.id, label: n.en, bucket: n.bucket, layer: n.layer },
  }));

  // Guard: only draw edges whose endpoints both exist, else Cytoscape throws.
  const nodeIds = new Set(kb.nodes.map((n) => n.id));
  const edgeEls = kb.edges
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map((e, i) => ({ data: { id: `e${i}`, source: e.source, target: e.target } }));

  cy.add({ nodes: nodeEls, edges: edgeEls });
  cy
    .layout({
      name: "cose",
      animate: false, // settle instantly
      randomize: true,
      fit: true,
      padding: 40,
      componentSpacing: 120, // room between the many disconnected nodes
      idealEdgeLength: 80,
      nodeOverlap: 24, // extra repulsion so labels overlap less
    })
    .run();
}

// Build the toggle bar from LAYERS; all start on (.active).
function buildToggles() {
  const nav = document.getElementById("layer-toggles");
  LAYERS.forEach((layer) => {
    const btn = document.createElement("button");
    btn.className = "toggle active"; // active = layer currently shown
    btn.dataset.layer = layer.id;
    btn.setAttribute("aria-pressed", "true");
    // Bilingual display name: English on top, Chinese below.
    btn.innerHTML =
      `<span class="toggle-en">${layer.en}</span>` +
      `<span class="toggle-zh">${layer.zh}</span>`;
    btn.addEventListener("click", () => toggleLayer(layer.id, btn));
    nav.appendChild(btn);
  });
}

// Flip one layer on/off, then refresh what's visible.
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

// Build the bucket legend from the same color/meaning constants as the nodes.
function buildLegend() {
  const el = document.getElementById("legend");
  const rows = ["A", "B", "C"]
    .map(
      (b) =>
        `<div class="legend-row">` +
        `<span class="legend-swatch" style="background:${BUCKET_COLORS[b]}"></span>` +
        `<span class="legend-key">${b}</span>` +
        `<span class="legend-meaning">${BUCKET_MEANINGS[b]}</span>` +
        `</div>`
    )
    .join("");
  el.innerHTML = `<div class="legend-title">Cross-language distance</div>${rows}`;
}

// Status line: how many nodes/edges are currently visible.
function updateStatus() {
  const nVisible = kb.nodes.filter((n) => visibleLayers.has(n.layer)).length;
  const eVisible = kb.edges.filter(
    (e) =>
      visibleLayers.has(nodeLayerById.get(e.source)) &&
      visibleLayers.has(nodeLayerById.get(e.target))
  ).length;
  document.getElementById("status").textContent =
    `${nVisible} nodes, ${eVisible} edges visible.`;
}

main();
