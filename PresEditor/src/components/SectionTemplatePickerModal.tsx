import { useEffect } from 'react';
import { useEditor } from '../state/EditorContext';
import { EI } from '../lib/icons';
import { SECTION_TEMPLATES } from '../lib/sectionTemplates';

function Icon({ name }: { name: string }) {
  return <span dangerouslySetInnerHTML={{ __html: (EI as Record<string, string>)[name] }} />;
}

// Milestone 9: the section-level counterpart to LayoutPickerModal.jsx
// (which picks a single slide layout) — picking a template here inserts a
// whole ready-made section (several slides) in one action, via
// ADD_SECTION_FROM_TEMPLATE (state/reducer.ts, lib/sectionTemplates.ts).
export default function SectionTemplatePickerModal({ onClose }: { onClose: () => void }) {
  const { actions } = useEditor();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function pick(templateKey: string) {
    actions.addSectionFromTemplate(templateKey);
    onClose();
  }

  return (
    <div className="ed-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ed-modal">
        <button className="ed-modal-close" onClick={onClose} aria-label="Fermer">
          <Icon name="x" />
        </button>
        <h3>Nouvelle section depuis un modèle</h3>
        {Object.entries(SECTION_TEMPLATES).map(([key, t]) => (
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
