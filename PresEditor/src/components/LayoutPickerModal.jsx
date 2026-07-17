import { useEffect } from 'react';
import { useEditor } from '../state/EditorContext';
import { EI } from '../lib/icons';
import { LAYOUTS } from '../lib/layouts';

function Icon({ name }) {
  return <span dangerouslySetInnerHTML={{ __html: EI[name] }} />;
}

export default function LayoutPickerModal({ targetSectionId, onClose }) {
  const { actions } = useEditor();

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function pick(layoutKey) {
    actions.addSlide(layoutKey, targetSectionId, null);
    onClose();
  }

  return (
    <div className="ed-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ed-modal">
        <button className="ed-modal-close" onClick={onClose} aria-label="Fermer">
          <Icon name="x" />
        </button>
        <h3>Ajouter une diapositive</h3>
        {Object.entries(LAYOUTS).map(([key, t]) => (
          <button key={key} className="ed-layout-opt" onClick={() => pick(key)}>
            <span className="ed-ic">
              <Icon name={t.icon} />
            </span>
            <span>
              <span className="ed-lo-title">{t.label}</span>
              <span className="ed-lo-desc">{t.desc}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
