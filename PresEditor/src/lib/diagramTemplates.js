import { createDiagramNodeObject, createConnectorObject } from '../scene/objectDefaults';
import { layoutRow, layoutTimeline, layoutLayered, layoutCycle, layoutRadial, layoutSwimlane, toTopLeft } from './diagramLayout';

// Starter diagrams (Milestone 6, expanded in the v2 diagram-builder
// milestone) — each `build()` returns a fresh list of diagram-node +
// connector objects (nodes first, so connectors paint on top of them once
// inserted) with brand-new ids every call, since two inserts of the same
// template on the same slide must never collide.
//
// Every template is built the same two-step way: describe nodes by a local
// string key (shape/label/optional size) and edges by (fromKey, toKey,
// optional label), run the keys through one of lib/diagramLayout.ts's pure
// layout functions to get positions, then materialize real objects via
// buildFromLayout() below — layout math lives in exactly one place, shared
// with ObjectInspector.tsx's "Disposition automatique" re-layout action.
const DEFAULT_SIZE = { width: 200, height: 90 };

function buildFromLayout(defs, edgeDefs, points) {
  const byKey = {};
  const nodes = points.map((p) => {
    const def = defs[p.id];
    const width = def.width ?? DEFAULT_SIZE.width;
    const height = def.height ?? DEFAULT_SIZE.height;
    const { x, y } = toTopLeft(p, width, height);
    const node = createDiagramNodeObject({ x, y, width, height, data: { shape: def.shape, label: def.label } });
    byKey[p.id] = node;
    return node;
  });
  const connectors = edgeDefs.map((e) => {
    const conn = createConnectorObject(byKey[e.from].id, byKey[e.to].id);
    return e.label ? { ...conn, data: { ...conn.data, label: e.label } } : conn;
  });
  return [...nodes, ...connectors];
}

export const DIAGRAM_TEMPLATES = {
  flowchart: {
    label: 'Organigramme',
    desc: 'Départ, analyse, décision, boucle de correction.',
    icon: 'route',
    build() {
      const defs = {
        depart: { shape: 'rect', label: 'Départ' },
        analyser: { shape: 'rect', label: 'Analyser' },
        decision: { shape: 'diamond', label: 'Conforme ?', width: 180, height: 110 },
        valider: { shape: 'rect', label: 'Valider' },
        termine: { shape: 'ellipse', label: 'Terminé', width: 180 },
        corriger: { shape: 'rect', label: 'Corriger' },
      };
      const edges = [
        { from: 'depart', to: 'analyser' },
        { from: 'analyser', to: 'decision' },
        { from: 'decision', to: 'valider', label: 'Oui' },
        { from: 'valider', to: 'termine' },
        { from: 'decision', to: 'corriger', label: 'Non' },
        { from: 'corriger', to: 'analyser' },
      ];
      const points = layoutLayered(Object.keys(defs), edges, { direction: 'horizontal' });
      return buildFromLayout(defs, edges, points);
    },
  },

  pipeline: {
    label: 'Pipeline simple',
    desc: 'Quatre étapes en ligne, de l’entrée à la sortie.',
    icon: 'sitemap',
    build() {
      const keys = ['entree', 'traitement', 'validation', 'sortie'];
      const labels = ['Entrée', 'Traitement', 'Validation', 'Sortie'];
      const defs = {};
      keys.forEach((k, i) => (defs[k] = { shape: 'rect', label: labels[i] }));
      const edges = keys.slice(0, -1).map((k, i) => ({ from: k, to: keys[i + 1] }));
      const points = layoutRow(keys);
      return buildFromLayout(defs, edges, points);
    },
  },

  orgChart: {
    label: 'Organigramme hiérarchique',
    desc: 'Direction, trois équipes, deux rapports directs.',
    icon: 'building',
    build() {
      const defs = {
        direction: { shape: 'rect', label: 'Direction' },
        ventes: { shape: 'rect', label: 'Ventes' },
        ingenierie: { shape: 'rect', label: 'Ingénierie' },
        marketing: { shape: 'rect', label: 'Marketing' },
        backend: { shape: 'rect', label: 'Backend' },
        frontend: { shape: 'rect', label: 'Frontend' },
      };
      const edges = [
        { from: 'direction', to: 'ventes' },
        { from: 'direction', to: 'ingenierie' },
        { from: 'direction', to: 'marketing' },
        { from: 'ingenierie', to: 'backend' },
        { from: 'ingenierie', to: 'frontend' },
      ];
      const points = layoutLayered(Object.keys(defs), edges, { direction: 'vertical' });
      return buildFromLayout(defs, edges, points);
    },
  },

  timeline: {
    label: 'Chronologie',
    desc: 'Cinq jalons en zigzag, de gauche à droite.',
    icon: 'route',
    build() {
      const keys = ['j1', 'j2', 'j3', 'j4', 'j5'];
      const labels = ['Lancement', 'Conception', 'Développement', 'Tests', 'Livraison'];
      const defs = {};
      keys.forEach((k, i) => (defs[k] = { shape: 'ellipse', label: labels[i], width: 170, height: 80 }));
      const edges = keys.slice(0, -1).map((k, i) => ({ from: k, to: keys[i + 1] }));
      const points = layoutTimeline(keys);
      return buildFromLayout(defs, edges, points);
    },
  },

  cycle: {
    label: 'Cycle',
    desc: 'Processus répétitif en boucle fermée.',
    icon: 'sync',
    build() {
      const keys = ['planifier', 'construire', 'tester', 'deployer', 'surveiller'];
      const labels = ['Planifier', 'Construire', 'Tester', 'Déployer', 'Surveiller'];
      const defs = {};
      keys.forEach((k, i) => (defs[k] = { shape: 'ellipse', label: labels[i], width: 170, height: 90 }));
      const edges = keys.map((k, i) => ({ from: k, to: keys[(i + 1) % keys.length] }));
      const points = layoutCycle(keys);
      return buildFromLayout(defs, edges, points);
    },
  },

  mindMap: {
    label: 'Carte mentale',
    desc: 'Un thème central et ses branches.',
    icon: 'sitemap',
    build() {
      const defs = {
        centre: { shape: 'ellipse', label: 'Thème central', width: 200, height: 100 },
        b1: { shape: 'rect', label: 'Idée 1', width: 160 },
        b2: { shape: 'rect', label: 'Idée 2', width: 160 },
        b3: { shape: 'rect', label: 'Idée 3', width: 160 },
        b4: { shape: 'rect', label: 'Idée 4', width: 160 },
        b5: { shape: 'rect', label: 'Idée 5', width: 160 },
      };
      const spokes = ['b1', 'b2', 'b3', 'b4', 'b5'];
      const edges = spokes.map((k) => ({ from: 'centre', to: k }));
      const points = layoutRadial('centre', spokes);
      return buildFromLayout(defs, edges, points);
    },
  },

  layeredArchitecture: {
    label: 'Architecture en couches',
    desc: 'Présentation, métier et données, empilées.',
    icon: 'server',
    build() {
      const defs = {
        ui: { shape: 'rect', label: 'Présentation', width: 420 },
        api: { shape: 'rect', label: 'API' },
        logique: { shape: 'rect', label: 'Logique métier' },
        donnees: { shape: 'rect', label: 'Données', width: 420 },
      };
      const lanes = [['ui'], ['api', 'logique'], ['donnees']];
      const edges = [
        { from: 'ui', to: 'api' },
        { from: 'ui', to: 'logique' },
        { from: 'api', to: 'donnees' },
        { from: 'logique', to: 'donnees' },
      ];
      const points = layoutSwimlane(lanes);
      return buildFromLayout(defs, edges, points);
    },
  },

  decisionTree: {
    label: 'Arbre de décision',
    desc: 'Une question racine, deux niveaux de branches.',
    icon: 'route',
    build() {
      const defs = {
        racine: { shape: 'diamond', label: 'Budget > 10k€ ?', width: 200, height: 110 },
        oui: { shape: 'diamond', label: 'Urgent ?', width: 180, height: 100 },
        non: { shape: 'rect', label: 'Validation simple' },
        ouiOui: { shape: 'rect', label: 'Approbation direction' },
        ouiNon: { shape: 'rect', label: 'Planifier au budget' },
      };
      const edges = [
        { from: 'racine', to: 'oui', label: 'Oui' },
        { from: 'racine', to: 'non', label: 'Non' },
        { from: 'oui', to: 'ouiOui', label: 'Oui' },
        { from: 'oui', to: 'ouiNon', label: 'Non' },
      ];
      const points = layoutLayered(Object.keys(defs), edges, { direction: 'vertical' });
      return buildFromLayout(defs, edges, points);
    },
  },

  swimlane: {
    label: 'Couloirs (swimlane)',
    desc: 'Trois acteurs, une séquence d’échanges.',
    icon: 'layers',
    build() {
      const defs = {
        c1: { shape: 'rect', label: 'Demande', width: 180 },
        c2: { shape: 'rect', label: 'Confirmation', width: 180 },
        f1: { shape: 'rect', label: 'Requête API', width: 180 },
        b1: { shape: 'rect', label: 'Traitement', width: 180 },
        b2: { shape: 'rect', label: 'Réponse', width: 180 },
      };
      const lanes = [
        ['c1', 'c2'],
        ['f1'],
        ['b1', 'b2'],
      ];
      const edges = [
        { from: 'c1', to: 'f1' },
        { from: 'f1', to: 'b1' },
        { from: 'b1', to: 'b2' },
        { from: 'b2', to: 'c2' },
      ];
      const points = layoutSwimlane(lanes);
      return buildFromLayout(defs, edges, points);
    },
  },

  agentLoop: {
    label: 'Boucle agent K8s',
    desc: 'Observer, décider, agir — en boucle sur un cluster.',
    icon: 'sync',
    build() {
      const defs = {
        observer: { shape: 'rect', label: 'Observer' },
        decider: { shape: 'diamond', label: 'Décider', height: 110 },
        agir: { shape: 'rect', label: 'Agir' },
        cluster: { shape: 'ellipse', label: 'Cluster K8s', width: 220, height: 100 },
      };
      const edges = [
        { from: 'observer', to: 'decider' },
        { from: 'decider', to: 'agir' },
        { from: 'agir', to: 'observer' },
        { from: 'cluster', to: 'observer' },
        { from: 'agir', to: 'cluster' },
      ];
      const points = layoutCycle(['observer', 'decider', 'agir', 'cluster'], { radius: 220 });
      return buildFromLayout(defs, edges, points);
    },
  },
};
