// Milestone 8 (Animation system) — presets built entirely on top of the
// presentation engine's existing entrance primitive (lib/genericTemplate.js):
//
//   [data-anim]{opacity:0; transform:translateY(18px); transition:...;}
//   .slide.content-in [data-anim]{opacity:1; transform:none;}
//
// `content-in` is added to a `.slide` by the engine's own enterDetail()
// when it becomes the active slide, and removed by backToMap()/the next
// enterDetail() when it stops being active — that toggle is the *only*
// animation trigger this engine has. There's no "wait for this to finish
// before navigating away" hook, so a real exit animation would need an
// actual engine/JS change; entrance and "emphasis" (a second, independently
// delayed animation that plays on the same content-in trigger, rather than
// on a separate interaction the engine has no concept of) both stay pure
// CSS, added by ensureAnimationCss() below.
//
// Preset rules only need to override the *initial* (hidden) state — the
// existing `.slide.content-in [data-anim]{transform:none;}` rule already
// wins the "settled" state for every preset, since transform:none is what
// every preset settles to. Source order (this block is appended after the
// original rule) is what makes the preset-specific initial states win over
// the base `[data-anim]` rule at equal specificity.
const ANIMATION_CSS_MARKER = '@presStudio:anim-presets';

const ANIMATION_CSS = `
/* ${ANIMATION_CSS_MARKER} — Milestone 8 entrance/emphasis presets, additive, see lib/animationCss.js */
[data-anim-preset="fade"]{transform:none;}
[data-anim-preset="slide-down"]{transform:translateY(-18px);}
[data-anim-preset="slide-left"]{transform:translateX(18px);}
[data-anim-preset="slide-right"]{transform:translateX(-18px);}
[data-anim-preset="zoom"]{transform:scale(.85);}
@keyframes edPulse{0%,100%{transform:scale(1);}50%{transform:scale(1.08);}}
@keyframes edBounce{0%,20%,50%,80%,100%{transform:translateY(0);}40%{transform:translateY(-10px);}60%{transform:translateY(-5px);}}
@keyframes edShake{0%,100%{transform:translateX(0);}20%,60%{transform:translateX(-6px);}40%,80%{transform:translateX(6px);}}
@keyframes edFlash{0%,100%{opacity:1;}50%{opacity:.3;}}
[data-emphasis]{animation-duration:.6s; animation-timing-function:ease; animation-fill-mode:both; animation-delay:calc(var(--ed,0) * 70ms);}
.slide.content-in [data-emphasis="pulse"]{animation-name:edPulse;}
.slide.content-in [data-emphasis="bounce"]{animation-name:edBounce;}
.slide.content-in [data-emphasis="shake"]{animation-name:edShake;}
.slide.content-in [data-emphasis="flash"]{animation-name:edFlash;}
`;

// Applied on the fly wherever a styleBlock is actually consumed for
// rendering (Canvas.tsx's buildSlideDoc call, exportPresentation.ts's head
// splice) — never persisted back into state.meta.styleBlock itself, so the
// *stored* stylesheet stays exactly what was imported/theme-edited and
// lib/paletteFromCss.js's :root{} regex splicing never has to account for
// this block being there. Idempotent (checked via the marker comment) so
// calling it repeatedly — once per render — never duplicates the block.
export function ensureAnimationCss(styleBlock) {
  const block = styleBlock || '';
  if (block.includes(ANIMATION_CSS_MARKER)) return block;
  return `${block}\n${ANIMATION_CSS}`;
}
