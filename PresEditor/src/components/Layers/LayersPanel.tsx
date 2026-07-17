import { useEditor } from '../../state/EditorContext';
import { EI } from '../../lib/icons';
import { usePersistedBool } from '../../lib/usePersistedBool';
import type { SceneObject } from '../../types/scene';
import type { Slide } from '../../types/state';

function Icon({ name }: { name: string }) {
  return <span dangerouslySetInnerHTML={{ __html: (EI as Record<string, string>)[name] }} />;
}

const TYPE_ICON: Partial<Record<SceneObject['type'], string>> = {
  text: 'type',
  shape: 'square',
  icon: 'star',
  image: 'img',
  'component-instance': 'puzzle',
  'legacy-html': 'layers',
  'diagram-node': 'diagramNode',
  connector: 'connector',
  chart: 'barChart',
  table: 'table',
};

// `slidesById` resolves a component-instance's display name from the
// component's own slide (its nodeLabel — see Sidebar's "Composants"
// section) rather than showing the raw object type string.
function objectLabel(obj: SceneObject, slidesById: Record<string, Slide>): string {
  if (obj.name) return obj.name;
  if (obj.type === 'legacy-html') return 'Contenu importé';
  if (obj.type === 'text') {
    const tmp = document.createElement('div');
    tmp.innerHTML = obj.data.html || '';
    const text = tmp.textContent?.trim();
    return text ? text.slice(0, 28) : 'Texte';
  }
  if (obj.type === 'component-instance') return slidesById[obj.data.componentSlideId]?.nodeLabel || 'Composant';
  if (obj.type === 'shape') return obj.data.shape === 'ellipse' ? 'Ellipse' : 'Rectangle';
  if (obj.type === 'icon') return `Icône (${obj.data.icon})`;
  if (obj.type === 'image') return 'Image';
  if (obj.type === 'diagram-node') return obj.data.label || 'Nœud';
  if (obj.type === 'connector') return 'Connecteur';
  if (obj.type === 'chart') return obj.data.title || `Graphique (${obj.data.kind})`;
  if (obj.type === 'table') return 'Tableau';
  // Unreachable with today's exhaustively-handled union, but kept as a
  // graceful fallback label for object types added in later milestones
  // that don't get their own case here yet (same TS narrowing note as
  // ObjectInspector's similar fallback).
  return (obj as SceneObject).type;
}

// Flat per-scene object list. Front-most object listed first, matching the
// convention most design tools use. Milestone 2: shift/ctrl-click extends
// the selection, and clicking any member of a group selects the whole
// group — mirroring the canvas's own click behavior (see sceneEditing.ts)
// so the two selection surfaces never disagree.
export default function LayersPanel() {
  const { state, actions } = useEditor();
  const slide = state.selectedSlideId ? state.slidesById[state.selectedSlideId] : null;
  const scene = slide ? state.scenesById[slide.pages[state.selectedPage] ?? slide.pages[0]] : null;
  // Milestone C (editor usability overhaul): Calques and Propriétés were
  // two fixed, always-full-height zones (a `flex:1` list above a
  // `flex:none` inspector) even when one of them had nothing to show —
  // this makes the list itself a collapsible section, same remembered-state
  // pattern as the sidebar/right-panel toggles in App.jsx.
  const [collapsed, toggleCollapsed] = usePersistedBool('ed-layers-collapsed', false);

  if (!scene) {
    return (
      <div className="ed-layers">
        <div className="ed-layers-head">Calques</div>
        <div className="ed-layers-empty">Aucune diapositive sélectionnée.</div>
      </div>
    );
  }

  const selectedIds = state.selection?.sceneId === scene.id ? state.selection.objectIds : [];
  const selectedIdSet = new Set(selectedIds);
  const orderedIds = scene.objectOrder.slice().reverse();

  function groupMembers(id: string): string[] {
    const obj = scene!.objectsById[id];
    if (!obj?.groupId) return [id];
    return scene!.objectOrder.filter((oid) => scene!.objectsById[oid]?.groupId === obj.groupId);
  }

  function handleRowClick(id: string, e: React.MouseEvent) {
    const members = groupMembers(id);
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      const allSelected = members.every((m) => selectedIdSet.has(m));
      const next = allSelected ? selectedIds.filter((s) => !members.includes(s)) : Array.from(new Set([...selectedIds, ...members]));
      actions.setSelection(scene!.id, next);
    } else {
      actions.setSelection(scene!.id, members);
    }
  }

  return (
    <div className={`ed-layers${collapsed ? ' collapsed' : ''}`}>
      <button className="ed-layers-head" onClick={toggleCollapsed} title={collapsed ? 'Développer les calques' : 'Réduire les calques'}>
        <Icon name="chevron" /> Calques
      </button>
      {!collapsed && (
      <ul className="ed-layers-list">
        {orderedIds.map((id) => {
          const obj = scene.objectsById[id];
          if (!obj) return null;
          return (
            <li
              key={id}
              className={`ed-layer-row${selectedIdSet.has(id) ? ' selected' : ''}${obj.groupId ? ' grouped' : ''}`}
              onClick={(e) => handleRowClick(id, e)}
            >
              <span className="ed-layer-type">
                <Icon name={TYPE_ICON[obj.type] || 'layers'} />
              </span>
              <span className="ed-layer-label">{objectLabel(obj, state.slidesById)}</span>
              {obj.groupId && (
                <span className="ed-layer-group-mark" title="Fait partie d'un groupe">
                  <Icon name="group" />
                </span>
              )}
              <span className="ed-layer-actions">
                {(obj.type === 'legacy-html' || obj.type === 'text') && (
                  <button
                    className="ed-icon-btn"
                    title="Détacher en objets modifiables (titre, texte, image… séparément) — chaque pièce devient son propre calque"
                    onClick={(e) => {
                      e.stopPropagation();
                      actions.detachObject(scene.id, id);
                    }}
                  >
                    <Icon name="detach" />
                  </button>
                )}
                <button
                  className="ed-icon-btn"
                  title={obj.hidden ? 'Afficher' : 'Masquer'}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.updateObjectTransform(scene.id, id, { hidden: !obj.hidden } as any);
                  }}
                >
                  <Icon name={obj.hidden ? 'eyeOff' : 'eye'} />
                </button>
                <button
                  className="ed-icon-btn"
                  title={obj.locked ? 'Déverrouiller' : 'Verrouiller'}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.updateObjectTransform(scene.id, id, { locked: !obj.locked } as any);
                  }}
                >
                  <Icon name={obj.locked ? 'lock' : 'unlock'} />
                </button>
                <button
                  className="ed-icon-btn"
                  title="Dupliquer"
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.duplicateObject(scene.id, id);
                  }}
                >
                  <Icon name="copy" />
                </button>
                <button
                  className="ed-icon-btn danger"
                  title="Supprimer"
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.deleteObject(scene.id, id);
                  }}
                >
                  <Icon name="trash" />
                </button>
              </span>
            </li>
          );
        })}
        {orderedIds.length === 0 && <li className="ed-layers-empty">Aucun objet.</li>}
      </ul>
      )}
    </div>
  );
}
