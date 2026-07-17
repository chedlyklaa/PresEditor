// Imperative DOM helpers for the live slide canvas. The canvas is an iframe
// (srcdoc) so the slide's own CSS never collides with the editor's chrome —
// these functions build that document's content and turn parts of it into
// editable regions, mirroring the same trade-off presentation.html itself
// makes: content is arbitrary hand-authored HTML, not a structured schema,
// so "editable" means "make the right DOM nodes contenteditable" rather
// than rendering typed fields.

import { findBackgroundInHtml, backgroundToCss } from './slideBackground';

const FONT_LINKS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700;9..144,900&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">`;

function editorOverlayCss() {
  return `
    body{margin:0;}
    .ed-editable{outline-offset:2px; border-radius:3px; cursor:text;}
    .ed-editable:hover{outline:1.5px dashed rgba(75,9,118,.45);}
    .ed-editable:focus{outline:2px solid #f4c10b;}
    .ed-img-wrap{position:relative; display:inline-block; width:100%; height:100%;}
    .ed-img-btn{position:absolute; right:8px; bottom:8px; z-index:5; background:rgba(36,17,48,.82); color:#fff; font-family:'IBM Plex Mono',monospace; font-size:10px; padding:6px 10px; border-radius:7px; border:none; cursor:pointer; opacity:0; transition:opacity .15s;}
    .ed-img-wrap:hover .ed-img-btn, [data-image-slot]:hover .ed-img-btn{opacity:1;}
    .ed-list-add{display:block; margin-top:4px; font-family:'IBM Plex Mono',monospace; font-size:10px; color:#8c6aa3; background:rgba(75,9,118,.07); border:1px dashed rgba(75,9,118,.3); border-radius:6px; padding:4px 8px; cursor:pointer;}
    .ed-li-wrap{position:relative;}
    .ed-li-del{position:absolute; right:-4px; top:50%; transform:translateY(-50%); width:16px; height:16px; border-radius:50%; background:#c33; color:#fff; font-size:10px; line-height:16px; text-align:center; display:none; cursor:pointer;}
    .ed-li-wrap:hover .ed-li-del{display:block;}
    .ed-free{outline:1.5px dashed transparent; transition:outline-color .15s;}
    .ed-free:hover{outline-color:rgba(244,193,11,.7);}
    .ed-free-handle{position:absolute; top:-11px; left:-11px; width:22px; height:22px; border-radius:6px; background:rgba(36,17,48,.85); color:#fff; display:flex; align-items:center; justify-content:center; cursor:grab; opacity:0; transition:opacity .15s; z-index:6;}
    .ed-free-handle svg{width:13px; height:13px;}
    .ed-free:hover .ed-free-handle{opacity:1;}
    .ed-free-del{position:absolute; top:-11px; right:-11px; width:20px; height:20px; border-radius:50%; background:#c33; color:#fff; border:none; font-size:12px; line-height:20px; text-align:center; padding:0; cursor:pointer; opacity:0; transition:opacity .15s; z-index:6;}
    .ed-free:hover .ed-free-del{opacity:1;}
    .ed-free-resize{position:absolute; right:-6px; bottom:-6px; width:14px; height:14px; border-radius:3px; background:#f4c10b; border:1.5px solid rgba(36,17,48,.85); cursor:nwse-resize; opacity:0; transition:opacity .15s; z-index:6;}
    .ed-free:hover .ed-free-resize{opacity:1;}
    .grid > *{position:relative;}
    .ed-grid-handle{position:absolute; top:-8px; left:-8px; width:20px; height:20px; border-radius:5px; background:rgba(36,17,48,.85); color:#fff; display:flex; align-items:center; justify-content:center; cursor:grab; opacity:0; transition:opacity .15s; z-index:6;}
    .ed-grid-handle svg{width:11px; height:11px;}
    .grid > *:hover .ed-grid-handle{opacity:1;}
    .ed-dragging{opacity:.45;}
  `;
}

export function wrapImageSlots(html) {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  holder.querySelectorAll('img, video').forEach((el, i) => el.setAttribute('data-image-slot', String(i)));
  return holder.innerHTML;
}

// The real deck engine (genericTemplate.js / an imported presentation.html's
// own tail script) never gives `.slide-light` a flat white background —
// `.slide-light{ background:var(--slide-bg, var(--bg-light)); ... }`, and
// the engine's own slide-building loop sets `--slide-bg` inline per slide,
// cycling through LIGHT_BG by the slide's *section* index so consecutive
// sections read as subtly different tints (white/pale-yellow/pale-lavender)
// instead of one flat page color; a Q&A ("hidden-node") slide always gets
// the plain first tone, no cycling. buildSlideDoc previously never set
// `--slide-bg` at all, so every light slide silently fell back to
// `--bg-light` (plain white) in the editor's own preview regardless of
// which section it was in — correct in the real presented/exported file,
// wrong here. Mirrors that exact formula so the two stop disagreeing.
// `.slide-dark`'s CSS never reads `--slide-bg` at all, so setting it is a
// harmless no-op for dark slides, matching the real engine (which sets it
// unconditionally on every slide too).
const LIGHT_BG = ['#fdfafc', '#fff8bb', '#dac2e6'];

/** @param {number | null} [sectionIndex] */
export function buildSlideDoc(slide, pageIndex, styleBlock, sectionIndex = null) {
  const rawHtml = slide.pages[pageIndex] ?? slide.pages[0];
  // Searched anywhere in the string (findBackgroundInHtml), not just as
  // the literal first child — see lib/slideBackground.js's comment on why
  // that distinction matters once Milestone 1 started wrapping every
  // object in its own data-object-id div.
  const bg = findBackgroundInHtml(rawHtml);
  const html = wrapImageSlots(rawHtml);
  // A custom background needs to sit *behind* the .slide::before
  // watermark, not inside .detail-content (which is a stacking context of
  // its own — see the comment in lib/slideBackground.js). z-index:-1 as a
  // direct sibling of .detail-content, both children of #slide-root, is
  // the one place that actually paints behind it. It composites *above*
  // #slide-root's own CSS background (including the --slide-bg tint just
  // below), so an explicit custom background still correctly wins.
  const bgLayerHtml = bg
    ? `<div style="position:absolute; inset:0; z-index:-1; background:${backgroundToCss(bg)}; pointer-events:none;"></div>`
    : '';
  const slideBg = sectionIndex != null ? LIGHT_BG[sectionIndex % LIGHT_BG.length] : LIGHT_BG[0];
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${FONT_LINKS}<style>${styleBlock || ''}${editorOverlayCss()}</style></head>` +
    `<body class="${slide.cls}" style="margin:0;">` +
    `<div id="slide-root" class="slide ${slide.cls} active content-in" style="position:relative; width:1280px; height:720px; overflow:hidden; --slide-bg:${slideBg};">` +
    bgLayerHtml +
    `<div class="detail-content" style="position:relative; inset:auto; opacity:1; pointer-events:auto; width:100%; height:100%;">` +
    `<div class="pages-wrap" style="position:relative; width:100%; height:100%;">` +
    `<div class="detail-page page-active" style="position:relative; opacity:1; pointer-events:auto; width:100%; height:100%;">${html}</div>` +
    `</div></div></div></body></html>`;
}

const INLINE_TAGS = new Set(['SPAN', 'B', 'I', 'STRONG', 'EM', 'BR', 'SUP', 'SUB', 'A', 'SMALL', 'U']);

function isLeaf(el) {
  if (el.children.length === 0) return el.textContent.trim() !== '';
  return Array.from(el.children).every((c) => INLINE_TAGS.has(c.tagName));
}

function attachListDeleteHandlers(wrap, li, listEl, onEdited) {
  const del = wrap.ownerDocument.createElement('span');
  del.className = 'ed-li-del';
  del.textContent = '×';
  del.title = 'Supprimer cet élément';
  del.addEventListener('click', () => {
    if (listEl.querySelectorAll('li').length <= 1) return;
    wrap.remove();
    onEdited();
  });
  wrap.appendChild(del);
}

function enhanceList(listEl, doc, onEdited) {
  Array.from(listEl.children).forEach((li) => {
    if (li.tagName !== 'LI') return;
    const wrap = doc.createElement('span');
    wrap.className = 'ed-li-wrap';
    li.parentNode.insertBefore(wrap, li);
    wrap.appendChild(li);
    li.setAttribute('contenteditable', 'true');
    li.classList.add('ed-editable');
    li.addEventListener('input', onEdited);
    attachListDeleteHandlers(wrap, li, listEl, onEdited);
  });

  const addBtn = doc.createElement('span');
  addBtn.className = 'ed-list-add';
  addBtn.textContent = '+ Ajouter un élément';
  addBtn.addEventListener('click', () => {
    const last = listEl.querySelector('li');
    const li = last ? last.cloneNode(true) : doc.createElement('li');
    li.removeAttribute('data-image-slot');
    li.textContent = 'Nouvel élément';
    const wrap = doc.createElement('span');
    wrap.className = 'ed-li-wrap';
    listEl.insertBefore(wrap, addBtn);
    wrap.appendChild(li);
    li.setAttribute('contenteditable', 'true');
    li.classList.add('ed-editable');
    li.addEventListener('input', onEdited);
    attachListDeleteHandlers(wrap, li, listEl, onEdited);
    onEdited();
  });
  listEl.appendChild(addBtn);
}

export function makeEditable(root, doc, onEdited) {
  const walk = (el) => {
    if (!el.hasAttribute) return;
    if (el.hasAttribute('data-image-slot') || el.hasAttribute('data-free') || el.hasAttribute('data-slide-bg-layer')) return;
    if (el.tagName === 'UL' || el.tagName === 'OL') {
      enhanceList(el, doc, onEdited);
      return;
    }
    if (isLeaf(el)) {
      el.setAttribute('contenteditable', 'true');
      el.classList.add('ed-editable');
      el.addEventListener('input', onEdited);
      return;
    }
    Array.from(el.children).forEach(walk);
  };
  Array.from(root.children).forEach(walk);
}

const MEDIA_TAGS = new Set(['IMG', 'VIDEO']);

export function wireImageSlot(el, doc, onRequestImage) {
  const btn = doc.createElement('button');
  btn.className = 'ed-img-btn';
  btn.textContent = MEDIA_TAGS.has(el.tagName) ? '⭯ Remplacer' : '+ Ajouter';
  if (MEDIA_TAGS.has(el.tagName)) {
    const wrap = doc.createElement('span');
    wrap.className = 'ed-img-wrap';
    el.parentNode.insertBefore(wrap, el);
    wrap.appendChild(el);
    wrap.appendChild(btn);
  } else {
    el.style.position = 'relative';
    el.appendChild(btn);
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onRequestImage(el);
  });
}

export function wireImageSlots(root, doc, onRequestImage) {
  root.querySelectorAll('[data-image-slot]').forEach((el) => wireImageSlot(el, doc, onRequestImage));
}

// Returns the element now representing the image. For an existing <img> the
// original element is reused (still wired to its "replace" button) and
// returned as-is; for a placeholder being filled in for the first time a
// brand-new <img> replaces it and is returned so the caller can wire it up.
export function applyImageToSlot(targetEl, dataUrl) {
  if (MEDIA_TAGS.has(targetEl.tagName)) {
    targetEl.src = dataUrl;
    return targetEl;
  }
  const doc = targetEl.ownerDocument;
  const img = doc.createElement('img');
  img.src = dataUrl;
  img.setAttribute('data-image-slot', '1');
  img.style.cssText = targetEl.getAttribute('style') || '';
  img.style.objectFit = 'cover';
  img.style.display = 'block';
  img.style.width = '100%';
  targetEl.replaceWith(img);
  return img;
}

// Appends a freely positioned, draggable & resizable image or video block to
// `container` (a slide's top-level content wrapper) and returns it. Reuses
// the same data-image-slot mechanism as the layout templates' placeholders
// so it automatically gets a "replace" button via wireImageSlots().
export function insertFreeMedia(container, doc, kind, dataUrl) {
  const wrap = doc.createElement('div');
  wrap.className = 'ed-free';
  wrap.setAttribute('data-free', '1');
  wrap.style.cssText = 'position:absolute; left:460px; top:250px; width:360px; height:220px;';

  const media = doc.createElement(kind === 'video' ? 'video' : 'img');
  media.src = dataUrl;
  if (kind === 'video') {
    media.controls = true;
    media.muted = true;
  }
  media.setAttribute('data-image-slot', '1');
  media.style.cssText = 'width:100%; height:100%; object-fit:cover; border-radius:12px; display:block;';
  wrap.appendChild(media);
  container.appendChild(wrap);
  return wrap;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

const FREE_HANDLE_SVG = `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>`;

// Wires drag-to-move, drag-to-resize and delete on every freely positioned
// media block in the slide. Dragging starts only from the dedicated handle
// (never from clicking the block itself), so it never fights with the
// media's own controls or with selecting/editing nearby text.
export function makeFreeElementsInteractive(root, doc, onEdited) {
  root.querySelectorAll('[data-free]').forEach((block) => wireFreeBlock(block, doc, onEdited));
}

// Exported separately so a single newly-inserted block can be wired without
// re-scanning (and double-wiring) every other free block already on the
// slide — see insertFreeMedia() call sites.
export function wireFreeBlock(block, doc, onEdited) {
  const handle = doc.createElement('span');
  handle.className = 'ed-free-handle';
  handle.innerHTML = FREE_HANDLE_SVG;
  handle.title = 'Glisser pour déplacer';
  block.appendChild(handle);

  const del = doc.createElement('button');
  del.className = 'ed-free-del';
  del.textContent = '×';
  del.title = 'Supprimer';
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    block.remove();
    onEdited();
  });
  block.appendChild(del);

  const resizeHandle = doc.createElement('span');
  resizeHandle.className = 'ed-free-resize';
  resizeHandle.title = 'Glisser pour redimensionner';
  block.appendChild(resizeHandle);

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = parseFloat(block.style.left) || 0;
    const startTop = parseFloat(block.style.top) || 0;
    const w = block.offsetWidth;
    const h = block.offsetHeight;
    function onMove(ev) {
      block.style.left = `${clamp(startLeft + (ev.clientX - startX), 0, 1280 - w)}px`;
      block.style.top = `${clamp(startTop + (ev.clientY - startY), 0, 720 - h)}px`;
    }
    function onUp() {
      doc.removeEventListener('mousemove', onMove);
      doc.removeEventListener('mouseup', onUp);
      onEdited();
    }
    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', onUp);
  });

  resizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = block.offsetWidth;
    const startH = block.offsetHeight;
    const left = parseFloat(block.style.left) || 0;
    const top = parseFloat(block.style.top) || 0;
    function onMove(ev) {
      block.style.width = `${clamp(startW + (ev.clientX - startX), 60, 1280 - left)}px`;
      block.style.height = `${clamp(startH + (ev.clientY - startY), 60, 720 - top)}px`;
    }
    function onUp() {
      doc.removeEventListener('mousemove', onMove);
      doc.removeEventListener('mouseup', onUp);
      onEdited();
    }
    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', onUp);
  });
}

// Lets the cards/columns inside any .grid container (feature cards,
// comparison columns, etc.) be reordered by dragging a small handle — the
// same "handle-only" pattern as free media, so it never conflicts with
// clicking into a card's own editable text.
export function makeGridReorderable(root, doc, onEdited) {
  root.querySelectorAll('.grid').forEach((grid) => {
    Array.from(grid.children).forEach((child) => wireGridChild(grid, child, doc, onEdited));
  });
}

function wireGridChild(grid, child, doc, onEdited) {
  const handle = doc.createElement('span');
  handle.className = 'ed-grid-handle';
  handle.innerHTML = FREE_HANDLE_SVG;
  handle.title = 'Glisser pour réorganiser';
  child.appendChild(handle);

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    child.classList.add('ed-dragging');

    function onMove(ev) {
      const siblings = Array.from(grid.children).filter((c) => c !== child);
      let closest = null;
      let closestDist = Infinity;
      siblings.forEach((sib) => {
        const r = sib.getBoundingClientRect();
        const dist = Math.hypot(ev.clientX - (r.left + r.width / 2), ev.clientY - (r.top + r.height / 2));
        if (dist < closestDist) {
          closestDist = dist;
          closest = sib;
        }
      });
      if (closest) {
        const rect = closest.getBoundingClientRect();
        const after = ev.clientX > rect.left + rect.width / 2 || ev.clientY > rect.top + rect.height / 2;
        grid.insertBefore(child, after ? closest.nextSibling : closest);
      }
    }
    function onUp() {
      doc.removeEventListener('mousemove', onMove);
      doc.removeEventListener('mouseup', onUp);
      child.classList.remove('ed-dragging');
      onEdited();
    }
    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', onUp);
  });
}

export function unwrapEditorArtifacts(rootEl) {
  const clone = rootEl.cloneNode(true);
  clone
    .querySelectorAll('.ed-img-btn, .ed-li-del, .ed-list-add, .ed-free-handle, .ed-free-del, .ed-free-resize, .ed-grid-handle')
    .forEach((el) => el.remove());
  clone.querySelectorAll('.ed-dragging').forEach((el) => el.classList.remove('ed-dragging'));
  clone.querySelectorAll('.ed-editable').forEach((el) => {
    el.classList.remove('ed-editable');
    if (el.classList.length === 0) el.removeAttribute('class');
    el.removeAttribute('contenteditable');
  });
  // unwrap .ed-img-wrap / .ed-li-wrap helper spans, keeping their real content
  clone.querySelectorAll('.ed-img-wrap, .ed-li-wrap').forEach((wrap) => {
    const parent = wrap.parentNode;
    while (wrap.firstChild) parent.insertBefore(wrap.firstChild, wrap);
    parent.removeChild(wrap);
  });
  // <img>/<video> slots are re-tagged on every render by wrapImageSlots(), so
  // the attribute is ephemeral there — strip it. Non-media elements (e.g.
  // the "image" layout's .shot-placeholder) carry data-image-slot as part
  // of their authored template, marking a permanent click-to-add-image
  // affordance, so it must survive the round trip through state/export.
  // `.ed-free` blocks and the background-color layer are themselves
  // persisted content (not editor artifacts) and are left untouched.
  clone.querySelectorAll('img[data-image-slot], video[data-image-slot]').forEach((el) => el.removeAttribute('data-image-slot'));
  return clone.innerHTML;
}
