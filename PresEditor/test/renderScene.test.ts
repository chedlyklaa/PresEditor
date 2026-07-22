import { describe, it, expect } from 'vitest';
import { renderScene } from '../src/scene/renderScene';
import { wrapHtmlAsScene } from '../src/scene/legacyHtmlAdapter';
import { resolveEffectiveBackground } from '../src/lib/slideBackground';

// The stated invariant (scene/legacyHtmlAdapter.ts's own comment): an
// imported slide that hasn't been genuinely edited must export
// byte-identical to the original file. This is the single most
// consequential correctness property in the rendering pipeline — a
// regression here silently corrupts every future export of an untouched
// import, which nothing else in the app would surface.
const SAMPLE_SLIDE_HTML =
  '<div class="pad"><div class="eyebrow eyebrow-light">RUBRIQUE</div><h1 class="title title-light">Titre</h1><div class="lede">Un paragraphe.</div></div>';

describe('renderScene: byte-identical export round trip', () => {
  it('an untouched imported scene exports back to the exact original HTML', () => {
    const scene = wrapHtmlAsScene(SAMPLE_SLIDE_HTML);
    const out = renderScene(scene, 'export', {});
    expect(out).toBe(SAMPLE_SLIDE_HTML);
  });

  it('moving the legacy object off (0,0) breaks the fast path — export no longer byte-identical', () => {
    const scene = wrapHtmlAsScene(SAMPLE_SLIDE_HTML);
    const objId = scene.objectOrder[0];
    scene.objectsById[objId] = { ...scene.objectsById[objId], x: 40, y: 0 } as typeof scene.objectsById[typeof objId];
    const out = renderScene(scene, 'export', {});
    expect(out).not.toBe(SAMPLE_SLIDE_HTML);
    expect(out).toContain(SAMPLE_SLIDE_HTML); // content itself is untouched, just no longer unwrapped
  });

  it('adding a second object breaks the fast path even if the legacy object itself is untouched', () => {
    const scene = wrapHtmlAsScene(SAMPLE_SLIDE_HTML);
    const legacyId = scene.objectOrder[0];
    scene.objectOrder.push('extra_obj');
    scene.objectsById['extra_obj'] = {
      id: 'extra_obj',
      type: 'text',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      locked: false,
      hidden: false,
      data: { html: 'extra' },
    };
    const out = renderScene(scene, 'export', {});
    expect(out).not.toBe(SAMPLE_SLIDE_HTML);
    expect(scene.objectOrder).toContain(legacyId);
  });

  it("'edit' mode never takes the fast path — the canvas always needs data-object-id instrumentation", () => {
    const scene = wrapHtmlAsScene(SAMPLE_SLIDE_HTML);
    const out = renderScene(scene, 'edit', {});
    expect(out).not.toBe(SAMPLE_SLIDE_HTML);
    expect(out).toContain('data-object-id');
    expect(out).toContain('data-object-type="legacy-html"');
    expect(out).toContain(SAMPLE_SLIDE_HTML); // the original content is still in there, just wrapped
  });

  it('a hidden legacy object is dropped from export entirely (hidden objects are filtered before rendering)', () => {
    const scene = wrapHtmlAsScene(SAMPLE_SLIDE_HTML);
    const objId = scene.objectOrder[0];
    scene.objectsById[objId] = { ...scene.objectsById[objId], hidden: true } as typeof scene.objectsById[typeof objId];
    const out = renderScene(scene, 'export', {});
    expect(out).not.toContain('RUBRIQUE');
  });
});

describe('slideBackground: slide -> section -> deck cascade', () => {
  // Regression guard for a real bug fixed this session: the editor's own
  // preview once silently ignored the deck's per-section light-mode tint,
  // making section 2+ render plain white in the editor while the actual
  // presented deck correctly tinted it. This doesn't re-test that specific
  // CSS-variable mechanism (that lives in canvasEditing.js/genericTemplate.js,
  // not here), but it does pin down the cascade *resolution* logic
  // (slideBackground.js) that a correct fix depends on staying right.
  const meta = { defaultBackground: null as null | { kind: 'color'; value: string } };
  const section = { defaultBackground: null as null | { kind: 'color'; value: string } };

  it('a slide with no background of its own falls back to its section default', () => {
    const scene = { background: null } as Parameters<typeof resolveEffectiveBackground>[0];
    const sectionWithBg = { ...section, defaultBackground: { kind: 'color' as const, value: '#fff8bb' } };
    const resolved = resolveEffectiveBackground(scene, sectionWithBg, meta);
    expect(resolved).toEqual({ kind: 'color', value: '#fff8bb' });
  });

  it('a slide with no section (Q&A) falls back to the deck-wide default', () => {
    const scene = { background: null } as Parameters<typeof resolveEffectiveBackground>[0];
    const metaWithBg = { defaultBackground: { kind: 'color' as const, value: '#dac2e6' } };
    const resolved = resolveEffectiveBackground(scene, null, metaWithBg);
    expect(resolved).toEqual({ kind: 'color', value: '#dac2e6' });
  });

  it("the slide's own background always wins over section and deck defaults", () => {
    const scene = { background: { kind: 'color' as const, value: '#111111' } };
    const sectionWithBg = { ...section, defaultBackground: { kind: 'color' as const, value: '#fff8bb' } };
    const metaWithBg = { defaultBackground: { kind: 'color' as const, value: '#dac2e6' } };
    const resolved = resolveEffectiveBackground(scene, sectionWithBg, metaWithBg);
    expect(resolved).toEqual({ kind: 'color', value: '#111111' });
  });

  it('no background set anywhere in the cascade resolves to null (the deck CSS default applies)', () => {
    const scene = { background: null } as Parameters<typeof resolveEffectiveBackground>[0];
    const resolved = resolveEffectiveBackground(scene, section, meta);
    expect(resolved).toBeNull();
  });
});
