// Finance Knowledge Base — static force-directed graph (Step 3).
// Load data/finance_kb.json and render every node with Cytoscape.js using the
// fcose force layout for an Obsidian-like web. One neutral color for now — no
// bucket colors and no click behavior yet; those come in later steps.

// Path is relative to index.html, so this works under GitHub Pages subpaths too.
const DATA_URL = "data/finance_kb.json";

async function main() {
  const statusEl = document.getElementById("status");

  let data;
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    data = await response.json();
  } catch (err) {
    // Most common cause: opening index.html via file:// so fetch is blocked.
    statusEl.textContent =
      "Failed to load data. Serve over http:// (e.g. python3 -m http.server).";
    statusEl.classList.add("error");
    console.error(err);
    return;
  }

  // Headline count (matches meta — confirmed in the previous step).
  statusEl.textContent = `${data.nodes.length} nodes, ${data.edges.length} edges.`;

  renderGraph(data);
}

// Turn the knowledge base into Cytoscape elements and draw the graph.
function renderGraph(data) {
  // Each node carries its English label for display.
  const nodes = data.nodes.map((n) => ({ data: { id: n.id, label: n.en } }));

  // Guard: only draw edges whose endpoints both exist, else Cytoscape throws.
  const nodeIds = new Set(data.nodes.map((n) => n.id));
  const edges = data.edges
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map((e, i) => ({ data: { id: `e${i}`, source: e.source, target: e.target } }));

  const dropped = data.edges.length - edges.length;
  if (dropped > 0) {
    console.warn(`${dropped} edge(s) skipped — endpoint not found among nodes.`);
  }

  // Prefer fcose (loaded via CDN); fall back to the built-in cose if it's missing.
  const layoutName =
    typeof window.cytoscapeFcose !== "undefined" ? "fcose" : "cose";

  cytoscape({
    container: document.getElementById("cy"),
    elements: { nodes, edges },

    style: [
      {
        selector: "node",
        style: {
          "background-color": "#8a94a6", // single neutral color for now
          width: 14,
          height: 14,
          label: "data(label)",
          "font-size": 6,
          color: "#333",
          "text-valign": "bottom",
          "text-halign": "center",
          "text-margin-y": 2,
          "min-zoomed-font-size": 8, // hide labels when zoomed far out to cut clutter
        },
      },
      {
        selector: "edge",
        style: {
          width: 1,
          "line-color": "#c2c8d0",
          "curve-style": "bezier",
        },
      },
    ],

    // Force layout gives the spread-out, Obsidian-like web.
    layout: {
      name: layoutName,
      animate: false, // 234 nodes: skip animation for a fast first paint
      randomize: true,
      fit: true,
      padding: 30,
      idealEdgeLength: 60,
      nodeRepulsion: 4500,
    },

    // pan / zoom / node-drag are all enabled by default in Cytoscape.
  });
}

main();
