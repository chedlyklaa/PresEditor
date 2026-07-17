import { EI } from './icons';

// Blank-slide templates offered in the "Add slide" layout picker. They reuse
// the exact CSS classes defined in the source presentation's stylesheet
// (.pad, .eyebrow, .title, .lede, .card, .grid.g2, .shot-placeholder) so a
// new slide looks native next to the hand-authored ones instead of
// introducing a second visual language.
export const LAYOUTS = {
  blank: {
    label: 'Vierge',
    desc: 'Une diapositive vide avec un titre à personnaliser.',
    icon: 'type',
    cls: 'slide-light',
    nodeIcon: 'clipboard',
    html: `<div class="pad"><div class="eyebrow eyebrow-light">RUBRIQUE</div><h1 class="title title-light">Nouveau titre</h1><div class="lede">Cliquez sur ce texte pour le modifier.</div></div>`,
  },
  title: {
    label: 'Titre',
    desc: 'Grande page de titre sur fond sombre.',
    icon: 'type',
    cls: 'slide-dark',
    nodeIcon: 'sitemap',
    html: `<div class="pad"><div class="eyebrow eyebrow-dark">SOUS-TITRE</div><h1 style="font-family:var(--display);font-weight:900;font-size:60px;color:#fff;line-height:1;margin:10px 0 18px;">Titre de la diapositive</h1><div class="lede lede-dark" style="font-size:16px;font-style:italic;max-width:640px;">Description ou accroche à modifier.</div></div>`,
  },
  section: {
    label: 'Section',
    desc: 'Page de rupture centrée pour ouvrir une partie.',
    icon: 'layers',
    cls: 'slide-light',
    nodeIcon: 'route',
    html: `<div class="pad" style="align-items:center; text-align:center; justify-content:center;"><div class="eyebrow eyebrow-light">SECTION</div><h1 class="title title-light" style="font-size:46px;">Titre de section</h1></div>`,
  },
  content: {
    label: 'Contenu à puces',
    desc: 'Titre, paragraphe et une liste à puces.',
    icon: 'list',
    cls: 'slide-light',
    nodeIcon: 'clipboard',
    html: `<div class="pad"><div class="eyebrow eyebrow-light">RUBRIQUE</div><h1 class="title title-light">Titre du contenu</h1><div class="lede" style="margin-top:14px; max-width:820px;">Paragraphe d'introduction à modifier.</div><ul style="margin-top:20px; padding-left:20px;"><li style="font-size:14px; color:var(--ink); margin-bottom:10px; line-height:1.5;">Premier point clé</li><li style="font-size:14px; color:var(--ink); margin-bottom:10px; line-height:1.5;">Deuxième point clé</li><li style="font-size:14px; color:var(--ink); margin-bottom:10px; line-height:1.5;">Troisième point clé</li></ul></div>`,
  },
  twocol: {
    label: 'Deux colonnes',
    desc: 'Deux cartes côte à côte pour comparer.',
    icon: 'cols',
    cls: 'slide-light',
    nodeIcon: 'chart',
    html: `<div class="pad"><div class="eyebrow eyebrow-light">RUBRIQUE</div><h1 class="title title-light">Comparaison</h1><div class="grid g2" style="margin-top:24px;"><div class="card"><div style="font-family:var(--display); font-weight:700; font-size:15px; color:var(--ink); margin-bottom:8px;">Colonne A</div><div class="lede" style="font-size:12.5px;">Contenu de la première colonne.</div></div><div class="card"><div style="font-family:var(--display); font-weight:700; font-size:15px; color:var(--ink); margin-bottom:8px;">Colonne B</div><div class="lede" style="font-size:12.5px;">Contenu de la deuxième colonne.</div></div></div></div>`,
  },
  image: {
    label: 'Image',
    desc: 'Titre, légende et un emplacement image cliquable.',
    icon: 'img',
    cls: 'slide-light',
    nodeIcon: 'camera',
    html: `<div class="pad"><div class="eyebrow eyebrow-light">RUBRIQUE</div><h1 class="title title-light">Capture d'écran</h1><div class="lede" style="margin:10px 0 18px;">Légende ou description de l'image ci-dessous.</div><div class="shot-placeholder" data-image-slot="1" style="height:360px; cursor:pointer;"><div class="shot-ic">${EI.camera}</div><div class="shot-lbl">Capture d'écran</div><div class="shot-sub">Cliquez pour ajouter une image</div></div></div>`,
  },
};

export function createSlideFromLayout(layoutKey) {
  const t = LAYOUTS[layoutKey] || LAYOUTS.blank;
  return {
    cls: t.cls,
    pages: [t.html],
    notes: '',
    nodeIcon: t.nodeIcon,
    nodeLabel: t.label,
  };
}
