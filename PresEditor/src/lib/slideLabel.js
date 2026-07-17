// Best-effort human label for a slide row in the sidebar: prefer the
// explicit overview-map label, else sniff the first heading out of the
// slide's first page's legacy content (if any) so imported slides that
// never got a nodeLabel — the hidden Q&A deck — don't show up as a blank
// row. `slide.pages[0]` is a Scene id (see types/scene.ts), not raw HTML,
// so this needs the scenesById map to resolve it.
export function slideRowLabel(slide, scenesById) {
  if (slide.nodeLabel) return slide.nodeLabel;
  const scene = scenesById?.[slide.pages[0]];
  const legacyId = scene?.objectOrder.find((id) => scene.objectsById[id]?.type === 'legacy-html');
  const html = legacyId ? scene.objectsById[legacyId].data.html : '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  const heading = tmp.querySelector('h1, h2, .title');
  const text = heading ? heading.textContent.trim() : '';
  return text || 'Diapositive';
}
