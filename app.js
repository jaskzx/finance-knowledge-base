// Finance Knowledge Base — nodes colored by bucket (Step 5).
// Each node is colored by its `bucket` field on a single-hue blue light->dark
// sequential (ordinal) ramp that encodes CROSS-LANGUAGE CONCEPTUAL DISTANCE,
// not risk/correctness — so deliberately NOT green=good/red=bad. One hue means
// only lightness varies, which is colorblind-safe by construction. Still one
// layer at a time via the tab bar; no click behavior yet.

// Path is relative to index.html, so this works under GitHub Pages subpaths too.
const DATA_URL = "data/finance_kb.json";

// Layer value -> bilingual display name, in the spec's order. This is the single
// place the layer list and order live, so the tabs stay consistent.
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
// language (meta.default_language is "en"); when a language toggle exists later
// this text should follow it.
const BUCKET_MEANINGS = {
  A: "Translates cleanly",
  B: "Same concept, treated differently",
  C: "No real equivalent",
};

let kb = null; // the loaded knowledge base { meta, nodes, edges }
let cy = null; // the single Cytoscape instance we reuse across layers

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

  cy = createGraph();
  buildTabs();
  buildLegend();
  showLayer(LAYERS[0].id); // start on the first layer
}

// Create an empty Cytoscape instance; showLayer() fills it per layer.
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

// Build the tab bar buttons from LAYERS.
function buildTabs() {
  const nav = document.getElementById("layer-tabs");
  LAYERS.forEach((layer) => {
    const btn = document.createElement("button");
    btn.className = "tab";
    btn.dataset.layer = layer.id; // remember which layer this button selects
    // Bilingual label: English on top, Chinese below.
    btn.innerHTML =
      `<span class="tab-en">${layer.en}</span>` +
      `<span class="tab-zh">${layer.zh}</span>`;
    btn.addEventListener("click", () => showLayer(layer.id));
    nav.appendChild(btn);
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

// Render only the given layer's nodes (and the edges among them).
function showLayer(layerId) {
  const layer = LAYERS.find((l) => l.id === layerId);

  // Filter to this layer's nodes...
  const layerNodes = kb.nodes.filter((n) => n.layer === layerId);
  const idSet = new Set(layerNodes.map((n) => n.id));
  // ...and keep only edges whose both endpoints are in this layer.
  const layerEdges = kb.edges.filter(
    (e) => idSet.has(e.source) && idSet.has(e.target)
  );

  // Carry `bucket` so the per-bucket style rules can color each node.
  const nodeEls = layerNodes.map((n) => ({
    data: { id: n.id, label: n.en, bucket: n.bucket },
  }));
  const edgeEls = layerEdges.map((e, i) => ({
    data: { id: `e${i}`, source: e.source, target: e.target },
  }));

  // Swap the graph contents, then run the force layout on just this layer.
  cy.elements().remove();
  cy.add({ nodes: nodeEls, edges: edgeEls });
  cy
    .layout({
      name: "cose",
      animate: false, // settle instantly; fast for <= 60 nodes
      randomize: true,
      fit: true,
      padding: 40,
      componentSpacing: 120, // room between the many disconnected nodes
      idealEdgeLength: 80,
      nodeOverlap: 24, // extra repulsion so labels overlap less
    })
    .run();

  // Highlight the active tab.
  document.querySelectorAll("#layer-tabs .tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.layer === layerId);
  });

  // Update the status line: which layer + its counts.
  document.getElementById("status").textContent =
    `${layer.en} · ${layer.zh} — ${layerNodes.length} nodes, ${layerEdges.length} edges.`;
}

main();
