// Milestone 10 (single-window presenter overlay) + Milestone B (v2:
// two-window presenter mode) — additive tail-script injection, the same
// regex-patch technique exportPresentation.ts's injectBgLayerSupport uses
// for the background-layer feature (Milestone 4). An imported deck's own
// tail script is never rewritten wholesale — only patched at two small,
// stable anchor points that genericTemplate.js's GENERIC_TAIL and the real
// presentation.html are confirmed to share byte-for-byte:
//   1. the existing 'f' fullscreen keydown branch (new branches added right
//      after it, for 'p' presenter-overlay, 'l' laser pointer, 'b' blackout)
//   2. the closing </script> tag (the new behavior block is appended just
//      before it)
//
// Deliberately does NOT hook into enterDetail()/goViaMap() to detect a
// slide change — patching a multi-line function body by regex is fragile
// across deck variants that may have diverged slightly from the generic
// template. Instead everything here polls the tail script's own top-level
// `current`/`ALL_SLIDES`/`slideEls` bindings on a short interval, so it only
// ever needs the two single-line anchors above.
//
// Two-window design: both the audience tab (plain "Présenter") and the
// presenter tab ("Vue présentateur") run the *exact same* exported HTML/JS
// — there is no separate presenter build. Which layout a given window shows
// is decided at runtime by isPresenterWindow (see PRESENTER_JS below), and
// the two windows stay in sync over a BroadcastChannel: whichever window's
// own internal `current` changes (from its own keyboard nav — either window
// can drive navigation, since both run the full engine) gets polled and
// broadcast; the other window calls its own local goViaMap() to follow.
// Neither window ever reaches into the other's DOM/JS directly, so this
// works exactly the same whether one window opened the other or they were
// opened completely independently (e.g. two tabs on the same exported file).
const PRESENTER_CSS_MARKER = '@presStudio:presenter-mode';

const PRESENTER_CSS = `
/* ${PRESENTER_CSS_MARKER} — Milestones 10 & B, see lib/presenterMode.ts */
#presenterOverlay{position:fixed; right:18px; top:18px; z-index:70; width:280px; background:rgba(35,10,55,.88); color:#fff; border-radius:14px; padding:16px 18px; font-family:var(--body); backdrop-filter:blur(6px); box-shadow:0 18px 40px -14px rgba(0,0,0,.6); opacity:0; pointer-events:none; transform:translateY(-8px); transition:opacity .25s ease, transform .25s ease;}
#presenterOverlay.show{opacity:1; pointer-events:auto; transform:none;}
#presenterOverlay .po-timer{font-family:var(--mono); font-size:22px; font-weight:600; color:var(--teal,#f4c10b); margin-bottom:10px;}
#presenterOverlay .po-label{font-family:var(--mono); font-size:10px; letter-spacing:.12em; text-transform:uppercase; color:#dac2e6; opacity:.7; margin-bottom:4px;}
#presenterOverlay .po-notes{font-size:12.5px; line-height:1.5; color:#f2eaf7; white-space:pre-wrap; max-height:220px; overflow:auto;}
#laserDot{position:fixed; z-index:80; width:16px; height:16px; margin:-8px 0 0 -8px; border-radius:50%; background:radial-gradient(circle, rgba(255,50,50,.9) 0%, rgba(255,50,50,.35) 60%, transparent 100%); pointer-events:none; display:none;}
body.laser-active{cursor:none;}
body.laser-active #laserDot{display:block;}
#blackoutOverlay{position:fixed; inset:0; z-index:96; background:#000; opacity:0; pointer-events:none; transition:opacity .2s ease;}
#blackoutOverlay.show{opacity:1; pointer-events:auto;}
body.presenter-view #viewport, body.presenter-view #graph-chrome, body.presenter-view #mapBtn, body.presenter-view #ui-progress, body.presenter-view #ui-counter, body.presenter-view #ui-hint, body.presenter-view #ui-dots, body.presenter-view #ui-arrows, body.presenter-view #chapterCard{ display:none !important; }
#presenterView{position:fixed; inset:0; z-index:90; display:flex; background:#1b0730; color:#fff; font-family:var(--body);}
#pvMain{position:relative; flex:1 1 66%; overflow:hidden; background:#000;}
#pvMain .pv-empty, #pvNext .pv-empty{position:absolute; inset:0; display:flex; align-items:center; justify-content:center; text-align:center; padding:24px; color:#dac2e6; font-size:13px;}
#pvSide{flex:1 1 34%; padding:22px 24px; display:flex; flex-direction:column; gap:14px; overflow:auto;}
#pvClockRow{display:flex; justify-content:space-between; align-items:baseline;}
#pvClock{font-family:var(--mono); font-size:15px; color:#dac2e6;}
#pvTimer{font-family:var(--mono); font-size:28px; font-weight:700; color:var(--teal,#f4c10b);}
#pvCounter{font-family:var(--mono); font-size:12px; color:#dac2e6;}
#pvBlackoutFlag{font-family:var(--mono); font-size:11px; color:#ff6b6b; display:none;}
#pvBlackoutFlag.show{display:block;}
.pv-label{font-family:var(--mono); font-size:10px; letter-spacing:.12em; text-transform:uppercase; color:#dac2e6; opacity:.7;}
#pvNotes{font-size:13px; line-height:1.6; color:#f2eaf7; white-space:pre-wrap; flex:0 1 auto; overflow:auto; max-height:220px;}
#pvNext{position:relative; width:100%; aspect-ratio:16/9; background:#000; border-radius:8px; overflow:hidden; border:1px solid rgba(255,255,255,.12);}
`;

const PRESENTER_JS_MARKER = '@presStudio:presenter-mode-js';

const PRESENTER_JS = `
/* ${PRESENTER_JS_MARKER} */
(function(){
  var isPresenterWindow = window.__presStudioPresenterView === true || /presenter/.test(location.hash) || /presenter/.test(location.search);

  document.body.insertAdjacentHTML('beforeend',
    '<div id="presenterOverlay"><div class="po-timer" id="poTimer">00:00</div><div class="po-label">Notes</div><div class="po-notes" id="poNotes">Aucune note.</div></div>' +
    '<div id="laserDot"></div>' +
    '<div id="blackoutOverlay"></div>'
  );
  var overlayEl = document.getElementById('presenterOverlay');
  var timerEl = document.getElementById('poTimer');
  var notesEl = document.getElementById('poNotes');
  var laserEl = document.getElementById('laserDot');
  var blackoutEl = document.getElementById('blackoutOverlay');
  var startTime = null, overlayOpen = false, laserOn = false, blackoutOn = false, pollTimer = null;

  function fmt(ms){
    var s = Math.floor(ms/1000);
    var m = Math.floor(s/60);
    s = s % 60;
    return String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
  }
  function ensureStarted(){ if(startTime==null) startTime = Date.now(); }

  // ---- cross-window sync: BroadcastChannel, falling back to a localStorage
  // ping for browsers/contexts where it's unavailable (both are same-origin
  // mechanisms — see this file's top comment for why that's guaranteed for
  // the in-editor "Présenter"/"Vue présentateur" pair). ----
  var channel = null;
  try { channel = new BroadcastChannel('presStudio-sync'); } catch(e){}
  function broadcast(msg){
    if(channel){ try{ channel.postMessage(msg); }catch(e){} }
    else { try{ localStorage.setItem('presStudio-sync-ping', JSON.stringify(Object.assign({}, msg, {_t: Date.now()}))); }catch(e){} }
  }
  function handleMessage(msg){
    if(!msg) return;
    if(msg.type === 'nav'){
      if(typeof msg.index === 'number' && msg.index !== current) goViaMap(msg.index);
    } else if(msg.type === 'laser'){
      laserOn = !!msg.on;
      document.body.classList.toggle('laser-active', laserOn);
      if(laserOn && typeof msg.x === 'number'){ laserEl.style.left = msg.x+'px'; laserEl.style.top = msg.y+'px'; }
    } else if(msg.type === 'blackout'){
      applyBlackout(!!msg.on, false);
    }
  }
  if(channel) channel.onmessage = function(e){ handleMessage(e.data); };
  window.addEventListener('storage', function(e){
    if(e.key === 'presStudio-sync-ping' && e.newValue){
      try{ handleMessage(JSON.parse(e.newValue)); }catch(err){}
    }
  });

  // Poll for *local* navigation (this window's own keyboard/click nav) and
  // broadcast it — the only way this file learns "the slide changed" at
  // all, in either window, for the reason explained in the top comment.
  var lastBroadcastIndex = typeof current !== 'undefined' ? current : null;
  setInterval(function(){
    if(typeof current !== 'undefined' && current !== lastBroadcastIndex){
      lastBroadcastIndex = current;
      broadcast({type:'nav', index: current});
    }
  }, 300);

  function refresh(){
    if(startTime!=null) timerEl.textContent = fmt(Date.now()-startTime);
    var idx = (typeof current !== 'undefined') ? current : null;
    var slide = (idx!=null && typeof ALL_SLIDES !== 'undefined') ? ALL_SLIDES[idx] : null;
    notesEl.textContent = (slide && slide.notes) ? slide.notes : 'Aucune note.';
  }
  window.togglePresenterOverlay = function(){
    overlayOpen = !overlayOpen;
    ensureStarted();
    overlayEl.classList.toggle('show', overlayOpen);
    if(overlayOpen){ refresh(); if(!pollTimer) pollTimer = setInterval(refresh, 500); }
    else if(pollTimer){ clearInterval(pollTimer); pollTimer = null; }
  };
  window.toggleLaser = function(){
    laserOn = !laserOn;
    document.body.classList.toggle('laser-active', laserOn);
    broadcast({type:'laser', on:laserOn, x:0, y:0});
  };
  document.addEventListener('mousemove', function(e){
    if(!laserOn) return;
    laserEl.style.left = e.clientX + 'px';
    laserEl.style.top = e.clientY + 'px';
    broadcast({type:'laser', on:true, x:e.clientX, y:e.clientY});
  });

  // Milestone B: blackout blanks the *audience* window's screen regardless
  // of which window toggled it — the presenter's own view stays visible
  // (just flags that it's active) so they aren't presenting blind. \`fromLocal\`
  // is true only for the toggle that originated the change, so only that
  // call broadcasts (handleMessage's applyBlackout(..., false) call from a
  // received message never re-broadcasts, avoiding an echo loop).
  function applyBlackout(on, fromLocal){
    blackoutOn = on;
    if(!isPresenterWindow) blackoutEl.classList.toggle('show', on);
    var flag = document.getElementById('pvBlackoutFlag');
    if(flag) flag.classList.toggle('show', on);
    if(fromLocal) broadcast({type:'blackout', on:on});
  }
  window.toggleBlackout = function(){ applyBlackout(!blackoutOn, true); };

  // Appended to the existing on-screen hint via DOM, not by regex-patching
  // its HTML text — the hint element's id/class is stable, so this is more
  // robust than adding a third fragile text anchor to injectPresenterMode.
  var hintEl = document.querySelector('#ui-hint .detail-hint');
  if(hintEl) hintEl.textContent += ' · P notes · L laser · B noir';

  // ---- Milestone B: dedicated presenter-window layout ----
  if(isPresenterWindow){
    ensureStarted();
    document.body.classList.add('presenter-view');
    document.body.insertAdjacentHTML('beforeend',
      '<div id="presenterView">' +
        '<div id="pvMain"></div>' +
        '<div id="pvSide">' +
          '<div id="pvClockRow"><span id="pvClock">00:00:00</span><span id="pvTimer">00:00</span></div>' +
          '<div id="pvCounter"></div>' +
          '<div id="pvBlackoutFlag">ÉCRAN NOIR ACTIF (public)</div>' +
          '<div class="pv-label">Notes</div>' +
          '<div id="pvNotes"></div>' +
          '<div class="pv-label">Diapositive suivante</div>' +
          '<div id="pvNext"></div>' +
        '</div>' +
      '</div>'
    );
    var pvMain = document.getElementById('pvMain');
    var pvNext = document.getElementById('pvNext');
    var pvNotes = document.getElementById('pvNotes');
    var pvCounter = document.getElementById('pvCounter');
    var pvTimer = document.getElementById('pvTimer');
    var pvClock = document.getElementById('pvClock');

    // 'forceActive' stamps the clone itself (never the live source element)
    // with the same 'active'+'content-in' classes the audience-visible
    // slide gets from enterDetail()/the double-rAF in goViaMap() — without
    // it, a clone of any slide that ISN'T currently the live '.active' one
    // (i.e. every "next slide" preview, always) renders via this deck's own
    // CSS exactly as the map/graph view of that node: .node-face is
    // opacity:1 by default and only hidden by .slide.active .node-face,
    // while .detail-content is the opposite (opacity:0 unless active) — so
    // an un-forced clone shows the slide's icon+title bubble, not its real
    // content. Forcing it on pvMain's clone too (even though the source
    // already has it) is cheap insurance against the same double-rAF delay
    // enterDetail() itself has before adding 'content-in' — a poll landing
    // in that ~2-frame window would otherwise clone a still-not-revealed
    // slide (data-anim elements at opacity:0) into the main preview.
    function fitClone(liveEl, container, forceActive){
      container.innerHTML = '';
      if(!liveEl) return;
      var clone = liveEl.cloneNode(true);
      clone.removeAttribute('id');
      clone.querySelectorAll('[id]').forEach(function(el){ el.removeAttribute('id'); });
      if(forceActive) clone.classList.add('active', 'content-in');
      var cw = container.clientWidth || 1, ch = container.clientHeight || 1;
      var scale = Math.min(cw/1280, ch/720);
      clone.style.cssText = 'position:absolute; top:50%; left:50%; width:1280px; height:720px; ' +
        'transform:translate(-50%,-50%) scale('+scale+'); transform-origin:center center; pointer-events:none;';
      container.appendChild(clone);
      // Best-effort video mirroring for pvMain only — a cloned <video> is a
      // brand-new element with no playback state of its own, so without
      // this the "big screen" would show a frozen poster frame instead of
      // whatever the audience is actually watching. pvNext (a slide never
      // yet visited) is deliberately left un-synced/paused: nothing is
      // "playing" there for the audience yet either.
      if(forceActive && container === pvMain){
        var liveVideos = liveEl.querySelectorAll('video.slide-video');
        var cloneVideos = clone.querySelectorAll('video.slide-video');
        liveVideos.forEach(function(lv, i){
          var cv = cloneVideos[i];
          if(!cv) return;
          cv.muted = true;
          try { cv.currentTime = lv.currentTime; } catch(e){}
          if(!lv.paused) cv.play().catch(function(){});
        });
      }
    }

    // Re-cloning is the expensive/disruptive part (tears down and rebuilds
    // a whole slide's DOM, restarting any CSS animation inside it) — only
    // done when the slide actually being shown changes, not on every poll
    // tick. The cheap bits (clock, timer, notes, counter text) still update
    // every tick so they never visibly lag.
    var lastMainKey = null, lastNextIdx = null;
    function refreshPresenterView(){
      pvTimer.textContent = fmt(Date.now()-startTime);
      var now = new Date();
      pvClock.textContent = String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')+':'+String(now.getSeconds()).padStart(2,'0');
      var idx = (typeof current !== 'undefined') ? current : null;
      if(idx == null){
        if(lastMainKey !== 'empty'){
          pvMain.innerHTML = '<div class="pv-empty">Naviguez (flèches, espace) pour commencer.</div>';
          pvNext.innerHTML = '<div class="pv-empty">—</div>';
          lastMainKey = 'empty';
          lastNextIdx = null;
        }
        pvNotes.textContent = '';
        pvCounter.textContent = '';
        return;
      }
      pvCounter.textContent = idx < MAIN_TOTAL ? (String(idx+1).padStart(2,'0')+' / '+MAIN_TOTAL) : 'Q&R';
      var slide = ALL_SLIDES[idx];
      pvNotes.textContent = (slide && slide.notes) ? slide.notes : 'Aucune note.';

      var sp = (typeof subPage !== 'undefined') ? subPage : 0;
      var mainKey = idx + ':' + sp;
      if(mainKey !== lastMainKey){
        fitClone(slideEls[idx], pvMain, true);
        lastMainKey = mainKey;
      }

      var nextIdx = idx+1;
      if(nextIdx !== lastNextIdx){
        if(nextIdx < TOTAL) fitClone(slideEls[nextIdx], pvNext, true);
        else pvNext.innerHTML = '<div class="pv-empty">Fin de la présentation</div>';
        lastNextIdx = nextIdx;
      }
    }
    setInterval(refreshPresenterView, 200);
    window.addEventListener('resize', function(){ lastMainKey = null; lastNextIdx = null; refreshPresenterView(); });
    refreshPresenterView();
  }
})();
`;

export function ensurePresenterCss(styleBlock: string): string {
  const block = styleBlock || '';
  if (block.includes(PRESENTER_CSS_MARKER)) return block;
  return `${block}\n${PRESENTER_CSS}`;
}

// Idempotent via the same marker-comment check every other tail-script
// injector in this codebase uses. If the 'f' keydown anchor isn't found
// (an unforeseen deck variant), the keyboard shortcuts simply won't be
// wired — the </script> anchor (near-universal: every valid deck ends its
// script somewhere) still installs the overlay/laser/blackout/presenter-view
// *functions* on `window`, so nothing throws either way.
export function injectPresenterMode(tailText: string): string {
  if (tailText.includes(PRESENTER_JS_MARKER)) return tailText;
  let patched = tailText.replace(
    "else if(e.key.toLowerCase()==='f'){ toggleFullscreen(); }",
    "else if(e.key.toLowerCase()==='f'){ toggleFullscreen(); }\n  else if(e.key.toLowerCase()==='p'){ if(window.togglePresenterOverlay) window.togglePresenterOverlay(); }\n  else if(e.key.toLowerCase()==='l'){ if(window.toggleLaser) window.toggleLaser(); }\n  else if(e.key.toLowerCase()==='b'){ if(window.toggleBlackout) window.toggleBlackout(); }"
  );
  patched = patched.replace(/<\/script>\s*<\/body>/, `${PRESENTER_JS}\n</script>\n</body>`);
  return patched;
}
