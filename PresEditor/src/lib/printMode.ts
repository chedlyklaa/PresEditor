// Milestone 11 (PDF-ready architecture): pure `@media print` CSS, applied
// on the fly the same way lib/animationCss.js and lib/presenterMode.ts
// merge their own additive rules into the exported <style> block — never
// persisted into state.meta.styleBlock itself.
//
// No PDF-generation library is involved (see the milestone roadmap's own
// wording, "PDF-ready architecture" rather than "PDF export") — the deck's
// live layout is fundamentally print-hostile as authored (`#viewport` and
// `.slide` are `position:fixed`/`position:absolute` with pan/zoom
// transforms and `overflow:hidden`, and only the single `.slide.active`
// slide is ever visible), so this rule set un-fixes/un-transforms every
// non-hidden slide into normal stacked document flow with one CSS page
// break per slide, letting the *browser's own* print-to-PDF do the rest.
// No tail-script JS injection is needed for this (unlike presenterMode.ts)
// since nothing here depends on runtime state — it's a static media query.
const PRINT_CSS_MARKER = '@presStudio:print-mode';

const PRINT_CSS = `
/* ${PRINT_CSS_MARKER} — Milestone 11, see lib/printMode.ts */
@page{ size:1280px 720px; margin:0; }
@media print {
  html,body{ overflow:visible !important; background:#fff !important; }
  #viewport{ position:static !important; overflow:visible !important; background:none !important; }
  #stage{ position:static !important; transform:none !important; top:auto !important; left:auto !important; width:auto !important; height:auto !important; }
  #graph-chrome, #mapBtn, #ui-progress, #ui-counter, #ui-hint, #ui-dots, #ui-arrows, #chapterCard, #presenterOverlay, #laserDot{
    display:none !important;
  }
  .slide{
    position:static !important;
    transform:none !important;
    width:1280px !important;
    height:720px !important;
    box-shadow:none !important;
    border-radius:0 !important;
    overflow:visible !important;
    page-break-after:always !important;
    break-after:page !important;
  }
  .slide.hidden-node{ display:none !important; }
  .slide::before{ display:none !important; }
  .node-face{ display:none !important; }
  .detail-content{ position:relative !important; opacity:1 !important; pointer-events:auto !important; }
  .pages-wrap{ position:relative !important; }
  .detail-page{ position:relative !important; opacity:1 !important; pointer-events:auto !important; }
  .page-dots, .pulse-wrap{ display:none !important; }
  [data-anim]{ opacity:1 !important; transform:none !important; }
  [data-emphasis]{ animation:none !important; }
}
`;

export function ensurePrintCss(styleBlock: string): string {
  const block = styleBlock || '';
  if (block.includes(PRINT_CSS_MARKER)) return block;
  return `${block}\n${PRINT_CSS}`;
}
