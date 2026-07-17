import { useEditor } from '../../state/EditorContext';
import { findLocation } from '../../state/reducer';
import { EI } from '../../lib/icons';
import Menu from '../Menu';

function Icon({ name }) {
  return <span dangerouslySetInnerHTML={{ __html: EI[name] }} />;
}

// Milestone B (editor usability overhaul): rebuilt into one compact
// icon-only "Insérer" row (was 13 text-labeled buttons wrapping onto two
// rows) plus a visually-separated slide-actions cluster pushed to the far
// right via `.ed-spacer` — "Supprimer ce modèle"/"Supprimer ce composant"
// live there now, never adjacent to an insert button. "Modèles de
// diagramme…" and "Mode diagramme" (two separate controls before) are one
// Menu trigger now (see the mapping table's row 24).
export default function CanvasToolbar({
  slide,
  onInsertMedia,
  onAddText,
  onAddShape,
  onAddIcon,
  onAddPhoto,
  onInsertComponent,
  onAddDiagramNode,
  onConnectSelection,
  onOpenDiagramGallery,
  diagramMode,
  onToggleDiagramMode,
  onAddChart,
  onAddTable,
}) {
  const { state, actions } = useEditor();
  const isMaster = state.masterSlideIds.includes(slide.id);
  const isComponent = state.componentSlideIds.includes(slide.id);
  const loc = !isMaster && !isComponent ? findLocation(state, slide.id) : null;
  let ownerLabel = 'Q&R (masqué)';
  if (isMaster) ownerLabel = 'Modèle';
  else if (isComponent) ownerLabel = 'Composant';
  else if (loc?.kind === 'section') ownerLabel = state.sections.find((s) => s.id === loc.sectionId)?.label;
  const canConnect = state.selection?.objectIds?.length === 2;

  return (
    <div className="ed-canvas-toolbar">
      {slide.pages.length > 1 && (
        <div className="ed-page-tabs">
          {slide.pages.map((_, i) => (
            <button
              key={i}
              className={`ed-page-tab${i === state.selectedPage ? ' active' : ''}`}
              onClick={() => actions.selectPage(i)}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}
      <button className="ed-btn ed-icon-btn" title="Ajouter une page à cette diapositive" onClick={() => actions.addPage(slide.id)}>
        <Icon name="plus" />
      </button>
      {slide.pages.length > 1 && (
        <button className="ed-btn ed-icon-btn" title="Supprimer cette page" onClick={() => actions.deletePage(slide.id, state.selectedPage)}>
          <Icon name="trash" />
        </button>
      )}
      <div className="ed-sep" />

      {/* ---- Insérer: one compact icon-only row, every button tooltipped ---- */}
      <button className="ed-btn ed-icon-btn" title="Insérer une image (glissez-la ensuite pour la positionner)" onClick={() => onInsertMedia('image')}>
        <Icon name="img" />
      </button>
      <button className="ed-btn ed-icon-btn" title="Insérer une vidéo (glissez-la ensuite pour la positionner)" onClick={() => onInsertMedia('video')}>
        <Icon name="video" />
      </button>
      <button className="ed-btn ed-icon-btn" title="Ajouter un objet texte (double-cliquez pour l'éditer)" onClick={onAddText}>
        <Icon name="type" />
      </button>
      <button className="ed-btn ed-icon-btn" title="Ajouter une forme (rectangle)" onClick={onAddShape}>
        <Icon name="square" />
      </button>
      <button className="ed-btn ed-icon-btn" title="Ajouter une icône (choix dans les propriétés)" onClick={onAddIcon}>
        <Icon name="star" />
      </button>
      <button className="ed-btn ed-icon-btn" title="Ajouter une photo comme objet indépendant" onClick={onAddPhoto}>
        <Icon name="camera" />
      </button>
      <button className="ed-btn ed-icon-btn" title="Ajouter un nœud de diagramme" onClick={onAddDiagramNode}>
        <Icon name="diagramNode" />
      </button>
      <button
        className="ed-btn ed-icon-btn"
        title={canConnect ? 'Relier les 2 objets sélectionnés' : 'Connecteur — sélectionnez exactement 2 objets à relier'}
        disabled={!canConnect}
        onClick={() => onConnectSelection(state.selection.objectIds[0], state.selection.objectIds[1])}
      >
        <Icon name="connector" />
      </button>
      <Menu
        trigger={({ open, toggle }) => (
          <button className={`ed-btn ed-icon-btn${open || diagramMode ? ' on' : ''}`} onClick={toggle} title="Diagramme">
            <Icon name="route" />
          </button>
        )}
      >
        <button onClick={onOpenDiagramGallery} title="Choisir un modèle de diagramme (aperçu en direct)">
          <Icon name="diagramNode" /> Modèles de diagramme…
        </button>
        <button onClick={onToggleDiagramMode} title="Double-cliquez sur le canevas vide pour ajouter un nœud">
          <Icon name="route" /> Mode diagramme{diagramMode ? ' (activé)' : ''}
        </button>
      </Menu>
      <Menu
        trigger={({ open, toggle }) => (
          <button className={`ed-btn ed-icon-btn${open ? ' on' : ''}`} onClick={toggle} title="Ajouter un graphique — choisissez son type">
            <Icon name="barChart" />
          </button>
        )}
      >
        <button onClick={() => onAddChart('bar')}>
          <Icon name="barChart" /> Barres
        </button>
        <button onClick={() => onAddChart('line')}>
          <Icon name="lineChart" /> Lignes
        </button>
        <button onClick={() => onAddChart('area')}>
          <Icon name="areaChart" /> Aire
        </button>
        <button onClick={() => onAddChart('pie')}>
          <Icon name="pieChart" /> Camembert
        </button>
        <button onClick={() => onAddChart('donut')}>
          <Icon name="donutChart" /> Anneau
        </button>
      </Menu>
      <button className="ed-btn ed-icon-btn" title="Ajouter un tableau" onClick={onAddTable}>
        <Icon name="table" />
      </button>
      {!isComponent && state.componentSlideIds.length > 0 && (
        <>
          <div className="ed-sep" />
          <select
            className="ed-select"
            title="Insérer un composant réutilisable"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) onInsertComponent(e.target.value);
              e.target.value = '';
            }}
          >
            <option value="" disabled>
              Insérer un composant…
            </option>
            {state.componentSlideIds.map((id) => (
              <option key={id} value={id}>
                {state.slidesById[id]?.nodeLabel || 'Composant'}
              </option>
            ))}
          </select>
        </>
      )}

      <div className="ed-spacer" />

      {/* ---- slide actions: visually separated, never mixed with insert icons ---- */}
      <span className="ed-canvas-owner">{ownerLabel}</span>
      <div className="ed-sep" />
      {!isMaster && !isComponent && (
        <>
          <button className="ed-btn ed-icon-btn" title="Dupliquer la diapositive (Ctrl/Cmd + D)" onClick={() => actions.duplicateSlide(slide.id)}>
            <Icon name="copy" />
          </button>
          <button className="ed-btn ed-icon-btn" title="Monter la diapositive" onClick={() => actions.moveSlide(slide.id, -1)}>
            <Icon name="arrowUp" />
          </button>
          <button className="ed-btn ed-icon-btn" title="Descendre la diapositive" onClick={() => actions.moveSlide(slide.id, 1)}>
            <Icon name="arrowDown" />
          </button>
          <button className="ed-btn danger" title="Supprimer cette diapositive" onClick={() => actions.deleteSlide(slide.id)}>
            <Icon name="trash" /> Supprimer
          </button>
        </>
      )}
      {isMaster && (
        <button className="ed-btn danger" title="Supprimer ce modèle de diapositive" onClick={() => actions.deleteMasterSlide(slide.id)}>
          <Icon name="trash" /> Supprimer ce modèle
        </button>
      )}
      {isComponent && (
        <button className="ed-btn danger" title="Supprimer ce composant réutilisable" onClick={() => actions.deleteComponent(slide.id)}>
          <Icon name="trash" /> Supprimer ce composant
        </button>
      )}
    </div>
  );
}
