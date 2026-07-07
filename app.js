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

// Bucket -> color: green (A) / amber (B) / red (C), per preference. Note this is
// a traffic-light scheme; green vs red is the hardest pair for red-green color
// vision deficiency, so the shades also differ in lightness as a fallback cue.
const BUCKET_COLORS = {
  A: "#1f9e4d", // translates cleanly (green)
  B: "#e6a012", // same concept, treated differently (amber)
  C: "#d63a2f", // no real equivalence (red)
};

// All translatable UI chrome, keyed by language. status() is a function so the
// visible counts can be spliced into the sentence for each language.
const UI_TEXT = {
  en: {
    title: "Finance Knowledge Base",
    tagline: "Bilingual finance terms, colored by cross-language distance.",
    bucket: {
      A: "Translates cleanly",
      B: "Same concept, treated differently",
      C: "No real equivalent",
    },
    status: (n, e) => `${n} nodes, ${e} edges visible.`,
    recenter: "Recenter",
    spotlight: "Divergence spotlight",
    searchPlaceholder: "Search a term…",
    index: {
      title: "Terms",
      open: "☰ Terms",
      collapse: "Collapse term list",
      empty: "No terms shown.",
    },
    panel: {
      subgroup: "Subgroup",
      bucket: "Bucket",
      definition: "Definition",
      nuance: "Nuance",
      formula: "Formula",
      connected: "Connected terms",
      none: "—",
      close: "Close",
    },
  },
  zh: {
    title: "金融知识库",
    tagline: "双语金融术语，按跨语言差异着色。",
    bucket: {
      A: "可直接对应翻译",
      B: "同一概念，处理方式不同",
      C: "没有真正对应的概念",
    },
    status: (n, e) => `显示 ${n} 个节点，${e} 条连线`,
    recenter: "重新居中",
    spotlight: "差异聚焦",
    searchPlaceholder: "搜索术语…",
    index: {
      title: "术语",
      open: "☰ 术语",
      collapse: "收起术语列表",
      empty: "暂无术语",
    },
    panel: {
      subgroup: "子类",
      bucket: "分类",
      definition: "定义",
      nuance: "细微差别",
      formula: "公式",
      connected: "相关术语",
      none: "—",
      close: "关闭",
    },
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
// Which layers / buckets are currently shown. Start with everything on. A node
// is visible only when BOTH its layer and its bucket are enabled.
const visibleLayers = new Set(LAYERS.map((l) => l.id));
const visibleBuckets = new Set(["A", "B", "C"]);
let nodeById = new Map(); // node id -> full node record (panel + visibility checks)
// Cache of node positions per visible-state so re-toggling restores the exact
// prior arrangement. Key = which layers are on; value = Map(nodeId -> {x,y}).
const posCache = new Map();
let openNodeId = null; // id of the node whose detail panel is open, or null
let panelNuanceLang = "en"; // which language the panel's nuance note shows
let spotlightOn = false; // divergence spotlight: dim all but bucket C
let indexCollapsed = false; // left term index collapsed to its reopen button?
const collapsedLayers = new Set(); // layer ids whose index section is collapsed

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

  nodeById = new Map(kb.nodes.map((n) => [n.id, n]));

  cy = createGraph();
  loadAllElements();
  buildToggles();
  buildBucketToggles();
  buildLangToggle();
  setupSearch();
  setupTermIndex(); // left index: collapse controls + click-to-center
  setupNavigation(); // wheel-to-pan / Ctrl+wheel zoom / arrow keys
  setupInteractions(); // hover tooltip + click/tap detail panel
  // Recenter button: fit the visible nodes back into view (no re-layout).
  document.getElementById("recenter-btn").addEventListener("click", centerOnVisible);
  document.getElementById("spotlight-btn").addEventListener("click", toggleSpotlight);
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
          "border-color": "rgba(0,0,0,0.3)", // thin ring so the light (C) nodes still read
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
        // Transient highlight for a searched node: a white ring edged in black
        // via an outline, so it reads on any bucket color (amber B was hard to
        // see with the old yellow ring) as well as the light canvas.
        selector: "node.searched",
        style: {
          "border-color": "#fff",
          "border-width": 4, // same ring thickness as before
          "outline-color": "#000",
          "outline-width": 2,
          "outline-offset": 0,
        },
      },
      {
        // Divergence spotlight: everything but bucket C fades back.
        selector: "node.dimmed",
        style: { opacity: 0.15, "text-opacity": 0.15 },
      },
      {
        selector: "edge",
        style: {
          width: 1,
          "line-color": "#dfe3e9", // light gray so edges recede behind the nodes
          "curve-style": "bezier",
        },
      },
      {
        selector: "edge.dimmed",
        style: { opacity: 0.08 },
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

// The current visible-state (layers + buckets), as a stable cache key.
function stateKey() {
  const layers = LAYERS.filter((l) => visibleLayers.has(l.id))
    .map((l) => l.id)
    .join("|");
  const buckets = ["A", "B", "C"].filter((b) => visibleBuckets.has(b)).join("");
  return `${layers}#${buckets}`;
}

// A node is visible only when both its layer and its bucket are enabled.
function isNodeVisible(data) {
  return visibleLayers.has(data.layer) && visibleBuckets.has(data.bucket);
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
  buildTermIndex(); // the left index tracks what's visible
  reflow(); // compact the remaining nodes / restore the prior arrangement
}

// Build the bucket toggle bar (A / B / C), each with its color dot + meaning.
function buildBucketToggles() {
  const nav = document.getElementById("bucket-toggles");
  ["A", "B", "C"].forEach((b) => {
    const btn = document.createElement("button");
    btn.className = "toggle bucket-toggle active";
    btn.type = "button";
    btn.dataset.bucket = b;
    btn.innerHTML =
      `<span class="bucket-dot" style="background:${BUCKET_COLORS[b]}"></span>` +
      `<span class="bucket-key">${b}</span>` +
      `<span class="bucket-meaning"></span>`;
    btn.addEventListener("click", () => toggleBucket(b));
    nav.appendChild(btn);
  });
  refreshBucketLabels(); // fill meanings + active state in the current language
}

// Update each bucket toggle's meaning text (language-dependent) and on/off state.
function refreshBucketLabels() {
  document.querySelectorAll("#bucket-toggles .bucket-toggle").forEach((btn) => {
    const b = btn.dataset.bucket;
    btn.querySelector(".bucket-meaning").textContent = UI_TEXT[lang].bucket[b];
    const on = visibleBuckets.has(b);
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));
  });
}

// Flip one bucket on/off, refresh visibility, then reflow what's left.
function toggleBucket(b) {
  if (visibleBuckets.has(b)) {
    visibleBuckets.delete(b);
  } else {
    visibleBuckets.add(b);
  }
  refreshBucketLabels();
  applyVisibility();
  updateStatus();
  buildTermIndex(); // the left index tracks what's visible
  reflow();
}

// Divergence spotlight: dim everything except bucket C and the edges touching it,
// so the no-equivalence concepts stand out (nodes stay in place, just faded).
function toggleSpotlight() {
  spotlightOn = !spotlightOn;
  const btn = document.getElementById("spotlight-btn");
  btn.classList.toggle("active", spotlightOn);
  btn.setAttribute("aria-pressed", String(spotlightOn));
  applySpotlight();
}

function applySpotlight() {
  cy.batch(() => {
    if (!spotlightOn) {
      cy.elements().removeClass("dimmed"); // back to normal
      return;
    }
    cy.nodes().forEach((n) => n.toggleClass("dimmed", n.data("bucket") !== "C"));
    cy.edges().forEach((e) => {
      const touchesC =
        e.source().data("bucket") === "C" || e.target().data("bucket") === "C";
      e.toggleClass("dimmed", !touchesC);
    });
  });
}

// Show/hide elements by layer AND bucket. An edge is shown only when both of
// its endpoints are visible.
function applyVisibility() {
  cy.batch(() => {
    cy.nodes().forEach((n) => {
      n.style("display", isNodeVisible(n.data()) ? "element" : "none");
    });
    cy.edges().forEach((e) => {
      const bothOn =
        isNodeVisible(e.source().data()) && isNodeVisible(e.target().data());
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
    buildTermIndex(); // revealing a hidden layer adds its terms to the index
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

// Double-tap zooms in to at least this level, where the 10px labels render big
// enough to read (rendered font ≈ 10 * zoom px, so 2 ≈ 20px).
const READABLE_ZOOM = 2;

// Animate zoom to an absolute level, centered on a rendered (screen) point.
function zoomToLevel(renderedPosition, level) {
  const clamped = Math.min(5, Math.max(0.05, level));
  const rp = renderedPosition || { x: cy.width() / 2, y: cy.height() / 2 };
  cy.animate(
    { zoom: { level: clamped, renderedPosition: rp } },
    { duration: 200, easing: "ease-out" }
  );
}

// --- Hover tooltip (desktop) + tap gestures (panel / double-tap zoom in /
//     triple-tap zoom out). ---
function setupInteractions() {
  // Hover tooltip is a desktop-only nicety (touch has no hover).
  if (!IS_TOUCH) {
    cy.on("mouseover", "node", (evt) => showTooltip(evt.target));
    cy.on("mouseout", "node", hideTooltip);
    cy.on("pan zoom", hideTooltip); // don't leave a stale tooltip while moving
  }

  // One tap = open/close the panel; two taps = zoom in; three = zoom out. We
  // wait a short window to tell them apart, so a single tap resolves a beat
  // after you lift off (the cost of supporting double/triple tap).
  const TAP_WINDOW = 220; // ms to wait for further taps
  let taps = 0;
  let tapTimer = null;
  let firstTarget = null;
  let firstRendered = null;

  cy.on("tap", (evt) => {
    hideTooltip();
    taps += 1;
    if (taps === 1) {
      firstTarget = evt.target; // a node, or cy itself for empty canvas
      firstRendered = evt.renderedPosition;
    }
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => {
      const count = taps;
      taps = 0;
      if (count === 1) {
        if (firstTarget !== cy) openPanel(firstTarget.id()); // node -> details
        else closePanel(); // empty canvas -> close panel
      } else if (count === 2) {
        // Double tap -> zoom in to at least a readable level (further if already there).
        zoomToLevel(firstRendered, Math.max(READABLE_ZOOM, cy.zoom() * 1.8));
      } else {
        zoomToLevel(firstRendered, cy.zoom() / 1.8); // triple (or more) -> zoom out
      }
    }, TAP_WINDOW);
  });

  // Delegated clicks inside the panel: close, related term, nuance toggle.
  document.getElementById("detail-panel").addEventListener("click", (ev) => {
    const el = ev.target;
    if (el.classList.contains("panel-close")) {
      closePanel();
    } else if (el.classList.contains("rel-term")) {
      openPanel(el.dataset.id);
      centerNode(cy.getElementById(el.dataset.id)); // re-focus the clicked term
    } else if (el.classList.contains("nuance-toggle")) {
      panelNuanceLang = panelNuanceLang === "en" ? "zh" : "en";
      renderPanel();
    }
  });
}

// Small HTML escaper for text pulled from the data into innerHTML.
function esc(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

// Show a lightweight tooltip above a node: both terms + a one-line definition.
function showTooltip(node) {
  const n = nodeById.get(node.id());
  if (!n) return;
  const def = (lang === "zh" ? n.definition_zh : n.definition_en) || "";
  const tip = document.getElementById("tooltip");
  tip.innerHTML =
    `<div class="tt-term">${esc(n.en)} · ${esc(n.zh)}</div>` +
    (def ? `<div class="tt-def">${esc(def)}</div>` : "");
  const rp = node.renderedPosition(); // position within the #cy box
  tip.style.left = `${rp.x}px`;
  tip.style.top = `${rp.y}px`;
  tip.hidden = false;
}

function hideTooltip() {
  document.getElementById("tooltip").hidden = true;
}

// Node ids directly connected to `id` via any edge (both directions).
function connectedTerms(id) {
  const ids = [];
  kb.edges.forEach((e) => {
    if (e.source === id) ids.push(e.target);
    else if (e.target === id) ids.push(e.source);
  });
  return [...new Set(ids)];
}

// "statement_items" -> "Statement items" (the data has no bilingual subgroup names).
function humanizeSubgroup(s) {
  return s ? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "";
}

// Open the detail panel for a node id.
function openPanel(id) {
  openNodeId = id;
  panelNuanceLang = lang; // nuance starts in the current UI language
  renderPanel();
  document.getElementById("detail-panel").hidden = false;
}

function closePanel() {
  openNodeId = null;
  document.getElementById("detail-panel").hidden = true;
}

// Render the open node into the panel, in the current UI language.
function renderPanel() {
  if (!openNodeId) return;
  const n = nodeById.get(openNodeId);
  if (!n) return;
  const t = UI_TEXT[lang];
  const p = t.panel;

  const definition = lang === "zh" ? n.definition_zh : n.definition_en;

  // Nuance in the chosen language; fall back to the other if the chosen is empty.
  const nuanceEn = n.nuance_note_en || "";
  const nuanceZh = n.nuance_note_zh || "";
  let shownLang = panelNuanceLang;
  let nuance = shownLang === "zh" ? nuanceZh : nuanceEn;
  if (!nuance && (shownLang === "zh" ? nuanceEn : nuanceZh)) {
    shownLang = shownLang === "zh" ? "en" : "zh";
    nuance = shownLang === "zh" ? nuanceZh : nuanceEn;
  }
  const otherNuance = shownLang === "zh" ? nuanceEn : nuanceZh;
  const otherLabel = shownLang === "zh" ? "Show English" : "显示中文";

  // Directly connected terms, labelled in the current language, clickable.
  const rels = connectedTerms(n.id)
    .map((id) => nodeById.get(id))
    .filter(Boolean)
    .map(
      (m) =>
        `<button class="rel-term" type="button" data-id="${esc(m.id)}">` +
        `${esc(lang === "zh" ? m.zh : m.en)}</button>`
    )
    .join("");

  const field = (label, body) =>
    `<div class="panel-field"><div class="panel-label">${esc(label)}</div>${body}</div>`;

  let html = `<button class="panel-close" type="button" aria-label="${esc(p.close)}">×</button>`;
  html += `<div class="panel-terms-en">${esc(n.en)}</div>`;
  html += `<div class="panel-terms-zh">${esc(n.zh)}</div>`;
  if (n.subgroup) html += field(p.subgroup, esc(humanizeSubgroup(n.subgroup)));
  html += field(
    p.bucket,
    `<span class="panel-bucket-swatch" style="background:${
      BUCKET_COLORS[n.bucket] || "#8a94a6"
    }"></span>${esc(n.bucket)} — ${esc(t.bucket[n.bucket] || "")}`
  );
  if (definition) html += field(p.definition, esc(definition));
  if (nuance) {
    const toggle = otherNuance
      ? ` <button class="nuance-toggle" type="button">${esc(otherLabel)}</button>`
      : "";
    html += field(p.nuance, esc(nuance) + toggle);
  }
  if (n.formula_display) {
    html += field(p.formula, `<div class="panel-formula">${esc(n.formula_display)}</div>`);
  }
  html += field(p.connected, rels || esc(p.none));

  document.getElementById("detail-panel").innerHTML = html;
}

// --- Left term index: a collapsible list of the currently-visible terms,
//     grouped by layer then subgroup and sorted, each entry centering its node. ---

// Wire the collapse controls and the delegated clicks (section headers collapse
// a layer; term rows center the node). The body is (re)built by buildTermIndex.
function setupTermIndex() {
  document
    .getElementById("term-index-toggle")
    .addEventListener("click", () => setIndexCollapsed(true));
  document
    .getElementById("term-index-open")
    .addEventListener("click", () => setIndexCollapsed(false));

  document.getElementById("term-index-body").addEventListener("click", (ev) => {
    // Layer header: collapse/expand just that layer's section.
    const head = ev.target.closest(".ti-layer-head");
    if (head) {
      const section = head.closest(".ti-layer");
      const layerId = section.dataset.layer;
      const nowCollapsed = !collapsedLayers.has(layerId);
      if (nowCollapsed) collapsedLayers.add(layerId);
      else collapsedLayers.delete(layerId);
      section.classList.toggle("collapsed", nowCollapsed);
      head.setAttribute("aria-expanded", String(!nowCollapsed));
      return;
    }
    // Term row: center (and flash) its node — "leads to" the node on the graph.
    const term = ev.target.closest(".ti-term");
    if (term) {
      const node = cy.getElementById(term.dataset.id);
      if (node.nonempty()) centerNode(node);
    }
  });

  // On a phone the index would cover most of the graph, so start it collapsed.
  if (window.matchMedia && window.matchMedia("(max-width: 640px)").matches) {
    setIndexCollapsed(true);
  }
}

// Show/hide the whole index panel (and swap in its floating reopen button).
function setIndexCollapsed(collapsed) {
  indexCollapsed = collapsed;
  document.getElementById("term-index").hidden = collapsed;
  document.getElementById("term-index-open").hidden = !collapsed;
}

// Index chrome that depends on language: the title and the reopen button label.
function refreshIndexChrome() {
  const t = UI_TEXT[lang].index;
  document.querySelector(".term-index-title").textContent = t.title;
  const toggle = document.getElementById("term-index-toggle");
  toggle.textContent = "«"; // collapse chevron (points at the panel edge)
  toggle.setAttribute("aria-label", t.collapse);
  document.getElementById("term-index-open").textContent = t.open;
}

// Rebuild the index body from the current visible-state, in the current language.
function buildTermIndex() {
  const body = document.getElementById("term-index-body");
  const visibleNodes = kb.nodes.filter((n) => isNodeVisible(n));
  const label = (n) => (lang === "zh" ? n.zh : n.en);
  const collator = lang === "zh" ? "zh" : "en";

  let html = "";
  LAYERS.forEach((layer) => {
    const inLayer = visibleNodes.filter((n) => n.layer === layer.id);
    if (!inLayer.length) return; // skip layers with nothing visible right now

    const collapsed = collapsedLayers.has(layer.id);
    const name = lang === "zh" ? layer.zh : layer.en;

    html +=
      `<section class="ti-layer${collapsed ? " collapsed" : ""}" data-layer="${esc(layer.id)}">` +
      `<button class="ti-layer-head" type="button" aria-expanded="${String(!collapsed)}">` +
      `<span class="ti-caret" aria-hidden="true">▾</span>` +
      `<span class="ti-layer-name">${esc(name)}</span>` +
      `<span class="ti-count">${inLayer.length}</span></button>` +
      `<div class="ti-layer-body">`;

    // Subgroups in the order they first appear in the data for this layer, so the
    // headings match the graph's conceptual grouping.
    const subOrder = [];
    inLayer.forEach((n) => {
      const s = n.subgroup || "";
      if (!subOrder.includes(s)) subOrder.push(s);
    });

    subOrder.forEach((sub) => {
      if (sub) html += `<div class="ti-sub">${esc(humanizeSubgroup(sub))}</div>`;
      inLayer
        .filter((n) => (n.subgroup || "") === sub)
        .sort((a, b) => label(a).localeCompare(label(b), collator))
        .forEach((n) => {
          html +=
            `<button class="ti-term" type="button" data-id="${esc(n.id)}">` +
            `<span class="ti-dot" style="background:${
              BUCKET_COLORS[n.bucket] || "#8a94a6"
            }"></span>${esc(label(n))}</button>`;
        });
    });

    html += `</div></section>`;
  });

  body.innerHTML = html || `<p class="ti-empty">${esc(UI_TEXT[lang].index.empty)}</p>`;
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

  // Page title, tagline, buttons, and search placeholder.
  document.getElementById("app-title").textContent = t.title;
  document.getElementById("tagline").textContent = t.tagline;
  document.getElementById("recenter-btn").textContent = t.recenter;
  document.getElementById("spotlight-btn").textContent = t.spotlight;
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

  refreshBucketLabels(); // bucket toggle meanings are language-dependent
  updateStatus(); // status sentence is language-dependent
  refreshIndexChrome(); // index title + reopen button are language-dependent
  buildTermIndex(); // labels + sort order are language-dependent

  if (openNodeId) {
    panelNuanceLang = lang; // the open panel follows the current UI language
    renderPanel();
  }
}

// Status line: how many nodes/edges are currently visible, in the current language.
function updateStatus() {
  const nVisible = kb.nodes.filter((n) => isNodeVisible(n)).length;
  const eVisible = kb.edges.filter((e) => {
    const s = nodeById.get(e.source);
    const t = nodeById.get(e.target);
    return s && t && isNodeVisible(s) && isNodeVisible(t);
  }).length;
  document.getElementById("status").textContent = UI_TEXT[lang].status(
    nVisible,
    eVisible
  );
}

main();
