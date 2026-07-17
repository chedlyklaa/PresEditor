import { useMemo, useRef, useState } from 'react';
import { useEditor } from '../state/EditorContext';
import { EI } from '../lib/icons';
import { computeGroupX } from '../lib/edgeGraph';

function Icon({ name }: { name: string }) {
  return <span dangerouslySetInnerHTML={{ __html: (EI as Record<string, string>)[name] || EI.sitemap }} />;
}

const STAGE_W = 1280;
const STAGE_H = 720;
const NODE_W = 150;
const NODE_H = 74;
const LANE_DY = 100;

interface LaidOutNode {
  id: string;
  sectionId: string;
  sectionIndex: number;
  cx: number;
  cy: number;
  label: string;
  icon: string;
  color: string;
}

// Milestone D (v2, editable overview graph): a dedicated view — separate
// from the scene canvas entirely, since this edits deck-level structure
// (which lane a slide is in, which slides connect to which), not a single
// slide's content. Node *position* (lane + order) is backed by the
// existing relocateSlide/moveSlide actions (Milestones 1/2) — this view
// adds no new state for that. Edge add/delete/redirect are backed by the
// new ADD_EDGE/DELETE_EDGE/REDIRECT_EDGE actions (reducer.ts).
interface DragState {
  id: string;
  x: number;
  y: number;
  moved: boolean;
  sectionId: string;
  sectionIndex: number;
}

export default function OverviewEditor() {
  const { state, actions } = useEditor();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [pendingFrom, setPendingFrom] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [redirectArm, setRedirectArm] = useState<'from' | 'to' | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const laneCount = state.sections.length;

  // Section frames must always read as visibly *bigger* than the slide
  // cards sitting in them, with real breathing room to their neighbors —
  // sized off the real gap between lane centers (computeGroupX now spaces
  // lanes centered + far enough apart for this, see its comment) rather
  // than a hardcoded width, so it stays correct at any lane count.
  const laneXs = useMemo(() => state.sections.map((_, si) => computeGroupX(laneCount, si)), [laneCount, state.sections]);
  const LANE_GAP = 22;
  const laneWidth = useMemo(() => {
    if (laneXs.length <= 1) return NODE_W + 70;
    let minSpacing = Infinity;
    for (let i = 1; i < laneXs.length; i++) minSpacing = Math.min(minSpacing, laneXs[i] - laneXs[i - 1]);
    return Math.max(NODE_W + 32, Math.min(NODE_W + 70, minSpacing - LANE_GAP));
  }, [laneXs]);

  const nodes = useMemo<LaidOutNode[]>(() => {
    const out: LaidOutNode[] = [];
    state.sections.forEach((sec, si) => {
      const n = sec.slideIds.length;
      const cx = computeGroupX(laneCount, si);
      sec.slideIds.forEach((slideId, i) => {
        const slide = state.slidesById[slideId];
        if (!slide) return;
        const cy = 360 + (i - (n - 1) / 2) * LANE_DY;
        out.push({
          id: slideId,
          sectionId: sec.id,
          sectionIndex: i,
          cx,
          cy,
          label: slide.nodeLabel || 'Diapositive',
          icon: slide.nodeIcon || 'clipboard',
          color: sec.color,
        });
      });
    });
    return out;
  }, [state.sections, state.slidesById, laneCount]);

  const nodeById = useMemo(() => {
    const map = new Map<string, LaidOutNode>();
    nodes.forEach((n) => map.set(n.id, n));
    return map;
  }, [nodes]);

  function toSvgCoords(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * STAGE_W,
      y: ((clientY - rect.top) / rect.height) * STAGE_H,
    };
  }

  // Nearest lane by x among *current* sections (including the node's own,
  // so dropping back where it started is a no-op), then a target index
  // within that lane by y position among its *other* slides — shared by
  // the live drag preview and the final drop so what you see while
  // dragging is exactly what you get.
  function computeDropTarget(p: { x: number; y: number }, nodeId: string) {
    let targetSectionIdx = 0;
    let bestDist = Infinity;
    state.sections.forEach((sec, si) => {
      const laneX = computeGroupX(laneCount, si);
      const d = Math.abs(laneX - p.x);
      if (d < bestDist) {
        bestDist = d;
        targetSectionIdx = si;
      }
    });
    const targetSection = state.sections[targetSectionIdx];
    const siblingIds = targetSection.slideIds.filter((id) => id !== nodeId);
    let targetIndex = siblingIds.length;
    for (let i = 0; i < siblingIds.length; i++) {
      const sib = nodeById.get(siblingIds[i]);
      if (sib && p.y < sib.cy) {
        targetIndex = i;
        break;
      }
    }
    return { sectionId: targetSection.id, index: targetIndex };
  }

  function handleNodeMouseDown(e: React.MouseEvent, node: LaidOutNode) {
    e.stopPropagation();
    if (connectMode) return; // clicks (not drags) drive connect mode — see onClick below
    const start = toSvgCoords(e.clientX, e.clientY);
    // Wherever inside the card the user actually grabbed it (rarely dead
    // center) — without this offset every move snapped the card's *center*
    // to the raw cursor position, so the card visibly jumped sideways the
    // instant the drag started and then tracked to the right/left of the
    // cursor for the whole gesture instead of staying under it.
    const grabOffsetX = start.x - node.cx;
    const grabOffsetY = start.y - node.cy;
    let moved = false;
    setDrag({ id: node.id, x: node.cx, y: node.cy, moved: false, sectionId: node.sectionId, sectionIndex: node.sectionIndex });

    function onMove(ev: MouseEvent) {
      const p = toSvgCoords(ev.clientX, ev.clientY);
      const nx = p.x - grabOffsetX;
      const ny = p.y - grabOffsetY;
      if (!moved && (Math.abs(p.x - start.x) > 4 || Math.abs(p.y - start.y) > 4)) {
        moved = true;
        // Grabbing cursor + no accidental text selection for the whole
        // page, not just the SVG — the mouse regularly outruns the node
        // during a fast drag and passes over sibling toolbar/DOM elements.
        document.body.classList.add('ed-overview-dragging');
      }
      const dt = moved ? computeDropTarget({ x: nx, y: ny }, node.id) : { sectionId: node.sectionId, index: node.sectionIndex };
      setDrag({ id: node.id, x: nx, y: ny, moved, sectionId: dt.sectionId, sectionIndex: dt.index });
    }
    function onUp(ev: MouseEvent) {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('ed-overview-dragging');
      if (!moved) {
        setDrag(null);
        return;
      }
      const p = toSvgCoords(ev.clientX, ev.clientY);
      const dt = computeDropTarget({ x: p.x - grabOffsetX, y: p.y - grabOffsetY }, node.id);
      setDrag(null);
      actions.relocateSlide(node.id, dt.sectionId, dt.index);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function handleNodeClick(node: LaidOutNode) {
    if (redirectArm && selectedEdgeId) {
      actions.redirectEdge(selectedEdgeId, redirectArm, node.id);
      setRedirectArm(null);
      return;
    }
    if (connectMode) {
      if (!pendingFrom) {
        setPendingFrom(node.id);
      } else if (pendingFrom !== node.id) {
        actions.addEdge(pendingFrom, node.id);
        setPendingFrom(null);
      }
      return;
    }
    setSelectedEdgeId(null);
  }

  const selectedEdge = state.edges.find((e) => e.id === selectedEdgeId) || null;
  const selectedEdgeMid = selectedEdge
    ? (() => {
        const a = nodeById.get(selectedEdge.from);
        const b = nodeById.get(selectedEdge.to);
        return a && b ? { x: (a.cx + b.cx) / 2, y: (a.cy + b.cy) / 2 } : null;
      })()
    : null;

  // Live "it'll land here" preview while dragging: the exact slot the
  // dragged node would occupy in its current target lane, using the same
  // layout formula the node list itself uses — so the dashed line lines
  // up perfectly with where the card actually snaps to on drop instead of
  // just trailing the cursor.
  const dropIndicator =
    drag && drag.moved
      ? (() => {
          const dropSection = state.sections.find((s) => s.id === drag.sectionId);
          if (!dropSection) return null;
          const siblingIds = dropSection.slideIds.filter((id) => id !== drag.id);
          const n = siblingIds.length + 1;
          const cy = 360 + (drag.sectionIndex - (n - 1) / 2) * LANE_DY;
          const laneX = computeGroupX(laneCount, state.sections.indexOf(dropSection));
          return { laneX, cy, sectionId: dropSection.id };
        })()
      : null;

  return (
    <div className="ed-overview-editor">
      <div className="ed-overview-toolbar">
        <button
          className={`ed-btn${connectMode ? ' on' : ''}`}
          onClick={() => {
            setConnectMode((v) => !v);
            setPendingFrom(null);
            setSelectedEdgeId(null);
          }}
          title="Cliquez deux nœuds pour les relier"
        >
          <Icon name="connector" /> {connectMode ? (pendingFrom ? 'Choisissez la cible…' : 'Choisissez le départ…') : 'Relier'}
        </button>
        <span className="ed-overview-hint">
          Glissez une carte pour changer sa section ou son ordre — la zone cible se met en surbrillance. Cliquez une flèche pour la sélectionner.
        </span>
      </div>
      <div className="ed-overview-stage">
        <div className="ed-overview-canvas">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
          className="ed-overview-svg"
          onClick={() => {
            setSelectedEdgeId(null);
            setRedirectArm(null);
          }}
        >
          {state.sections.map((sec, si) => {
            const laneX = computeGroupX(laneCount, si);
            const isDropTarget = drag && drag.moved && drag.sectionId === sec.id;
            return (
              <g key={sec.id} className={`ed-overview-lane${isDropTarget ? ' drop-target' : ''}`}>
                <rect
                  x={laneX - laneWidth / 2}
                  y={20}
                  width={laneWidth}
                  height={STAGE_H - 40}
                  rx={20}
                  fill={sec.tint}
                  stroke={isDropTarget ? sec.color : sec.border}
                  strokeWidth={isDropTarget ? 2.5 : 1}
                />
                <text x={laneX} y={44} textAnchor="middle" fontSize={13} fontFamily="var(--mono)" fill={sec.color}>
                  {sec.label}
                </text>
              </g>
            );
          })}
          {dropIndicator && (
            <line
              className="ed-overview-drop-line"
              x1={dropIndicator.laneX - laneWidth / 2 + 10}
              x2={dropIndicator.laneX + laneWidth / 2 - 10}
              y1={dropIndicator.cy}
              y2={dropIndicator.cy}
            />
          )}
          {state.edges.map((edge) => {
            const a = nodeById.get(edge.from);
            const b = nodeById.get(edge.to);
            if (!a || !b) return null;
            const cx1 = a.cx + (b.cx - a.cx) * 0.5;
            const cx2 = cx1;
            const d = `M ${a.cx} ${a.cy} C ${cx1} ${a.cy}, ${cx2} ${b.cy}, ${b.cx} ${b.cy}`;
            const isSelected = edge.id === selectedEdgeId;
            return (
              <path
                key={edge.id}
                d={d}
                fill="none"
                stroke={isSelected ? '#f4c10b' : '#8c6aa3'}
                strokeWidth={isSelected ? 4 : 2}
                markerEnd="url(#ed-overview-arrow)"
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedEdgeId(edge.id);
                  setRedirectArm(null);
                }}
              />
            );
          })}
          <defs>
            <marker id="ed-overview-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#8c6aa3" />
            </marker>
          </defs>
          {(drag ? [...nodes.filter((n) => n.id !== drag.id), ...nodes.filter((n) => n.id === drag.id)] : nodes).map((node) => {
            const isDragging = drag?.id === node.id && drag.moved;
            const cx = drag?.id === node.id ? drag.x : node.cx;
            const cy = drag?.id === node.id ? drag.y : node.cy;
            const isPendingFrom = pendingFrom === node.id;
            // Scale from the card's own center (not the SVG origin) by
            // baking the extra offset into the translate — see the
            // handleNodeMouseDown/computeDropTarget comment block above
            // for why this needed its own live-preview machinery.
            const s = isDragging ? 1.06 : 1;
            const tx = cx - (NODE_W * s) / 2;
            const ty = cy - (NODE_H * s) / 2;
            return (
              <g
                key={node.id}
                data-node-id={node.id}
                className={`ed-overview-node${isDragging ? ' dragging' : ''}`}
                transform={`translate(${tx},${ty}) scale(${s})`}
                style={{ cursor: connectMode ? 'crosshair' : isDragging ? 'grabbing' : 'grab' }}
                onMouseDown={(e) => handleNodeMouseDown(e, node)}
                onClick={(e) => {
                  e.stopPropagation();
                  handleNodeClick(node);
                }}
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={12}
                  fill="#fff"
                  stroke={isPendingFrom ? '#f4c10b' : node.color}
                  strokeWidth={isPendingFrom ? 3 : 1.5}
                />
                <foreignObject x={8} y={8} width={NODE_W - 16} height={NODE_H - 16}>
                  <div className="ed-overview-node-content">
                    <span className="ed-overview-node-icon" style={{ background: node.color }}>
                      <Icon name={node.icon} />
                    </span>
                    <span className="ed-overview-node-label">{node.label}</span>
                  </div>
                </foreignObject>
              </g>
            );
          })}
        </svg>
        {selectedEdge && selectedEdgeMid && (
          <div
            className="ed-overview-edge-toolbar"
            style={{
              left: `${(selectedEdgeMid.x / STAGE_W) * 100}%`,
              top: `${(selectedEdgeMid.y / STAGE_H) * 100}%`,
            }}
          >
            <button className="ed-icon-btn" title="Rediriger le départ" onClick={() => setRedirectArm('from')}>
              ← ?
            </button>
            <button className="ed-icon-btn" title="Rediriger l'arrivée" onClick={() => setRedirectArm('to')}>
              ? →
            </button>
            <button
              className="ed-icon-btn danger"
              title="Supprimer cette flèche"
              onClick={() => {
                actions.deleteEdge(selectedEdge.id);
                setSelectedEdgeId(null);
              }}
            >
              <Icon name="trash" />
            </button>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
