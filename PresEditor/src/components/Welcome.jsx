import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useEditor } from '../state/EditorContext';
import { useAuth } from '../state/AuthContext';
import { EI } from '../lib/icons';
import { toast } from '../lib/toastBus';
import NewPresentationModal from './NewPresentationModal';
import { listLibraryEntries } from '../lib/presentationLibrary';
import { PRESENTATION_TEMPLATES } from '../lib/presentationTemplates';

function Icon({ name }) {
  return <span dangerouslySetInnerHTML={{ __html: EI[name] }} />;
}

function formatRelative(iso) {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 30) return `il y a ${diffD} j`;
  return new Date(iso).toLocaleDateString('fr-FR');
}

// Local-mode welcome screen, reached only from /editor/local (App.jsx) —
// TopBar's "Mes présentations" button routes back here mid-session (via
// actions.goToLibrary), and this component remounts each time
// (bootStatus==='welcome'), so re-reading lib/presentationLibrary.ts on the
// useState initializer below is enough to stay fresh with no extra
// effect/subscription needed.
//
// Routing & auth (v2, Milestone B): this used to also show a *cloud*
// library when logged in — that's now /home's job (a real route, guarded,
// outside any EditorProvider). This screen is local-storage-only again, so
// it works identically whether or not the visitor has ever signed in.
export default function Welcome() {
  const { actions } = useEditor();
  const { user } = useAuth();
  const fileInputRef = useRef(null);
  const [newPresentationOpen, setNewPresentationOpen] = useState(false);
  const [entries, setEntries] = useState(() => listLibraryEntries());

  function handleFilePicked(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => actions.importFromText(reader.result, 'import');
    reader.onerror = () => toast('Impossible de lire ce fichier.', true);
    reader.readAsText(file);
  }

  function handleDelete(e, entry) {
    e.stopPropagation();
    if (!window.confirm(`Supprimer « ${entry.title} » de vos présentations ? Cette action est irréversible.`)) return;
    actions.deleteLibraryEntry(entry.id);
    setEntries(listLibraryEntries());
  }

  // Quick-start: creates immediately with the template's own defaults
  // (title, no theme override) — a faster path than opening
  // NewPresentationModal for the common case of "just start this template".
  // The modal (below) still covers custom title/theme/blank-start.
  function handleQuickTemplate(key, label) {
    actions.createNewPresentation({ starterKey: key, title: label });
  }

  return (
    <div className="ed-canvas-stage ed-welcome" style={{ width: '100%' }}>
      <div className="ed-welcome-hero">
        <h2>Bienvenue dans l'éditeur</h2>
        <p>
          Importez votre fichier <code>presentation.html</code>, reprenez une présentation précédente ci-dessous, ou
          créez-en une nouvelle à partir d'un modèle. Ceci reste enregistré uniquement dans ce navigateur.
          {user ? (
            <>
              {' '}
              Vos présentations synchronisées se trouvent sur votre <Link to="/home">tableau de bord</Link>.
            </>
          ) : (
            <>
              {' '}
              <Link to="/signin">Connectez-vous</Link> pour synchroniser vos présentations entre vos appareils.
            </>
          )}
        </p>
        <div className="ed-empty-actions">
          <input ref={fileInputRef} type="file" accept=".html,text/html" style={{ display: 'none' }} onChange={handleFilePicked} />
          <button className="ed-btn-lg primary" onClick={() => fileInputRef.current.click()}>
            <Icon name="folder" /> Importer presentation.html
          </button>
          <button className="ed-btn-lg ghost" onClick={() => setNewPresentationOpen(true)}>
            <Icon name="plus" /> Nouvelle présentation
          </button>
        </div>
      </div>

      {entries.length > 0 && (
        <div className="ed-welcome-section">
          <h3>Vos présentations (sur cet appareil)</h3>
          <div className="ed-library-grid ed-library-grid-saved">
            {entries.map((entry) => (
              <div key={entry.id} className="ed-library-card" onClick={() => actions.openFromLibrary(entry.id)}>
                <button className="ed-library-card-delete" title="Supprimer" onClick={(e) => handleDelete(e, entry)}>
                  <Icon name="trash" />
                </button>
                <div className="ed-library-card-icon">
                  <Icon name="sitemap" />
                </div>
                <div className="ed-library-card-title">{entry.title}</div>
                <div className="ed-library-card-meta">
                  {entry.slideCount} diapo{entry.slideCount > 1 ? 's' : ''} · {formatRelative(entry.updatedAt)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="ed-welcome-section">
        <h3>Modèles</h3>
        <div className="ed-library-grid ed-library-grid-templates">
          {Object.entries(PRESENTATION_TEMPLATES).map(([key, t]) => (
            <button key={key} className="ed-library-card ed-library-template" onClick={() => handleQuickTemplate(key, t.label)}>
              <div className="ed-library-card-icon">
                <Icon name={t.icon} />
              </div>
              <div className="ed-library-card-title">{t.label}</div>
              <div className="ed-library-card-meta">{t.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {newPresentationOpen && (
        <NewPresentationModal warnBeforeReplace={false} onClose={() => setNewPresentationOpen(false)} />
      )}
    </div>
  );
}
