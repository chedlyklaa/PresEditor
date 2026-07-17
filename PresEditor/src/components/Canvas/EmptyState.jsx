import { useEditor } from '../../state/EditorContext';
import { totalSlideCount } from '../../state/reducer';
import { EI } from '../../lib/icons';

function Icon({ name }) {
  return <span dangerouslySetInnerHTML={{ __html: EI[name] }} />;
}

export default function EmptyState({ onOpenLayoutPicker }) {
  const { state, actions } = useEditor();

  if (totalSlideCount(state) === 0) {
    return (
      <div className="ed-empty">
        <h2>Aucune diapositive</h2>
        <p>Créez une section puis ajoutez une diapositive, ou importez une présentation existante.</p>
        <div className="ed-empty-actions">
          {state.sections.length === 0 ? (
            <button className="ed-btn-lg primary" onClick={actions.addSection}>
              <Icon name="plus" /> Créer une section
            </button>
          ) : (
            <button className="ed-btn-lg primary" onClick={() => onOpenLayoutPicker(state.sections[0].id)}>
              <Icon name="plus" /> Ajouter une diapositive
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="ed-empty">
      <h2>Sélectionnez une diapositive</h2>
      <p>Choisissez une diapositive dans la barre latérale pour commencer à l'éditer.</p>
    </div>
  );
}
