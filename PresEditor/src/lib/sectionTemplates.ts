// Milestone 9 (starter templates): a section-level starter, one level up
// from lib/layouts.js's single-slide LAYOUTS — each entry is just an
// ordered list of existing layout keys, so a template is "a few slides that
// look native together" without introducing a second slide-authoring
// format. lib/presentationTemplates.ts reuses these same entries to build
// full starter decks, so there's exactly one place new starter content is
// defined.
import { uid } from './id';
import { createSection } from './emptyState';
import { createSlideFromLayout } from './layouts';
import { wrapHtmlAsScene } from '../scene/legacyHtmlAdapter';
import { createScene, createTextObject } from '../scene/objectDefaults';
import { DIAGRAM_TEMPLATES } from './diagramTemplates';
import { PAGE_HEIGHT } from '../scene/geometry';
import type { Slide, SectionMeta } from '../types/state';
import type { Scene, SceneObject } from '../types/scene';

export const SECTION_TEMPLATES: Record<string, { label: string; desc: string; icon: string; layoutKeys: string[] }> = {
  standard: {
    label: 'Section standard',
    desc: 'Rupture, contenu à puces, comparaison, contenu à puces.',
    icon: 'layers',
    layoutKeys: ['section', 'content', 'twocol', 'content'],
  },
  pitch: {
    label: 'Pitch',
    desc: 'Titre, contenu, image, comparaison.',
    icon: 'sitemap',
    layoutKeys: ['title', 'content', 'image', 'twocol'],
  },
  report: {
    label: 'Rapport',
    desc: 'Rupture puis trois pages de contenu à puces.',
    icon: 'clipboard',
    layoutKeys: ['section', 'content', 'content', 'content'],
  },
  // Milestone D (templates gallery): a layout key of the form
  // `diagram:<key>` picks one of lib/diagramTemplates.js's diagram-node/
  // connector layouts instead of an HTML layout from lib/layouts.js — see
  // buildDiagramSlideScene() below. Kept in the same layoutKeys string
  // array (rather than a second per-section field) so a template stays "an
  // ordered list of slide sources", just with a second source type.
  architecture: {
    label: 'Architecture technique',
    desc: 'Titre, diagramme d’architecture en couches, risques, prochaines étapes.',
    icon: 'server',
    layoutKeys: ['title', 'diagram:layeredArchitecture', 'twocol', 'content'],
  },
  lesson: {
    label: 'Leçon',
    desc: 'Titre du cours, objectifs, support visuel, résumé.',
    icon: 'clipboard',
    layoutKeys: ['title', 'content', 'image', 'content'],
  },
  kpi: {
    label: 'Indicateurs',
    desc: 'Rupture, indicateurs clés en comparaison, synthèse.',
    icon: 'chart',
    layoutKeys: ['section', 'twocol', 'content'],
  },
};

const DIAGRAM_PREFIX = 'diagram:';

// Diagram templates lay themselves out assuming the full 1280x720 canvas
// (lib/diagramLayout.ts) — the same math the live "insert diagram" toolbar
// action uses on top of a slide the user already built. Here there is no
// pre-existing slide to insert onto, so a title strip is added and every
// diagram-node's vertical position is compressed into the remaining band
// below it. Connectors are left untouched: per types/scene.ts's
// ConnectorObject doc comment, their real geometry is resolved from the
// endpoint nodes at render time, never from their own stored x/y.
const TITLE_BAND = 180;
const BOTTOM_MARGIN = 20;

function buildDiagramSlideScene(diagramKey: string): { scene: Scene; label: string } | null {
  const tmpl = (DIAGRAM_TEMPLATES as Record<string, { label: string; build: () => SceneObject[] }>)[diagramKey];
  if (!tmpl) return null;
  const usable = PAGE_HEIGHT - TITLE_BAND - BOTTOM_MARGIN;
  const objects = tmpl.build().map((obj) => {
    if (obj.type !== 'diagram-node') return obj;
    const centerY = obj.y + obj.height / 2;
    const newCenterY = TITLE_BAND + (centerY / PAGE_HEIGHT) * usable;
    return { ...obj, y: Math.round(newCenterY - obj.height / 2) };
  });
  const title = createTextObject({
    x: 64,
    y: 44,
    width: 900,
    height: 100,
    style: {},
    data: { html: `<div class="eyebrow eyebrow-light">DIAGRAMME</div><h1 class="title title-light" style="font-size:32px;">${tmpl.label}</h1>` },
  });
  return { scene: createScene([title, ...objects]), label: tmpl.label };
}

export interface BuiltSection {
  section: SectionMeta;
  slides: Slide[];
  scenes: Scene[];
}

// Same construction the ADD_SLIDE reducer case already does for a single
// slide (state/reducer.ts), just looped over a template's layoutKeys and
// collected instead of dispatched one at a time — used both by
// ADD_SECTION_FROM_TEMPLATE (reducer.ts) and by lib/presentationTemplates.ts
// (which calls it once per section of a full starter deck).
export function buildSectionFromTemplate(templateKey: string, colorIndex: number, labelOverride?: string): BuiltSection | null {
  const tmpl = SECTION_TEMPLATES[templateKey];
  if (!tmpl) return null;
  const section = createSection(labelOverride || tmpl.label, colorIndex) as SectionMeta;
  const slides: Slide[] = [];
  const scenes: Scene[] = [];
  tmpl.layoutKeys.forEach((layoutKey) => {
    let scene: Scene;
    let cls: Slide['cls'];
    let nodeIcon: string | null;
    let nodeLabel: string;
    if (layoutKey.startsWith(DIAGRAM_PREFIX)) {
      const built = buildDiagramSlideScene(layoutKey.slice(DIAGRAM_PREFIX.length));
      if (!built) return;
      scene = built.scene;
      cls = 'slide-light';
      nodeIcon = 'route';
      nodeLabel = built.label;
    } else {
      const layout = createSlideFromLayout(layoutKey);
      scene = wrapHtmlAsScene(layout.pages[0]) as Scene;
      cls = layout.cls;
      nodeIcon = layout.nodeIcon;
      nodeLabel = layout.nodeLabel;
    }
    const id = uid('slide');
    const slide: Slide = { id, cls, pages: [scene.id], notes: '', nodeIcon, nodeLabel };
    slides.push(slide);
    scenes.push(scene);
    section.slideIds.push(id);
  });
  return { section, slides, scenes };
}
