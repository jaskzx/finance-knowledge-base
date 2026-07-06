// Finance Knowledge Base — scaffold step.
// Goal for now: load data/finance_kb.json and show the node/edge counts.
// No graph yet — that comes in a later step.

// Path is relative to index.html, so this works under GitHub Pages subpaths too.
const DATA_URL = "data/finance_kb.json";

// Fetch the knowledge base, then render a plain-text summary.
async function main() {
  const statusEl = document.getElementById("status");

  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const data = await response.json();

    // Counts as declared in meta...
    const metaNodes = data.meta.node_count;
    const metaEdges = data.meta.edge_count;

    // ...and counts recomputed from the actual arrays.
    const actualNodes = data.nodes.length;
    const actualEdges = data.edges.length;

    // The headline the checkpoint expects: "234 nodes, 24 edges."
    statusEl.textContent = `${actualNodes} nodes, ${actualEdges} edges.`;

    // Confirm meta matches the arrays; warn in the console if it ever drifts.
    const nodesMatch = metaNodes === actualNodes;
    const edgesMatch = metaEdges === actualEdges;
    if (nodesMatch && edgesMatch) {
      console.log("meta counts match array counts ✓");
    } else {
      console.warn(
        `meta vs array mismatch — nodes: meta=${metaNodes} actual=${actualNodes}, ` +
          `edges: meta=${metaEdges} actual=${actualEdges}`
      );
    }
  } catch (err) {
    // Most common cause: opening index.html via file:// so fetch is blocked.
    statusEl.textContent =
      "Failed to load data. Serve over http:// (e.g. python3 -m http.server).";
    statusEl.classList.add("error");
    console.error(err);
  }
}

main();
