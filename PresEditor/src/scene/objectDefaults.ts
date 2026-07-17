import { uid } from '../lib/id';
import { PAGE_WIDTH, PAGE_HEIGHT } from './geometry';
import type {
  LegacyHtmlObject,
  TextObject,
  ShapeObject,
  IconObject,
  ImageObject,
  ComponentInstanceObject,
  DiagramNodeObject,
  ConnectorObject,
  ChartObject,
  TableObject,
  SceneObject,
  Scene,
} from '../types/scene';

const baseDefaults = {
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
} as const;

// The exact shape every imported slide page has on day one: one full-bleed
// object with nothing else in the scene. renderScene()'s byte-identical
// fast path checks for precisely this — see scene/legacyHtmlAdapter.ts.
export function createLegacyHtmlObject(html: string, zIndex = 0): LegacyHtmlObject {
  return {
    id: uid('obj'),
    type: 'legacy-html',
    x: 0,
    y: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    zIndex,
    ...baseDefaults,
    data: { html },
  };
}

export function createTextObject(partial?: Partial<TextObject>, zIndex = 0): TextObject {
  return {
    id: uid('obj'),
    type: 'text',
    x: 460,
    y: 300,
    width: 360,
    height: 120,
    zIndex,
    ...baseDefaults,
    style: { fontSize: 20, color: '#241130' },
    data: { html: 'Nouveau texte' },
    ...partial,
  };
}

export function createShapeObject(partial?: Partial<ShapeObject>, zIndex = 0): ShapeObject {
  return {
    id: uid('obj'),
    type: 'shape',
    x: 480,
    y: 280,
    width: 320,
    height: 200,
    zIndex,
    ...baseDefaults,
    style: { fill: '#4b0976', stroke: undefined, radius: 0 },
    data: { shape: 'rect' },
    ...partial,
  };
}

export function createIconObject(partial?: Partial<IconObject>, zIndex = 0): IconObject {
  return {
    id: uid('obj'),
    type: 'icon',
    x: 560,
    y: 280,
    width: 160,
    height: 160,
    zIndex,
    ...baseDefaults,
    style: { color: '#4b0976' },
    data: { icon: 'sitemap' },
    ...partial,
  };
}

export function createImageObject(src: string, partial?: Partial<ImageObject>, zIndex = 0): ImageObject {
  return {
    id: uid('obj'),
    type: 'image',
    x: 440,
    y: 220,
    width: 400,
    height: 280,
    zIndex,
    ...baseDefaults,
    style: {},
    data: { src, fit: 'cover' },
    ...partial,
  };
}

// Milestone 5. `rect` is the component definition's own natural bounding
// box (computed by the caller from its objects) — see renderScene.ts's
// renderComponentInstanceObject for why an instance doesn't otherwise carry
// its own independent size.
export function createComponentInstanceObject(
  componentSlideId: string,
  rect: { x: number; y: number; width: number; height: number },
  zIndex = 0
): ComponentInstanceObject {
  return {
    id: uid('obj'),
    type: 'component-instance',
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    zIndex,
    ...baseDefaults,
    data: { componentSlideId },
  };
}

export function createDiagramNodeObject(partial?: Partial<DiagramNodeObject>, zIndex = 0): DiagramNodeObject {
  return {
    id: uid('obj'),
    type: 'diagram-node',
    x: 480,
    y: 280,
    width: 220,
    height: 100,
    zIndex,
    ...baseDefaults,
    style: { fill: '#4b0976', color: '#ffffff', fontSize: 16, fontWeight: 700, radius: 8 },
    data: { shape: 'rect', label: 'Nœud' },
    ...partial,
  };
}

// x/y/width/height are placeholder-only — see types/scene.ts's
// ConnectorObject doc comment for why the real geometry is never stored.
export function createConnectorObject(fromId: string, toId: string, zIndex = 0): ConnectorObject {
  return {
    id: uid('obj'),
    type: 'connector',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    zIndex,
    ...baseDefaults,
    style: { stroke: '#4b0976', strokeWidth: 2 },
    data: { fromId, toId, arrowEnd: true },
  };
}

export function createChartObject(partial?: Partial<ChartObject>, zIndex = 0): ChartObject {
  return {
    id: uid('obj'),
    type: 'chart',
    x: 440,
    y: 220,
    width: 400,
    height: 280,
    zIndex,
    ...baseDefaults,
    style: { fill: '#4b0976', color: '#241130' },
    data: {
      kind: 'bar',
      series: [
        { label: 'A', value: 30 },
        { label: 'B', value: 55 },
        { label: 'C', value: 20 },
      ],
    },
    ...partial,
  };
}

export function createTableObject(partial?: Partial<TableObject>, zIndex = 0): TableObject {
  return {
    id: uid('obj'),
    type: 'table',
    x: 400,
    y: 220,
    width: 480,
    height: 160,
    zIndex,
    ...baseDefaults,
    style: { fill: '#4b0976', color: '#241130', fontSize: 12 },
    data: {
      rows: [
        ['Colonne 1', 'Colonne 2'],
        ['Valeur 1', 'Valeur 2'],
      ],
    },
    ...partial,
  };
}

export function createScene(objects: SceneObject[]): Scene {
  const objectsById: Record<string, SceneObject> = {};
  const objectOrder: string[] = [];
  objects.forEach((obj) => {
    objectsById[obj.id] = obj;
    objectOrder.push(obj.id);
  });
  return { id: uid('scene'), objectsById, objectOrder, background: null };
}
