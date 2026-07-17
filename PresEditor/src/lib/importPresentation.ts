import { uid } from './id';
import { createEmptyState, createSection } from './emptyState';
import { wrapHtmlAsScene } from '../scene/legacyHtmlAdapter';
import { synthesizeLinearEdges } from './edgeGraph';
import type { EditorState } from '../types/state';

// presentation.html has no build step: every slide lives as a plain object
// pushed onto a `S` (main deck) or `QA_SLIDES` (hidden Q&A) array by a
// self-executing <script>, and `CLUSTERS`/`NODE_META` describe the section
// grouping used by the overview map. To import a deck we don't re-implement
// a parser for that structure — we slice out just the *data-producing*
// portion of the original script (before it starts touching the DOM) and
// execute it, then read the resulting arrays back out.
function extractDataScript(sourceText: string): string {
  const scriptOpen = sourceText.indexOf('<script>');
  const scriptClose = sourceText.indexOf('</script>', scriptOpen);
  if (scriptOpen === -1 || scriptClose === -1) {
    throw new Error('Aucune balise <script> trouvée dans ce fichier.');
  }
  const fullScript = sourceText.slice(scriptOpen + '<script>'.length, scriptClose);
  const domCutoff = fullScript.indexOf('const graphChrome');
  return domCutoff > -1 ? fullScript.slice(0, domCutoff) : fullScript;
}

interface RawSlide {
  cls: 'slide-light' | 'slide-dark';
  html?: string;
  pages?: string[];
}
interface RawNodeMeta {
  icon: string;
  label: string;
}
interface RawCluster {
  label: string;
  color: string;
  tint: string;
  border: string;
  slides?: number[];
}
interface DataScriptResult {
  S: RawSlide[];
  QA_SLIDES: RawSlide[];
  NODE_META: RawNodeMeta[];
  CLUSTERS: RawCluster[];
}

function runDataScript(dataScript: string): DataScriptResult {
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    `${dataScript}
;return {
  S: (typeof S !== "undefined" ? S : []),
  QA_SLIDES: (typeof QA_SLIDES !== "undefined" ? QA_SLIDES : []),
  NODE_META: (typeof NODE_META !== "undefined" ? NODE_META : []),
  CLUSTERS: (typeof CLUSTERS !== "undefined" ? CLUSTERS : []),
};`
  );
  return fn();
}

function decodeNotes(sourceText: string): string[] {
  const matches = Array.from(sourceText.matchAll(/\/\*@notes:([A-Za-z0-9+/=]+)\*\//g));
  return matches.map((m) => {
    try {
      return decodeURIComponent(escape(atob(m[1])));
    } catch {
      return '';
    }
  });
}

// Wraps each raw HTML page of an imported slide into its own Scene (one
// full-bleed legacy-html object each — see scene/legacyHtmlAdapter.ts),
// registers them on `state.scenesById`, and returns the scene ids in page
// order for the Slide's `pages` field. This is the seam where the old
// "pages are raw HTML strings" model becomes the new "pages are Scene ids"
// model — see the Presentation Studio plan's central-tension resolution.
function wrapPagesAsScenes(state: EditorState, rawSlide: RawSlide): string[] {
  const rawPages = rawSlide.pages ?? [rawSlide.html ?? ''];
  return rawPages.map((html) => {
    const scene = wrapHtmlAsScene(html);
    state.scenesById[scene.id] = scene;
    return scene.id;
  });
}

export function parsePresentationSource(sourceText: string, loadedFrom: string): EditorState {
  const styleMatch = sourceText.match(/<style>([\s\S]*?)<\/style>/);
  const titleMatch = sourceText.match(/<title>([\s\S]*?)<\/title>/);
  const dataScript = extractDataScript(sourceText);

  let S: RawSlide[], QA_SLIDES: RawSlide[], NODE_META: RawNodeMeta[], CLUSTERS: RawCluster[];
  try {
    ({ S, QA_SLIDES, NODE_META, CLUSTERS } = runDataScript(dataScript));
  } catch (err: any) {
    throw new Error(`Impossible d'analyser le fichier : ${err.message}`);
  }
  if (!Array.isArray(S) || S.length === 0) {
    throw new Error('Aucune diapositive (tableau S) trouvée dans ce fichier.');
  }

  const notes = decodeNotes(sourceText);
  let notesCursor = 0;
  const nextNotes = () => notes[notesCursor++] || '';

  const state = createEmptyState() as EditorState;
  state.meta.loadedFrom = loadedFrom;
  state.meta.originalText = sourceText;
  state.meta.styleBlock = styleMatch ? styleMatch[1] : '';
  state.meta.title = titleMatch ? titleMatch[1].trim() : 'Ma présentation';

  const usedIdx = new Set<number>();
  (CLUSTERS || []).forEach((c) => {
    const section = {
      id: uid('sec'),
      label: c.label,
      color: c.color,
      tint: c.tint,
      border: c.border,
      collapsed: false,
      slideIds: [] as string[],
    };
    (c.slides || []).forEach((slideIdx) => {
      const sl = S[slideIdx];
      if (!sl) return;
      usedIdx.add(slideIdx);
      const meta = (NODE_META && NODE_META[slideIdx]) || { icon: 'clipboard', label: 'Diapositive' };
      const id = uid('slide');
      state.slidesById[id] = {
        id,
        cls: sl.cls,
        pages: wrapPagesAsScenes(state, sl),
        notes: nextNotes(),
        nodeIcon: meta.icon,
        nodeLabel: meta.label,
      };
      section.slideIds.push(id);
    });
    state.sections.push(section);
  });

  // Any main-deck slide not covered by a cluster still needs a home so no
  // content is silently dropped on import.
  S.forEach((sl, idx) => {
    if (usedIdx.has(idx)) return;
    if (state.sections.length === 0) state.sections.push(createSection('Diapositives', 0));
    const meta = (NODE_META && NODE_META[idx]) || { icon: 'clipboard', label: 'Diapositive' };
    const id = uid('slide');
    state.slidesById[id] = {
      id,
      cls: sl.cls,
      pages: wrapPagesAsScenes(state, sl),
      notes: '',
      nodeIcon: meta.icon,
      nodeLabel: meta.label,
    };
    state.sections[state.sections.length - 1].slideIds.push(id);
  });

  (QA_SLIDES || []).forEach((sl) => {
    const id = uid('slide');
    state.slidesById[id] = {
      id,
      cls: sl.cls,
      pages: wrapPagesAsScenes(state, sl),
      notes: nextNotes(),
      nodeIcon: null,
      nodeLabel: null,
    };
    state.qaSlideIds.push(id);
  });

  state.selectedSlideId = (state.sections[0] && state.sections[0].slideIds[0]) || state.qaSlideIds[0] || null;

  // Milestone D: a freshly-imported deck has no JSON state at all, so this
  // is initial construction rather than migration — but the same function
  // storage.js's migrateMissingCollections calls for an old localStorage
  // session. CLUSTERS[ci].slides lists the original S-array indices in
  // order, so the sections/slideIds just reconstructed above already
  // mirror the source file's own flattened slide order — synthesizing here
  // reproduces exactly the implicit i,i+1 edges the engine itself always
  // drew for this file.
  state.edges = synthesizeLinearEdges(state);

  return state;
}
