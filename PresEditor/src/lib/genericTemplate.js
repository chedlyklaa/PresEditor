// Standalone "engine" used to export a deck that was never imported from an
// existing presentation.html (e.g. a brand-new blank presentation started
// in the editor). It is the same head/CSS/ICONS + map/controller tail as
// presentation.html itself, so anything exported from here stays visually
// and behaviourally consistent with the rest of the project — we are not
// inventing a second viewer.
export const GENERIC_HEAD = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Présentation</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700;9..144,900&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{
  --inv-ns:11.85;
  --navy:#4b0976;
  --navy-2:#461665;
  --blue:#f4c10b;
  --blue-dark:#edd672;
  --teal:#f4c10b;
  --teal-dim:#8c6aa3;
  --bg-light:#fdfafc;
  --ink:#fdfafc;
  --muted:#dac2e6;
  --card:#461665;
  --flag:#edd672;
  --flag-soft:#fff8bb;
  --accent-purple:#8c6aa3;
  --display: 'Fraunces', serif;
  --body: 'Inter', sans-serif;
  --mono: 'IBM Plex Mono', monospace;
}
*{box-sizing:border-box; margin:0; padding:0;}
html,body{width:100%; height:100%; background:var(--navy); overflow:hidden; font-family:var(--body); -webkit-font-smoothing:antialiased;}
button{font-family:inherit; cursor:pointer;}

#viewport{position:fixed; inset:0; overflow:hidden; background:radial-gradient(circle at 50% 30%, #5a1a8a 0%, #2d0a4a 75%);}
#stage{position:absolute; top:50%; left:50%; width:1280px; height:720px; transform-origin:center center;}

#graph-chrome{position:absolute; inset:0; z-index:1; opacity:1; transition:opacity .5s ease; pointer-events:none;}
#stage.is-detail #graph-chrome{opacity:0;}
.lane{position:absolute; top:46px; bottom:46px; border-radius:22px; background:rgba(255,255,255,.06); border:1.5px solid rgba(255,255,255,.18); box-shadow:inset 0 0 0 1px rgba(255,255,255,.03);}
.lane-label{position:absolute; top:14px; left:0; width:100%; text-align:center; font-family:var(--mono); font-size:10.5px; letter-spacing:.14em; text-transform:uppercase; color:#dac2e6; font-weight:500;}
#edges{position:absolute; inset:0; overflow:visible;}
.edge{fill:none; stroke:#8c6aa3; stroke-width:1.6; opacity:.45;}
.edge-flow{fill:none; stroke:var(--teal); stroke-width:1.6; stroke-dasharray:6 10; opacity:.85; animation:flow 2.6s linear infinite;}
@keyframes flow{ to{ stroke-dashoffset:-160; } }
.map-title{position:absolute; left:50%; top:6px; transform:translateX(-50%); text-align:center; color:#fff;}
.map-title .eyebrow{color:var(--teal); font-family:var(--mono); font-size:11px; letter-spacing:.18em; text-transform:uppercase;}
.map-title h2{font-family:var(--display); font-weight:700; font-size:21px; margin-top:2px;}

.slide{
  position:absolute; left:0; top:0; width:1280px; height:720px;
  background:var(--bg-light);
  transform: translate(var(--nx,0px), var(--ny,0px)) scale(var(--ns,1));
  transition: transform .85s cubic-bezier(.16,1,.3,1), opacity .4s ease, box-shadow .85s ease;
  border-radius:16px;
  overflow:hidden;
  z-index:2;
  box-shadow:0 18px 40px -12px rgba(0,0,0,.55);
  cursor:pointer;
}
.slide.active{ transform:translate(0,0) scale(1); border-radius:0; box-shadow:none; cursor:default; z-index:5; }
#stage.is-detail .slide:not(.active){ opacity:0; pointer-events:none; }
.hidden-node{ opacity:0; }
.hidden-node:not(.active), .hidden-node:not(.active) *{ pointer-events:none !important; }
.hidden-node.active{ opacity:1; pointer-events:auto; }
.slide-light{ background:var(--slide-bg, var(--bg-light)); color:var(--navy); --ink:#461665; --muted:#8c6aa3; --card:#ffffff; --blue-dark:#8a6a0a; }
.slide-dark{ background:var(--navy); color:#fff; }

.node-face{position:absolute; z-index:1; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:calc(var(--inv-ns)*8px); opacity:1; transition:opacity .3s ease; padding:calc(var(--inv-ns)*6px);}
.slide.active .node-face{opacity:0;}
.node-num{position:absolute; top:calc(var(--inv-ns)*8px); left:calc(var(--inv-ns)*10px); font-family:var(--mono); font-size:calc(var(--inv-ns)*9px); color:var(--accent,#8c6aa3); opacity:.85;}
.node-ic{width:calc(var(--inv-ns)*30px); height:calc(var(--inv-ns)*30px); border-radius:50%; background:var(--accent,#f4c10b); color:#fff; display:flex; align-items:center; justify-content:center; transition:transform .25s ease;}
.node-ic svg{width:calc(var(--inv-ns)*15px); height:calc(var(--inv-ns)*15px);}
.node-lbl{font-family:var(--display); font-weight:700; font-size:calc(var(--inv-ns)*10.5px); text-align:center; line-height:1.15; max-width:calc(var(--inv-ns)*108px); color:var(--ink);}
.slide-dark .node-lbl{color:#fff;}
.slide:hover:not(.active) .node-ic{transform:scale(1.18);}
.slide:hover:not(.active){box-shadow:0 22px 48px -10px rgba(0,0,0,.6);}
.lane{transition:box-shadow .5s ease, border-color .5s ease, background .5s ease;}
.lane.lane-shine{box-shadow:0 0 28px 6px rgba(244,193,11,.35), inset 0 0 18px rgba(244,193,11,.08); border-color:rgba(244,193,11,.7) !important; animation:laneGlow 2s ease-in-out infinite;}
.lane-label.lane-label-shine{color:#f4c10b !important; text-shadow:0 0 10px rgba(244,193,11,.5);}
@keyframes laneGlow{
  0%,100%{box-shadow:0 0 22px 4px rgba(244,193,11,.3), inset 0 0 14px rgba(244,193,11,.06);}
  50%{box-shadow:0 0 36px 10px rgba(244,193,11,.45), inset 0 0 22px rgba(244,193,11,.12);}
}

.detail-content{position:absolute; z-index:1; inset:0; opacity:0; transition:opacity .4s ease .15s; pointer-events:none;}
.slide.active .detail-content{opacity:1; pointer-events:auto;}
.pad{position:absolute; inset:0; padding:56px 64px; display:flex; flex-direction:column; justify-content:center;}

.pages-wrap{position:absolute; inset:0;}
.detail-page{position:absolute; inset:0; opacity:0; pointer-events:none; transition:opacity .35s ease;}
.detail-page.page-active{opacity:1; pointer-events:auto;}
.page-dots{position:absolute; left:50%; bottom:38px; transform:translateX(-50%); display:flex; gap:6px; z-index:2;}
.page-dot{width:6px; height:6px; border-radius:50%; background:rgba(75,9,118,.22); transition:background .3s, transform .3s;}
.page-dot.now{background:var(--accent,#8c6aa3); transform:scale(1.4);}

[data-anim]{opacity:0; transform:translateY(18px); transition:opacity .55s cubic-bezier(.2,.7,.2,1), transform .55s cubic-bezier(.2,.7,.2,1); transition-delay:calc(var(--d,0) * 70ms);}
.slide.content-in [data-anim]{opacity:1; transform:none;}

.eyebrow{font-family:var(--mono); font-size:12.5px; letter-spacing:.16em; text-transform:uppercase; font-weight:500;}
.eyebrow-light{color:var(--navy);}
.eyebrow-dark{color:var(--teal);}
h1.title{font-family:var(--display); font-weight:700; font-size:38px; line-height:1.08; margin-top:8px; letter-spacing:-0.01em;}
h1.title-light{color:var(--ink);}
h1.title-dark{color:#fff;}
.lede{font-family:var(--body); font-size:15.5px; line-height:1.55; color:var(--muted);}
.lede-dark{color:#dac2e6;}

.card{background:var(--card); border-radius:16px; padding:22px; box-shadow:0 14px 32px -16px rgba(75,9,118,.18);}
.card-dark{background:var(--navy); color:#fff; box-shadow:0 14px 30px -16px rgba(75,9,118,.4); border:1px solid rgba(255,255,255,.08);}
.icon-circle{width:52px; height:52px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex:none; box-shadow:0 8px 18px -6px rgba(75,9,118,.28);}
.icon-circle svg{width:24px; height:24px;}
.bg-blue{background:var(--blue);}
.bg-teal{background:#8c6aa3;}
.bg-navy{background:var(--navy);}
.bg-flag{background:var(--flag);}

.grid{display:grid; gap:18px;}
.g3{grid-template-columns:repeat(3,1fr);}
.g4{grid-template-columns:repeat(4,1fr);}
.g5{grid-template-columns:repeat(5,1fr);}
.g2{grid-template-columns:repeat(2,1fr);}
.g6{grid-template-columns:repeat(6,1fr);}

.flag-text{font-family:var(--body); font-style:italic; font-size:11.5px; color:#8a6a0a; text-align:center;}
.flag-text-on-dark{color:var(--flag-soft);}

.shot-placeholder{border:2px dashed rgba(75,9,118,.25); border-radius:16px; background:repeating-linear-gradient(135deg, rgba(75,9,118,.04) 0 10px, rgba(75,9,118,.08) 10px 20px); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; width:100%; color:rgba(75,9,118,.5);}
.shot-ic{width:36px; height:36px; color:rgba(75,9,118,.4);}
.shot-ic svg{width:100%; height:100%;}
.shot-lbl{font-family:var(--display); font-weight:700; font-size:13px; color:rgba(75,9,118,.65);}
.shot-sub{font-size:10.5px; font-style:italic; color:rgba(75,9,118,.45); text-align:center; padding:0 18px; line-height:1.4;}

.chrome-footer{position:absolute; left:64px; right:64px; bottom:26px; display:flex; justify-content:space-between; align-items:center; font-family:var(--mono); font-size:10.5px; letter-spacing:.06em;}
.chrome-footer span{opacity:.55;}
.slide-light .chrome-footer{color:#8c6aa3;}
.slide-dark .chrome-footer{color:#8c6aa3;}

.pulse-wrap{position:absolute; left:64px; bottom:50px; width:160px; height:22px; opacity:.55;}
.slide-dark .pulse-wrap{opacity:.7;}
.pulse-wrap svg{width:100%; height:100%;}
.pulse-line{fill:none; stroke:var(--teal); stroke-width:2; stroke-linecap:round; stroke-dasharray:240; stroke-dashoffset:240; animation:draw 3.2s linear infinite;}
@keyframes draw{ to{ stroke-dashoffset:-240; } }

#ui-progress{position:fixed; top:0; left:0; height:3px; background:var(--teal); z-index:50; transition:width .4s ease, opacity .3s;}
#ui-counter{position:fixed; right:22px; bottom:18px; font-family:var(--mono); font-size:12px; color:#dac2e6; z-index:50; background:rgba(70,22,101,.65); padding:5px 10px; border-radius:20px; backdrop-filter:blur(4px); transition:opacity .3s;}
#ui-arrows{position:fixed; inset:0; z-index:40; display:flex; justify-content:space-between; align-items:center; pointer-events:none;}
.ui-arrow{pointer-events:auto; width:48px; height:48px; border-radius:50%; border:none; background:rgba(255,255,255,.08); color:#fff; font-size:22px; display:flex; align-items:center; justify-content:center; margin:0 14px; transition:background .2s, opacity .3s;}
.ui-arrow:hover{background:rgba(255,255,255,.2);}
#ui-hint{position:fixed; left:22px; bottom:6px; font-family:var(--mono); font-size:11px; color:#8c6aa3; z-index:50; opacity:.7; transition:opacity .3s;}
#ui-dots{position:fixed; left:50%; bottom:18px; transform:translateX(-50%); display:flex; gap:7px; z-index:50; transition:opacity .3s;}
.ui-dot{width:7px; height:7px; border-radius:50%; background:rgba(255,255,255,.25); transition:background .3s, transform .3s; cursor:pointer;}
.ui-dot.done{background:var(--teal);}
.ui-dot.now{background:#fff; transform:scale(1.3);}
#mapBtn{position:fixed; top:18px; left:22px; z-index:50; display:flex; align-items:center; gap:8px; background:rgba(70,22,101,.65); color:#dac2e6; border:none; border-radius:20px; padding:8px 16px 8px 12px; font-family:var(--mono); font-size:11.5px; backdrop-filter:blur(4px); opacity:0; pointer-events:none; transition:opacity .3s;}
#mapBtn svg{width:14px; height:14px;}
body.in-detail #mapBtn{opacity:1; pointer-events:auto;}
body.in-detail #ui-progress, body.in-detail #ui-counter, body.in-detail #ui-arrows, body.in-detail #ui-dots{opacity:1;}
body:not(.in-detail) #ui-progress, body:not(.in-detail) #ui-counter, body:not(.in-detail) #ui-arrows, body:not(.in-detail) #ui-dots{opacity:0; pointer-events:none;}
body.in-detail #ui-hint .map-hint{display:none;}
body:not(.in-detail) #ui-hint .detail-hint{display:none;}

@media(max-width:760px){ #ui-hint{display:none;} }

#chapterCard{
  position:fixed; inset:0; z-index:60;
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  background:radial-gradient(circle at 50% 38%, #5a1a8a 0%, #2d0a4a 78%);
  opacity:0; pointer-events:none;
  transition:opacity .45s ease;
}
#chapterCard.show{ opacity:1; }
#chapterCard .chapter-bar{
  width:64px; height:3px; border-radius:2px; margin-bottom:22px;
  background:var(--chapter-color, var(--teal));
  transform:scaleX(0); transition:transform .5s cubic-bezier(.2,.7,.2,1) .1s;
}
#chapterCard.show .chapter-bar{ transform:scaleX(1); }
#chapterCard .chapter-eyebrow{
  font-family:var(--mono); font-size:12.5px; letter-spacing:.22em; text-transform:uppercase;
  color:var(--chapter-color, var(--teal)); margin-bottom:16px;
  opacity:0; transform:translateY(10px); transition:opacity .5s ease .15s, transform .5s ease .15s;
}
#chapterCard.show .chapter-eyebrow{ opacity:1; transform:none; }
#chapterCard .chapter-name{
  font-family:var(--display); font-weight:700; font-size:54px; line-height:1.1;
  color:#fff; text-align:center; padding:0 60px; text-wrap:balance;
  opacity:0; transform:translateY(14px); transition:opacity .55s ease .22s, transform .55s ease .22s;
}
#chapterCard.show .chapter-name{ opacity:1; transform:none; }
</style>
</head>
<body>

<div id="viewport">
  <div id="stage">
    <div id="graph-chrome"></div>
  </div>
</div>

<button id="mapBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><path d="M8.5 7.5 10.5 16M15.5 7.5 13.5 16M9 6h6"/></svg> Vue d'ensemble</button>
<div id="ui-progress" style="width:0%"></div>
<div id="ui-counter">01 / 01</div>
<div id="ui-hint"><span class="map-hint">Cliquez sur une étape du graphe pour commencer</span><span class="detail-hint">← → pour naviguer · Échap pour la vue d'ensemble · F plein écran</span></div>
<div id="ui-dots"></div>
<div id="ui-arrows">
  <button class="ui-arrow" id="prevBtn" aria-label="Précédent">‹</button>
  <button class="ui-arrow" id="nextBtn" aria-label="Suivant">›</button>
</div>

<div id="chapterCard">
  <div class="chapter-bar"></div>
  <div class="chapter-eyebrow">Section suivante</div>
  <div class="chapter-name"></div>
</div>

<script>
const ICONS = {
  eye:\`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12c2.7-4.4 6.3-6.6 10-6.6s7.3 2.2 10 6.6c-2.7 4.4-6.3 6.6-10 6.6S4.7 16.4 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>\`,
  search:\`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.5-4.5"/></svg>\`,
  brain:\`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3a3 3 0 0 0-3 3v1a3 3 0 0 0-1 5.8V14a3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-2-3Z"/><path d="M15 3a3 3 0 0 1 3 3v1a3 3 0 0 1 1 5.8V14a3 3 0 0 1-3 3 3 3 0 0 1-3-3V6a3 3 0 0 1 2-3Z"/></svg>\`,
  shield:\`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 5 3.5 7.7 8 9 4.5-1.3 8-4 8-9V6Z"/><path d="m9 12 2 2 4-4"/></svg>\`,
  sync:\`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>\`,
  lock:\`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>\`,
  chart:\`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19h16"/><path d="M7 19V9"/><path d="M12 19V5"/><path d="M17 19v-7"/></svg>\`,
  clipboard:\`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M9 10h6M9 14h6M9 18h3"/></svg>\`,
  robot:\`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="9" width="14" height="10" rx="2.5"/><path d="M12 5v4M9 13v2M15 13v2"/><circle cx="12" cy="3.4" r="1.1" fill="currentColor" stroke="none"/></svg>\`,
  sitemap:\`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="4" rx="1"/><rect x="3" y="17" width="6" height="4" rx="1"/><rect x="15" y="17" width="6" height="4" rx="1"/><path d="M12 7v5M12 12H6v5M12 12h6v5"/></svg>\`,
  hands:\`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13c1.5-2 3-2.5 4.5-1l2 1.6"/><path d="M21 13c-1.5-2-3-2.5-4.5-1l-3.6 3"/><path d="M7 19c2 1.4 4 1.6 6 .2l5-4"/><path d="M3 13l3 4 3-1.4"/></svg>\`,
  building:\`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01"/><path d="M10 21v-3h4v3"/></svg>\`,
  gavel:\`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 7 7 7"/><path d="m5 11 5-5 4 4-5 5z"/><path d="M3 21h7"/><path d="m13 11 7 7"/></svg>\`,
  balance:\`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v17M7 20h10"/><path d="M5 7h6M3 7l2-4 2 4M19 7h-6M17 7l2-4 2 4"/><path d="M3 7c0 1.7 1.3 3 3 3s3-1.3 3-3M15 7c0 1.7 1.3 3 3 3s3-1.3 3-3"/></svg>\`,
  database:\`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v14c0 1.7 3.1 3 7 3s7-1.3 7-3V5"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/></svg>\`,
  network:\`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2.2"/><circle cx="5" cy="19" r="2.2"/><circle cx="19" cy="19" r="2.2"/><path d="M12 7.2V13M12 13 6.5 17M12 13l5.5 4"/></svg>\`,
  route:\`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h6a4 4 0 0 0 4-4V9a4 4 0 0 0-4-4h-.5"/></svg>\`,
  warning:\`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20Z"/><path d="M12 9v5M12 17h.01"/></svg>\`,
  bolt:\`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h6l-1 8 9-12h-6Z"/></svg>\`,
  question:\`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.5 2.5 0 1 1 3.7 2.2c-.9.5-1.2 1-1.2 2"/><path d="M12 17h.01"/></svg>\`,
  user:\`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/></svg>\`,
  camera:\`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-2h6l2 2h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.2"/></svg>\`,
  server:\`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><circle cx="7" cy="7" r=".6" fill="currentColor" stroke="none"/><circle cx="7" cy="17" r=".6" fill="currentColor" stroke="none"/></svg>\`,
};
/* ============================================================
   SLIDE BUILDERS
   ============================================================ */
`;

export const GENERIC_TAIL = `
const STAGE_W = 1280, STAGE_H = 720;
const NODE_W = 108, NODE_H = 61;
const NS = NODE_W / STAGE_W;

const GROUP_X = [75, 216, 357, 499, 640, 782, 923, 1065, 1206];
const nodePos = new Array(NODE_META.length);

CLUSTERS.forEach((c, ci) => {
  const n = c.slides.length;
  const dy = 88;
  c.x = GROUP_X[ci];
  c.spanTop = 360 - ((n-1)/2)*dy - NODE_H/2 - 24;
  c.spanBot = 360 + ((n-1)/2)*dy + NODE_H/2 + 24;
  c.slides.forEach((slideIdx, i) => {
    const y = 360 + (i - (n-1)/2) * dy;
    nodePos[slideIdx] = {x:c.x, y, cluster:c};
  });
});

const graphChrome = document.getElementById('graph-chrome');

let lanesHtml = CLUSTERS.map((c,ci) => \`
  <div class="lane" data-cluster="\${ci}" style="left:\${c.x-68}px; width:136px; top:\${Math.max(46,c.spanTop)}px; bottom:\${720-Math.min(674,c.spanBot)}px; background:\${c.tint}; border-color:\${c.border};"></div>
  <div class="lane-label" data-cluster-label="\${ci}" style="top:\${Math.max(46,c.spanTop)-28}px; left:\${c.x-68}px; width:136px;">\${c.label}</div>
\`).join('');

let edgesSvg = \`<svg id="edges" viewBox="0 0 \${STAGE_W} \${STAGE_H}">\`;
for(let i=0;i<NODE_META.length-1;i++){
  const a = nodePos[i], b = nodePos[i+1];
  const cx1 = a.x + (b.x-a.x)*0.5, cx2 = a.x + (b.x-a.x)*0.5;
  const d = \`M \${a.x} \${a.y} C \${cx1} \${a.y}, \${cx2} \${b.y}, \${b.x} \${b.y}\`;
  edgesSvg += \`<path class="edge" d="\${d}"/><path class="edge-flow" d="\${d}" style="animation-delay:\${(i*0.18).toFixed(2)}s"/>\`;
}
edgesSvg += \`</svg>\`;

graphChrome.innerHTML = lanesHtml + edgesSvg + \`
  <div class="map-title">
    <div class="eyebrow">Présentation</div>
    <h2>Cliquez sur une étape pour l'ouvrir</h2>
  </div>
\`;

const MAIN_TOTAL = S.length;
const ALL_SLIDES = S.concat(QA_SLIDES);
const TOTAL = ALL_SLIDES.length;
const stage = document.getElementById('stage');
const pulseSvg = \`<svg viewBox="0 0 160 22" preserveAspectRatio="none"><path class="pulse-line" d="M0 11 H40 L48 2 L56 20 L64 11 H160"/></svg>\`;

const LIGHT_BG = ['#fdfafc','#fff8bb','#dac2e6'];
stage.insertAdjacentHTML('beforeend', ALL_SLIDES.map((s,idx)=>{
  const isHidden = idx >= MAIN_TOTAL;
  const pages = s.pages || [s.html];
  const pagesHtml = pages.map((p,pi)=>\`<div class="detail-page\${pi===0?' page-active':''}" data-page="\${pi}">\${p}</div>\`).join('');
  const pageDotsHtml = pages.length>1 ? \`<div class="page-dots">\${pages.map((_,pi)=>\`<div class="page-dot\${pi===0?' now':''}"></div>\`).join('')}</div>\` : '';
  let posStyle, nodeFaceHtml, slideBg;
  if(isHidden){
    posStyle = \`--nx:0px; --ny:0px; --ns:1;\`;
    nodeFaceHtml = '';
    slideBg = '#fdfafc';
  } else {
    const meta = NODE_META[idx];
    const pos = nodePos[idx];
    const ci = CLUSTERS.indexOf(pos.cluster);
    slideBg = LIGHT_BG[ci % LIGHT_BG.length];
    posStyle = \`--nx:\${pos.x-STAGE_W/2}px; --ny:\${pos.y-STAGE_H/2}px; --ns:\${NS}; --accent:\${pos.cluster.color};\`;
    nodeFaceHtml = \`
    <div class="node-face">
      <div class="node-num">\${String(idx+1).padStart(2,'0')}</div>
      <div class="node-ic">\${ICONS[meta.icon]||''}</div>
      <div class="node-lbl">\${meta.label}</div>
    </div>\`;
  }
  return \`
  <section class="slide \${s.cls}\${isHidden?' hidden-node':''}" data-index="\${idx}" style="\${posStyle} --slide-bg:\${slideBg};">
    \${nodeFaceHtml}
    <div class="detail-content">
      <div class="pages-wrap">\${pagesHtml}</div>
      \${pageDotsHtml}
      <div class="pulse-wrap">\${pulseSvg}</div>
      <div class="chrome-footer"><span>Présentation</span></div>
    </div>
  </section>
  \`;
}).join(''));

const slideEls = Array.from(document.querySelectorAll('.slide'));

function fitFlowBoxes(){
  document.querySelectorAll('.flow-box-inner').forEach(box=>{
    const wrap = box.parentElement;
    const maxW = wrap.clientWidth;
    if(!maxW) return;
    box.style.width = maxW + 'px';
    const targetH = box.scrollHeight;
    let lo = 60, hi = maxW;
    for(let i=0;i<16;i++){
      const mid = (lo+hi)/2;
      box.style.width = mid + 'px';
      if(box.scrollHeight <= targetH) hi = mid; else lo = mid;
    }
    box.style.width = Math.ceil(hi) + 'px';
  });
}
requestAnimationFrame(fitFlowBoxes);
if(document.fonts && document.fonts.ready){ document.fonts.ready.then(fitFlowBoxes); }

const dotsWrap = document.getElementById('ui-dots');
dotsWrap.innerHTML = S.map((_,i)=>\`<div class="ui-dot" data-i="\${i}"></div>\`).join('');
const dotEls = Array.from(dotsWrap.children);

let current = null;
let subPage = 0;
let wfInterval = null;

function pageCount(idx){
  const s = ALL_SLIDES[idx];
  return (s && s.pages) ? s.pages.length : 1;
}
function showPage(slideEl, pi){
  Array.from(slideEl.querySelectorAll('.detail-page')).forEach((p,i)=> p.classList.toggle('page-active', i===pi));
  Array.from(slideEl.querySelectorAll('.page-dot')).forEach((d,i)=> d.classList.toggle('now', i===pi));
}

function startWorkflowCycle(slideEl){
  const steps = Array.from(slideEl.querySelectorAll('.cycle-step'));
  if(!steps.length) return;
  let i = 0;
  steps.forEach(s=>s.classList.remove('cycle-active'));
  steps[0].classList.add('cycle-active');
  wfInterval = setInterval(()=>{
    steps[i].classList.remove('cycle-active');
    i = (i+1) % steps.length;
    steps[i].classList.add('cycle-active');
  }, 1300);
}
function stopWorkflowCycle(){
  if(wfInterval){ clearInterval(wfInterval); wfInterval = null; }
}

function playSlideVideos(el){
  el.querySelectorAll('video.slide-video').forEach(v=>{
    v.currentTime = 0;
    v._playTimer = setTimeout(()=> v.play().catch(()=>{}), 1000);
  });
}
function stopSlideVideos(el){
  el.querySelectorAll('video.slide-video').forEach(v=>{
    if(v._playTimer){ clearTimeout(v._playTimer); v._playTimer = null; }
    v.pause();
  });
}

function shineLane(idx){
  document.querySelectorAll('.lane-shine').forEach(el=>el.classList.remove('lane-shine'));
  document.querySelectorAll('.lane-label-shine').forEach(el=>el.classList.remove('lane-label-shine'));
  const ci = CLUSTERS.findIndex(c=>c.slides.includes(idx));
  if(ci===-1) return;
  const lane = document.querySelector(\`.lane[data-cluster="\${ci}"]\`);
  const label = document.querySelector(\`.lane-label[data-cluster-label="\${ci}"]\`);
  if(lane) lane.classList.add('lane-shine');
  if(label) label.classList.add('lane-label-shine');
}

function enterDetail(idx){
  idx = Math.max(0, Math.min(TOTAL-1, idx));
  const prevEl = current!==null ? slideEls[current] : null;
  if(prevEl){ prevEl.classList.remove('active','content-in'); stopSlideVideos(prevEl); }
  stopWorkflowCycle();

  const newEl = slideEls[idx];
  newEl.classList.add('active');
  stage.classList.add('is-detail');
  shineLane(idx);
  document.body.classList.add('in-detail');

  subPage = 0;
  showPage(newEl, 0);

  requestAnimationFrame(()=>{
    requestAnimationFrame(()=> newEl.classList.add('content-in'));
  });

  if(newEl.querySelector('.cycle-step')){
    setTimeout(()=> startWorkflowCycle(newEl), 550);
  }
  playSlideVideos(newEl);

  current = idx;
  updateChrome();
}

function backToMap(){
  if(current===null) return;
  const el = slideEls[current];
  el.classList.remove('active','content-in');
  stopWorkflowCycle();
  stopSlideVideos(el);
  stage.classList.remove('is-detail');
  document.body.classList.remove('in-detail');
  current = null;
  hideChapterCard();
  updateChrome();
}

function clusterOf(idx){
  return CLUSTERS.find(c=>c.slides.includes(idx)) || null;
}

const chapterCardEl = document.getElementById('chapterCard');
function showChapterCard(label, color){
  chapterCardEl.style.setProperty('--chapter-color', color || 'var(--teal)');
  chapterCardEl.querySelector('.chapter-name').textContent = label;
  chapterCardEl.classList.add('show');
}
function hideChapterCard(){
  chapterCardEl.classList.remove('show');
}

let mapTransitTimer = null;
function goViaMap(targetIdx){
  targetIdx = Math.max(0, Math.min(TOTAL-1, targetIdx));
  if(current===null){ enterDetail(targetIdx); return; }
  if(targetIdx===current) return;
  if(mapTransitTimer){ clearTimeout(mapTransitTimer); mapTransitTimer = null; }
  hideChapterCard();
  if(current >= MAIN_TOTAL && targetIdx >= MAIN_TOTAL){
    enterDetail(targetIdx);
    return;
  }
  const fromCluster = current < MAIN_TOTAL ? clusterOf(current) : null;
  const toCluster = targetIdx < MAIN_TOTAL ? clusterOf(targetIdx) : null;
  const crossingCluster = fromCluster && toCluster && fromCluster.key !== toCluster.key;

  backToMap();
  if(crossingCluster){
    mapTransitTimer = setTimeout(()=>{
      showChapterCard(toCluster.label, toCluster.color);
      mapTransitTimer = setTimeout(()=>{
        hideChapterCard();
        mapTransitTimer = setTimeout(()=> enterDetail(targetIdx), 400);
      }, 1300);
    }, 700);
  } else {
    mapTransitTimer = setTimeout(()=> enterDetail(targetIdx), 700);
  }
}

function updateChrome(){
  if(current===null){
    document.getElementById('ui-progress').style.width = '0%';
    return;
  }
  if(current < MAIN_TOTAL){
    document.getElementById('ui-progress').style.width = ((current+1)/MAIN_TOTAL*100)+'%';
    document.getElementById('ui-counter').textContent = String(current+1).padStart(2,'0')+' / '+MAIN_TOTAL;
  } else {
    document.getElementById('ui-progress').style.width = '100%';
    document.getElementById('ui-counter').textContent = 'Q&R';
  }
  dotEls.forEach((d,i)=>{
    d.classList.toggle('now', i===current);
    d.classList.toggle('done', i<current);
  });
}

slideEls.forEach((el,idx)=>{
  el.addEventListener('click', (e)=>{
    if(el.classList.contains('active')) return;
    enterDetail(idx);
  });
});

function goNext(){
  if(current===null){ enterDetail(0); return; }
  if(subPage < pageCount(current)-1){
    subPage++;
    showPage(slideEls[current], subPage);
    return;
  }
  goViaMap(current+1);
}
function goPrev(){
  if(current===null) return;
  if(subPage > 0){
    subPage--;
    showPage(slideEls[current], subPage);
    return;
  }
  goViaMap(current-1);
}

document.getElementById('mapBtn').addEventListener('click', ()=>{
  if(mapTransitTimer){ clearTimeout(mapTransitTimer); mapTransitTimer=null; }
  hideChapterCard();
  backToMap();
});
document.getElementById('nextBtn').addEventListener('click', goNext);
document.getElementById('prevBtn').addEventListener('click', goPrev);
dotEls.forEach((d,i)=> d.addEventListener('click', ()=> enterDetail(i)));

window.addEventListener('keydown', e=>{
  if(['ArrowRight','PageDown',' '].includes(e.key)){
    e.preventDefault();
    goNext();
  } else if(['ArrowLeft','PageUp'].includes(e.key)){
    e.preventDefault();
    goPrev();
  } else if(e.key==='Escape'){ if(mapTransitTimer){ clearTimeout(mapTransitTimer); mapTransitTimer=null; } hideChapterCard(); backToMap(); }
  else if(e.key==='Home'){ goViaMap(0); }
  else if(e.key==='End'){ goViaMap(TOTAL-1); }
  else if(e.key.toLowerCase()==='f'){ toggleFullscreen(); }
});

let touchX = null;
document.addEventListener('touchstart', e=> touchX = e.touches[0].clientX);
document.addEventListener('touchend', e=>{
  if(touchX===null || current===null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if(Math.abs(dx) > 50){ if(dx<0) goNext(); else goPrev(); }
  touchX = null;
});

function toggleFullscreen(){
  if(!document.fullscreenElement){ document.documentElement.requestFullscreen().catch(()=>{}); }
  else{ document.exitFullscreen(); }
}

function resize(){
  const scale = Math.min(window.innerWidth/1280, window.innerHeight/720);
  stage.style.transform = \`translate(-50%,-50%) scale(\${scale})\`;
}
window.addEventListener('resize', resize);
resize();
</script>
</body>
</html>`;

// The editor's canvas renders slide HTML inside a sandboxed iframe styled
// with the deck's own <style> block. A deck imported from a real file has
// one; a brand-new blank deck doesn't have a source file to pull it from,
// so it reuses this same block (sliced out of GENERIC_HEAD above) instead
// of duplicating the stylesheet a second time.
export const GENERIC_STYLE_BLOCK = GENERIC_HEAD.match(/<style>([\s\S]*?)<\/style>/)[1];
