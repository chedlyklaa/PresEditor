// Milestone A (v2): pure position-computation helpers, shared by
// lib/diagramTemplates.js (fresh-insert layout) and ObjectInspector.tsx's
// "Disposition automatique" button (re-layout an existing selection) — one
// set of layout math, not duplicated per call site. Every function returns
// plain `{id, x, y}` centers (not top-left corners — callers subtract half
// the node's own width/height, since node size varies per template/object)
// so nothing here needs to know about node dimensions beyond the optional
// sizing hints used for spacing.
//
// None of this is a real graph-layout algorithm (no edge-crossing
// minimization, no force simulation) — it's deliberately simple geometric
// placement, sized for the handful-to-few-dozen nodes a slide diagram
// realistically has, not for arbitrary large graphs.
import { PAGE_WIDTH, PAGE_HEIGHT } from '../scene/geometry';

export interface LayoutPoint {
  id: string;
  cx: number;
  cy: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
}

// Every layout function above returns *centers* (a node's own width/height
// varies per template/object, so center math is the one thing every caller
// can share) — this converts to the top-left x/y BaseSceneObject actually
// stores, at the point of use.
export function toTopLeft(p: LayoutPoint, width: number, height: number): { x: number; y: number } {
  return { x: Math.round(p.cx - width / 2), y: Math.round(p.cy - height / 2) };
}

const DEFAULT_MARGIN_X = 120;
const DEFAULT_MARGIN_Y = 100;

// Evenly-spaced single horizontal row, vertically centered on the page.
export function layoutRow(nodeIds: string[], opts: { y?: number; marginX?: number } = {}): LayoutPoint[] {
  const y = opts.y ?? PAGE_HEIGHT / 2;
  const marginX = opts.marginX ?? DEFAULT_MARGIN_X;
  const usableW = PAGE_WIDTH - marginX * 2;
  const n = nodeIds.length;
  if (n === 0) return [];
  if (n === 1) return [{ id: nodeIds[0], cx: PAGE_WIDTH / 2, cy: y }];
  return nodeIds.map((id, i) => ({ id, cx: marginX + (usableW * i) / (n - 1), cy: y }));
}

// A row with alternating vertical offset — the classic zigzag timeline
// look, purely cosmetic distinction from a plain row/pipeline.
export function layoutTimeline(nodeIds: string[], opts: { amplitude?: number } = {}): LayoutPoint[] {
  const amplitude = opts.amplitude ?? 70;
  const base = layoutRow(nodeIds, { y: PAGE_HEIGHT / 2 });
  return base.map((p, i) => ({ ...p, cy: p.cy + (i % 2 === 0 ? -amplitude : amplitude) }));
}

// Layered (Sugiyama-lite) layout: BFS depth from source nodes (no incoming
// edge in `edges`) determines each node's column (left-to-right); nodes
// sharing a depth are stacked in a vertically-centered column. Any node not
// reachable from a source (a disconnected/isolated node, or a genuine cycle)
// falls back to depth 0 rather than being dropped, so every id in
// `nodeIds` always gets a position. Used for flowcharts, org charts, and
// decision trees — all "grows left-to-right or top-to-bottom from a root"
// shapes, just with different edge topology.
export function layoutLayered(
  nodeIds: string[],
  edges: LayoutEdge[],
  opts: { direction?: 'horizontal' | 'vertical' } = {}
): LayoutPoint[] {
  const direction = opts.direction ?? 'horizontal';
  const incoming = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  nodeIds.forEach((id) => {
    incoming.set(id, 0);
    adjacency.set(id, []);
  });
  edges.forEach((e) => {
    if (!adjacency.has(e.from) || !incoming.has(e.to)) return;
    adjacency.get(e.from)!.push(e.to);
    incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
  });

  // Plain BFS, first-visit-wins (not "relax if greater") — a diagram is
  // allowed to have cycles (e.g. a flowchart's retry loop), and relaxing on
  // "greater" depth would never terminate around one. First-visit-wins
  // always terminates in O(V+E): once a node has a depth, a later back-edge
  // into it is simply ignored rather than pushing its depth out forever.
  const depth = new Map<string, number>();
  const queue = nodeIds.filter((id) => incoming.get(id) === 0);
  queue.forEach((id) => depth.set(id, 0));
  let qi = 0;
  while (qi < queue.length) {
    const id = queue[qi++];
    const d = depth.get(id) as number;
    (adjacency.get(id) ?? []).forEach((next) => {
      if (!depth.has(next)) {
        depth.set(next, d + 1);
        queue.push(next);
      }
    });
  }
  // Anything never reached (isolated node, or every node in a cycle) —
  // place at depth 0 so it still renders instead of vanishing.
  nodeIds.forEach((id) => {
    if (!depth.has(id)) depth.set(id, 0);
  });

  const byDepth = new Map<number, string[]>();
  nodeIds.forEach((id) => {
    const d = depth.get(id) as number;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(id);
  });
  const maxDepth = Math.max(0, ...Array.from(byDepth.keys()));
  const marginX = DEFAULT_MARGIN_X;
  const marginY = DEFAULT_MARGIN_Y;

  const points: LayoutPoint[] = [];
  byDepth.forEach((idsAtDepth, d) => {
    const primaryPos = maxDepth === 0 ? (direction === 'horizontal' ? PAGE_WIDTH / 2 : PAGE_HEIGHT / 2) : marginX + ((direction === 'horizontal' ? PAGE_WIDTH - marginX * 2 : PAGE_HEIGHT - marginY * 2) * d) / maxDepth;
    const crossAxisLen = direction === 'horizontal' ? PAGE_HEIGHT : PAGE_WIDTH;
    const n = idsAtDepth.length;
    idsAtDepth.forEach((id, i) => {
      const cross = n === 1 ? crossAxisLen / 2 : marginY + ((crossAxisLen - marginY * 2) * i) / (n - 1);
      points.push(
        direction === 'horizontal'
          ? { id, cx: primaryPos, cy: cross }
          : { id, cx: cross, cy: primaryPos }
      );
    });
  });
  return points;
}

// Evenly spaced on a circle — cycle diagrams.
export function layoutCycle(nodeIds: string[], opts: { radius?: number } = {}): LayoutPoint[] {
  const cx = PAGE_WIDTH / 2;
  const cy = PAGE_HEIGHT / 2;
  const radius = opts.radius ?? Math.min(PAGE_WIDTH, PAGE_HEIGHT) / 2 - 160;
  const n = nodeIds.length;
  if (n === 0) return [];
  if (n === 1) return [{ id: nodeIds[0], cx, cy }];
  return nodeIds.map((id, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { id, cx: cx + radius * Math.cos(angle), cy: cy + radius * Math.sin(angle) };
  });
}

// One center node + spokes evenly around it — mind maps.
export function layoutRadial(centerId: string, spokeIds: string[], opts: { radius?: number } = {}): LayoutPoint[] {
  const cx = PAGE_WIDTH / 2;
  const cy = PAGE_HEIGHT / 2;
  const radius = opts.radius ?? Math.min(PAGE_WIDTH, PAGE_HEIGHT) / 2 - 140;
  const points: LayoutPoint[] = [{ id: centerId, cx, cy }];
  const n = spokeIds.length;
  spokeIds.forEach((id, i) => {
    const angle = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
    points.push({ id, cx: cx + radius * Math.cos(angle), cy: cy + radius * Math.sin(angle) });
  });
  return points;
}

// Horizontal bands stacked top-to-bottom (each `lanes[i]` is one band's
// node ids, placed left-to-right within it) — swimlanes and layered
// architecture diagrams are the same shape, just different node counts per
// band.
export function layoutSwimlane(lanes: string[][], opts: { marginX?: number } = {}): LayoutPoint[] {
  const marginX = opts.marginX ?? DEFAULT_MARGIN_X;
  const laneCount = lanes.length;
  if (laneCount === 0) return [];
  const laneH = PAGE_HEIGHT / laneCount;
  const points: LayoutPoint[] = [];
  lanes.forEach((laneIds, li) => {
    const cy = laneH * li + laneH / 2;
    const row = layoutRow(laneIds, { y: cy, marginX });
    points.push(...row);
  });
  return points;
}
