// Milestone D (v2, editable overview graph): the pure, EditorState-agnostic
// half of the edge-list feature — types/state.ts's Edge doc comment has the
// full "why" (edges were never independent data before this milestone).
// The other half, exportPresentation.ts's actual wiring of these into the
// exported deck, lives in injectEdgeGraphSupport below.
import { uid } from './id';
import type { Edge, EditorState } from '../types/state';

// Reproduces the *old* implicit behavior (edge i connects global main-slide
// index i to i+1) as real Edge[] data — called exactly once, the first time
// a deck without an edges array is encountered (storage.js's
// migrateMissingCollections, or importPresentation.ts on a fresh HTML
// import), so a deck the user hasn't explicitly graph-edited keeps
// rendering identically forever after.
export function synthesizeLinearEdges(state: Pick<EditorState, 'sections'>): Edge[] {
  const flat = state.sections.flatMap((s) => s.slideIds);
  const edges: Edge[] = [];
  for (let i = 0; i < flat.length - 1; i++) {
    edges.push({ id: uid('edge'), from: flat[i], to: flat[i + 1] });
  }
  return edges;
}

// Called when a new main-deck slide (`newId`) is inserted immediately after
// `prevId` and before `nextId` in the flattened node order (either/both may
// be null at the start/end of the deck) — splices it into the chain the
// same way the old implicit i,i+1 model automatically would have, so
// ADD_SLIDE/DUPLICATE_SLIDE don't silently produce a disconnected node.
export function spliceNodeIntoEdges(edges: Edge[], prevId: string | null, newId: string, nextId: string | null): Edge[] {
  let next = edges;
  if (prevId && nextId) {
    next = next.filter((e) => !(e.from === prevId && e.to === nextId));
  }
  const additions: Edge[] = [];
  if (prevId) additions.push({ id: uid('edge'), from: prevId, to: newId });
  if (nextId) additions.push({ id: uid('edge'), from: newId, to: nextId });
  return [...next, ...additions];
}

// Called when a main-deck slide is deleted or moved out of the main deck
// (DELETE_SLIDE, DELETE_SECTION, RELOCATE_SLIDE into '__qa__'). Removes
// every edge touching it; when it had *exactly* one incoming and one
// outgoing edge, reconnects that pair (only if it isn't already an edge) so
// deleting a node from the middle of an otherwise-linear chain auto-heals
// the gap, matching what the old implicit model did for free. A node with
// zero, or more than one, incoming/outgoing edge is an ambiguous case —
// deliberately not guessed at; those edges are just dropped.
export function removeNodeFromEdges(edges: Edge[], nodeId: string): Edge[] {
  const incoming = edges.filter((e) => e.to === nodeId);
  const outgoing = edges.filter((e) => e.from === nodeId);
  const remaining = edges.filter((e) => e.from !== nodeId && e.to !== nodeId);
  if (incoming.length === 1 && outgoing.length === 1) {
    const from = incoming[0].from;
    const to = outgoing[0].to;
    if (from !== to && !remaining.some((e) => e.from === from && e.to === to)) {
      remaining.push({ id: uid('edge'), from, to });
    }
  }
  return remaining;
}

// Milestone D: the *editor's own* OverviewEditor.tsx calls this directly
// (normal TS, not a string) to lay out lanes visually close to how the
// exported deck's injected groupXReplacement() JS (below) will actually
// render them — same formula, necessarily duplicated as a string there
// since the exported deck is a separate standalone JS runtime this module
// can't share code with directly.
//
// Centered + evenly spaced around STAGE_W/2, rather than the old
// hardcoded 9-lane pixel table (which packed however many lanes existed
// into that table's first N slots — e.g. a 2-lane deck sat at x=75/216,
// crammed into the far-left third of the stage instead of being centered,
// and its lane frames had to be *narrower* than a slide card to avoid
// overlapping). GROUP_STEP is chosen wide enough that OverviewEditor.tsx
// can give each lane frame a comfortable margin around its 150px-wide
// slide cards plus a visible gap to its neighbors; GROUP_MAX_SPAN caps
// the total width for high lane counts so the outermost lanes don't run
// off the stage edges (falls back to fitting evenly within that cap).
const STAGE_W = 1280;
const GROUP_STEP = 220;
const GROUP_MAX_SPAN = 1080;
export function computeGroupX(laneCount: number, laneIndex: number): number {
  if (laneCount <= 1) return STAGE_W / 2;
  const span = Math.min(GROUP_STEP * (laneCount - 1), GROUP_MAX_SPAN);
  const step = span / (laneCount - 1);
  const start = STAGE_W / 2 - span / 2;
  return start + laneIndex * step;
}

const EDGE_GRAPH_JS_MARKER = '@presStudio:edge-graph';

// The exact literal text of genericTemplate.js's GENERIC_TAIL (confirmed
// byte-identical in the real presentation.html) at the two anchor points
// this patches — see that file for the canonical, commented version.
const GROUP_X_ANCHOR = 'const GROUP_X = [75, 216, 357, 499, 640, 782, 923, 1065, 1206];';

// Replaces the hardcoded 9-lane pixel table with the exact same
// centered/evenly-spaced formula computeGroupX() above uses, so the
// exported deck's own map/graph view lays out lanes identically to what
// was just edited in Vue d'ensemble — see the big comment on
// computeGroupX for why the old hardcoded table was replaced.
function groupXReplacement(): string {
  return (
    `/* ${EDGE_GRAPH_JS_MARKER} */\n` +
    'function presStudioGroupX(n, i){ if(n<=1) return STAGE_W/2; var step=220, maxSpan=1080; var span=Math.min(step*(n-1), maxSpan); var s=span/(n-1); var start=STAGE_W/2-span/2; return start+i*s; }\n' +
    'const GROUP_X = CLUSTERS.map(function(_,ci){ return presStudioGroupX(CLUSTERS.length, ci); });'
  );
}

// Matches the whole edge-drawing block, from the opening `<svg id="edges"`
// line through the closing `edgesSvg += \`</svg>\`;` — [\s\S]*? (non-greedy)
// between two short, unique anchors is deliberately more whitespace/
// line-ending-tolerant than an exact multi-line literal match would be.
const EDGE_LOOP_REGEX =
  /let edgesSvg = `<svg id="edges" viewBox="0 0 \$\{STAGE_W\} \$\{STAGE_H\}">`;[\s\S]*?edgesSvg \+= `<\/svg>`;/;

// Replaces the implicit `for(i<NODE_META.length-1) connect i,i+1` loop with
// one that reads an `EDGES` array (an array of [fromIdx,toIdx] pairs,
// injected as a sibling const alongside NODE_META/CLUSTERS by
// exportPresentation.ts) — falling back to the exact old consecutive
// behavior if `EDGES` isn't defined, so this degrades gracefully rather
// than throwing on a deck variant where only the GROUP_X anchor (or
// neither) matched.
function edgeLoopReplacement(): string {
  return (
    'let edgesSvg = `<svg id="edges" viewBox="0 0 ${STAGE_W} ${STAGE_H}">`;\n' +
    "const EDGE_PAIRS = (typeof EDGES !== 'undefined' && Array.isArray(EDGES) && EDGES.length)\n" +
    '  ? EDGES\n' +
    '  : Array.from({length: Math.max(0, NODE_META.length-1)}, function(_,i){ return [i, i+1]; });\n' +
    'EDGE_PAIRS.forEach(function(pair, i){\n' +
    '  const a = nodePos[pair[0]], b = nodePos[pair[1]];\n' +
    '  if(!a || !b) return;\n' +
    '  const cx1 = a.x + (b.x-a.x)*0.5, cx2 = a.x + (b.x-a.x)*0.5;\n' +
    '  const d = `M ${a.x} ${a.y} C ${cx1} ${a.y}, ${cx2} ${b.y}, ${b.x} ${b.y}`;\n' +
    '  edgesSvg += `<path class="edge" d="${d}"/><path class="edge-flow" d="${d}" style="animation-delay:${(i*0.18).toFixed(2)}s"/>`;\n' +
    '});\n' +
    'edgesSvg += `</svg>`;'
  );
}

// Idempotent via the same marker-comment check every other tail-script
// injector in this codebase uses (see lib/presenterMode.ts). Two
// independent patches, applied unconditionally of one another — if only
// one anchor matches in some deck variant, the other still applies.
export function injectEdgeGraphSupport(tailText: string): string {
  if (tailText.includes(EDGE_GRAPH_JS_MARKER)) return tailText;
  let patched = tailText.replace(GROUP_X_ANCHOR, groupXReplacement());
  patched = patched.replace(EDGE_LOOP_REGEX, edgeLoopReplacement());
  return patched;
}
