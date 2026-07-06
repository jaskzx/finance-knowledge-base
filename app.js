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
    searchPlaceholder: "Search a term…",
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
    searchPlaceholder: "搜索术语…",
  },
};

const LANG_KEY = "fkb-lang"; // sessionStorage key for the remembered language

// cose-bilkent if the extension loaded, else fall back to the built-in cose
// (which can't reserve label boxes, but at least still lays the graph out).
const LAYOUT_NAME =
  typeof window.cytoscapeCoseBilkent !== "undefined" ? "cose-bilkent" : "cose";

// Touch devices (coarse pointer, e.g. phones) keep Cytoscape's native pinch-zoom
// and drag-pan; on mouse devices we disable zoom so a plain wheel can pan instead
// (with Ctrl+wheel to zoom) — see createGraph() and setupNavigation().
const IS_TOUCH =
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;

// Shared layout tuning. nodeDimensionsIncludeLabels reserves each node's label
// box (no overlap); weak gravity + strong repulsion spread nodes wide.
const LAYOUT_BASE = {
  name: LAYOUT_NAME,
  nodeDimensionsIncludeLabels: true, // spacing accounts for labels -> no overlap
  tile: false, // keep an organic cloud, not a tiled grid
  idealEdgeLength: 100,
  nodeRepulsion: 10000, // strong push so nodes fill the width, not a center column
  gravity: 0.1, // weak center pull so the cloud spreads out
  gravityRange: 4.5,
  padding: 40,
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
  setupSearch();
  setupNavigation(); // wheel-to-pan / Ctrl+wheel zoom / arrow keys
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

    // On mouse devices, disable zoom so a plain wheel can pan (Ctrl+wheel zooms,
    // added in setupNavigation). On touch devices, keep native pinch-zoom.
    userZoomingEnabled: IS_TOUCH,

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
        // Transient highlight for a searched node (amber ring — not part of the
        // blue conceptual-distance encoding, so it can't be misread as a bucket).
        selector: "node.searched",
        style: { "border-color": "#f5a623", "border-width": 4 },
      },
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

// Widen node x-positions so the cloud fills the viewport width instead of a
// central column. cose-bilkent makes a roughly round cloud; fitting that on a
// wide screen leaves big side margins. Stretching x to match the container's
// aspect ratio fills the width. Only x is scaled, and only outward, so labels
// never get MORE crowded.
function spreadToWidth(nodes) {
  if (nodes.empty()) return;
  const bb = nodes.boundingBox();
  const el = document.getElementById("cy");
  const W = el.clientWidth || 1;
  const H = el.clientHeight || 1;
  if (bb.w <= 0 || bb.h <= 0) return;

  const targetAspect = W / H;
  const currentAspect = bb.w / bb.h;
  if (currentAspect >= targetAspect) return; // already at least as wide as the screen
  const s = Math.min(targetAspect / currentAspect, 2.5); // cap the stretch

  const cx = (bb.x1 + bb.x2) / 2;
  nodes.forEach((n) => n.position("x", cx + (n.position("x") - cx) * s));
}

// Glide a set of nodes to remembered/target positions.
function animateNodesTo(nodes, posMap) {
  nodes.forEach((n) => {
    const p = posMap.get(n.id());
    if (p) n.animate({ position: p }, { duration: 400, easing: "ease-in-out" });
  });
}

// Run the force layout on the visible elements, widen it to fill the screen,
// cache the result, and settle the view. animateFromPrev true => nodes glide
// from where they are (on toggle); false => the first, fresh layout.
function runLayout(animateFromPrev) {
  const nodes = cy.nodes(":visible");
  if (nodes.empty()) return;
  const key = stateKey();
  const prev = animateFromPrev ? capturePositions(nodes) : null;

  // animate:false — we compute positions, widen them, then animate the move.
  const layout = cy.elements(":visible").layout({
    ...LAYOUT_BASE,
    randomize: !animateFromPrev, // fresh spread first time; incremental on toggle
    animate: false,
    fit: false,
  });
  layout.one("layoutstop", () => {
    spreadToWidth(nodes); // widen the cloud to fill the width
    const target = capturePositions(nodes);
    posCache.set(key, target);
    if (animateFromPrev) {
      prev.forEach((p, id) => cy.getElementById(id).position(p)); // back to start...
      animateNodesTo(nodes, target); // ...then glide to the widened target
    }
    cy.animate({
      fit: { eles: nodes, padding: 50 },
      duration: animateFromPrev ? 400 : 250,
      easing: "ease-in-out",
    });
  });
  layout.run();
}

// Lay the whole (all-on) graph out once, then remember it as the full state.
function initialLayout() {
  runLayout(false);
}

// After a toggle: animate back to a seen arrangement, or lay out + widen a new one.
function reflow() {
  const visible = cy.nodes(":visible");
  if (visible.empty()) return; // nothing to show

  const cached = posCache.get(stateKey());
  if (cached) {
    // Seen before: glide every visible node back to its remembered spot.
    animateNodesTo(visible, cached);
    centerOnVisible();
    return;
  }
  runLayout(true); // new state: lay out, widen, and animate in
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
    btn.addEventListener("click", () => toggleLayer(layer.id));
    nav.appendChild(btn);
  });
}

// Set a layer's on/off state in both the model and its toggle button (no reflow;
// the caller decides when to reflow). Shared by the toggles and search-reveal.
function setLayerState(layerId, on) {
  if (on) {
    visibleLayers.add(layerId);
  } else {
    visibleLayers.delete(layerId);
  }
  const btn = document.querySelector(`#layer-toggles .toggle[data-layer="${layerId}"]`);
  if (btn) {
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));
  }
}

// Flip one layer, refresh visibility, then reflow what's left.
function toggleLayer(layerId) {
  setLayerState(layerId, !visibleLayers.has(layerId));
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

// --- Navigation: wheel/pinch + arrow keys; keep the canvas sized to its box. ---
function setupNavigation() {
  const container = document.getElementById("cy");

  // Keep the graph sized to its container across window resizes / orientation flips.
  window.addEventListener("resize", () => cy.resize());

  // Mouse devices only: plain wheel pans, Ctrl/Cmd+wheel zooms toward the cursor.
  // On touch we leave zoom to Cytoscape's native pinch, so we don't hijack input.
  if (!IS_TOUCH) {
    container.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault(); // stop the page from scrolling
        if (ev.ctrlKey || ev.metaKey) {
          const factor = Math.exp(-ev.deltaY * 0.001); // gentle zoom
          cy.zoom({
            level: cy.zoom() * factor,
            renderedPosition: { x: ev.offsetX, y: ev.offsetY },
          });
        } else {
          // Move the content opposite the scroll direction (natural scrolling).
          cy.panBy({ x: -ev.deltaX, y: -ev.deltaY });
        }
      },
      { passive: false }
    );
  }

  // Arrow keys pan. Ignore when typing in the search box.
  document.addEventListener("keydown", (ev) => {
    const tag = ev.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const step = 80;
    const moves = {
      ArrowUp: { x: 0, y: step },
      ArrowDown: { x: 0, y: -step },
      ArrowLeft: { x: step, y: 0 },
      ArrowRight: { x: -step, y: 0 },
    };
    const move = moves[ev.key];
    if (!move) return;
    ev.preventDefault();
    cy.panBy(move);
  });
}

// --- Search: center the matching node; do nothing if nothing matches. ---
function setupSearch() {
  const input = document.getElementById("search");
  input.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    const node = findNode(input.value);
    if (node) revealNode(node); // no match -> do nothing
  });
}

// Find a node whose name/alias matches the query (case-insensitive). Prefers an
// exact match, then falls back to a substring match. Returns the cy node or null.
function findNode(query) {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  const fieldsOf = (n) =>
    [n.en, n.zh, ...(n.aliases_en || []), ...(n.aliases_zh || [])].filter(Boolean);

  let hit = kb.nodes.find((n) => fieldsOf(n).some((f) => f.toLowerCase() === q));
  if (!hit) {
    hit = kb.nodes.find((n) => fieldsOf(n).some((f) => f.toLowerCase().includes(q)));
  }
  return hit ? cy.getElementById(hit.id) : null;
}

// Make sure a node is visible (turn its layer on if needed), then center + flash it.
function revealNode(node) {
  const layerId = node.data("layer");
  if (!visibleLayers.has(layerId)) {
    setLayerState(layerId, true);
    applyVisibility();
    updateStatus();
    reflow();
  }
  centerNode(node);
}

// Pan/zoom to a single node and briefly highlight it.
function centerNode(node) {
  cy.animate(
    { center: { eles: node }, zoom: Math.max(cy.zoom(), 1.4) },
    { duration: 400, easing: "ease-in-out" }
  );
  node.addClass("searched");
  // Remove the highlight after a moment (no persistent selection state to track).
  setTimeout(() => node.removeClass("searched"), 1600);
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

  // Page title, recenter button label, search placeholder.
  document.getElementById("app-title").textContent = t.title;
  document.getElementById("recenter-btn").textContent = t.recenter;
  document.getElementById("search").placeholder = t.searchPlaceholder;

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
