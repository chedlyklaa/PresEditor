import { useEffect, useState } from 'react';
import { useEditor } from '../state/EditorContext';
import { EI } from '../lib/icons';
import { PRESENTATION_TEMPLATES } from '../lib/presentationTemplates';
import { THEME_PALETTES } from '../lib/themePalettes';

function Icon({ name }: { name: string }) {
  return <span dangerouslySetInnerHTML={{ __html: (EI as Record<string, string>)[name] }} />;
}

const STARTERS = [
  { key: 'blank', label: 'Vierge', desc: 'Une diapositive de titre à personnaliser.', icon: 'plus' },
  ...Object.entries(PRESENTATION_TEMPLATES).map(([key, t]) => ({ key, label: t.label, desc: t.desc, icon: t.icon })),
];

// Milestone C (v2): the single "create a deck" flow, reachable both before
// anything is loaded (Welcome.jsx, warnBeforeReplace=false — there's
// nothing to discard yet) and mid-session (TopBar.jsx's "Nouveau" button,
// warnBeforeReplace=true — creating one *replaces* the current deck, same
// destructive-action-needs-confirm convention deleteSection already uses).
export default function NewPresentationModal({
  onClose,
  warnBeforeReplace,
}: {
  onClose: () => void;
  warnBeforeReplace: boolean;
}) {
  const { actions } = useEditor();
  const [title, setTitle] = useState('Ma présentation');
  const [starterKey, setStarterKey] = useState('blank');
  const [themeKey, setThemeKey] = useState(THEME_PALETTES[0].key);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function handleCreate() {
    if (
      warnBeforeReplace &&
      !window.confirm(
        "Créer une nouvelle présentation ? Le travail actuel sera remplacé (pensez à l'exporter ou l'enregistrer avant si besoin)."
      )
    ) {
      return;
    }
    actions.createNewPresentation({ starterKey, title, themeKey });
    onClose();
  }

  return (
    <div className="ed-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ed-modal ed-new-presentation-modal">
        <button className="ed-modal-close" onClick={onClose} aria-label="Fermer">
          <Icon name="x" />
        </button>
        <h3>Nouvelle présentation</h3>
        <div className="ed-inspector-row">
          <label>Titre</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>
        <div className="ed-np-section-label">Point de départ</div>
        <div className="ed-np-starter-grid">
          {STARTERS.map((s) => (
            <button
              key={s.key}
              className={`ed-layout-opt${starterKey === s.key ? ' on' : ''}`}
              onClick={() => setStarterKey(s.key)}
            >
              <span className="ed-ic">
                <Icon name={s.icon} />
              </span>
              <span>
                <span className="ed-lo-title">{s.label}</span>
                <span className="ed-lo-desc">{s.desc}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="ed-np-section-label">Palette de thème</div>
        <div className="ed-np-theme-grid">
          {THEME_PALETTES.map((p) => (
            <button
              key={p.key}
              className={`ed-np-swatch${themeKey === p.key ? ' on' : ''}`}
              title={p.label}
              onClick={() => setThemeKey(p.key)}
            >
              <span className="ed-np-swatch-colors">
                <span style={{ background: p.vars.navy }} />
                <span style={{ background: p.vars.blue }} />
                <span style={{ background: p.vars['bg-light'] }} />
              </span>
              <span className="ed-np-swatch-label">{p.label}</span>
            </button>
          ))}
        </div>
        <div className="ed-inspector-row" style={{ marginTop: 18 }}>
          <button className="ed-btn primary" onClick={handleCreate}>
            <Icon name="plus" /> Créer la présentation
          </button>
        </div>
      </div>
    </div>
  );
}
