import { useState } from 'react';
import { useEditor } from '../../state/EditorContext';
import { EI } from '../../lib/icons';
import { DragProvider } from './DragContext';
import SectionItem from './SectionItem';
import QaSection from './QaSection';
import SimpleSlideSection from './SimpleSlideSection';
import AssetLibrary from './AssetLibrary';
import LayoutPickerModal from '../LayoutPickerModal';
import SectionTemplatePickerModal from '../SectionTemplatePickerModal';

function Icon({ name }) {
  return <span dangerouslySetInnerHTML={{ __html: EI[name] }} />;
}

// Milestone C (editor usability overhaul): `collapsed`/`onToggleCollapse`
// come from App.jsx (remembered via usePersistedBool) — collapsing renders
// just the toggle rail below instead of the full section list, and the
// actual width change happens one level up, in `.ed-body`'s grid-template-
// columns, which ResizeObserver-driven fit-to-screen (useCanvasZoom.ts)
// already reacts to automatically.
export default function Sidebar({ collapsed, onToggleCollapse }) {
  const { state, actions } = useEditor();
  const [layoutPickerTarget, setLayoutPickerTarget] = useState(null);
  const [sectionTemplatePickerOpen, setSectionTemplatePickerOpen] = useState(false);

  if (collapsed) {
    return (
      <div className="ed-sidebar collapsed">
        <button className="ed-panel-toggle-btn" onClick={onToggleCollapse} title="Afficher le panneau des diapositives">
          <Icon name="chevron" />
        </button>
      </div>
    );
  }

  return (
    <DragProvider>
      <div className="ed-sidebar">
        <button className="ed-panel-toggle-btn ed-panel-toggle-btn-collapse" onClick={onToggleCollapse} title="Masquer le panneau des diapositives">
          <Icon name="chevron" />
        </button>
        {state.sections.map((section) => (
          <SectionItem key={section.id} section={section} onAddSlide={setLayoutPickerTarget} />
        ))}
        <QaSection onAddSlide={setLayoutPickerTarget} />
        <SimpleSlideSection
          icon="masterSlide"
          dotColor="var(--navy)"
          title="Modèles (en-tête / pied de page)"
          ids={state.masterSlideIds}
          addTitle="Ajouter un modèle"
          onAdd={actions.addMasterSlide}
          onDelete={actions.deleteMasterSlide}
          emptyLabel="Aucun modèle. Assignez-en un à une section ou à la présentation depuis le panneau Notes."
        />
        <SimpleSlideSection
          icon="puzzle"
          dotColor="var(--blue)"
          title="Composants réutilisables"
          ids={state.componentSlideIds}
          addTitle="Ajouter un composant"
          onAdd={actions.addComponent}
          onDelete={actions.deleteComponent}
          emptyLabel="Aucun composant. Créez-en un depuis la sélection sur une diapositive."
        />
        <AssetLibrary />
        <div className="ed-sidebar-section-actions">
          <button className="ed-add-section" onClick={actions.addSection}>
            <Icon name="plus" /> Nouvelle section
          </button>
          <button className="ed-add-section" onClick={() => setSectionTemplatePickerOpen(true)}>
            <Icon name="layers" /> Depuis un modèle
          </button>
        </div>
      </div>
      {layoutPickerTarget && (
        <LayoutPickerModal
          targetSectionId={layoutPickerTarget}
          onClose={() => setLayoutPickerTarget(null)}
        />
      )}
      {sectionTemplatePickerOpen && <SectionTemplatePickerModal onClose={() => setSectionTemplatePickerOpen(false)} />}
    </DragProvider>
  );
}
