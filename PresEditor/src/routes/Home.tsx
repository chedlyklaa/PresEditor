import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { EI } from '../lib/icons';
import { toast } from '../lib/toastBus';
import * as api from '../lib/apiClient';
import type { ProjectSummary } from '../lib/apiClient';
import { createBlankStartState } from '../lib/emptyState';
import { createStarterState, PRESENTATION_TEMPLATES } from '../lib/presentationTemplates';
import { buildProjectEnvelope, resolveProjectState } from '../lib/projectFile';
import { exportPresentation } from '../lib/exportPresentation';
import { exportProjectJson } from '../lib/projectFile';
import { renderThumbnail } from '../lib/thumbnail';
import type { EditorState } from '../types/state';

// Module-level (not component state): the gallery's own decks never change
// at runtime, so every Home mount after the first reuses these instead of
// re-rendering the same handful of thumbnails through the SVG->canvas
// pipeline again.
const templateThumbCache = new Map<string, string | null>();

function Icon({ name }: { name: string }) {
  return <span dangerouslySetInnerHTML={{ __html: (EI as Record<string, string>)[name] }} />;
}

function formatRelative(iso: string) {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 30) return `il y a ${diffD} j`;
  return new Date(iso).toLocaleDateString('fr-FR');
}

type SortKey = 'updated' | 'name' | 'created';

// The real home dashboard (Milestone C) — replaces the Milestone B stub.
// Deliberately has no EditorProvider anywhere in its tree: "open" is just a
// navigation to /editor/:id (App.jsx mounts a fresh EditorProvider there),
// and every card action (rename/duplicate/delete/export) talks to the API
// directly (lib/apiClient.ts) rather than through editor actions.
export default function Home() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [templateThumbs, setTemplateThumbs] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(templateThumbCache)
  );

  function refresh() {
    api
      .listProjects()
      .then(setProjects)
      .catch(() => toast('Impossible de charger vos présentations.', true));
  }
  useEffect(refresh, []);

  // Lazily render (and cache) each template's own first-slide thumbnail —
  // same lib/thumbnail.ts pipeline a saved project's card uses, just fed a
  // fresh createStarterState() instead of a cloud project's saved JSON.
  useEffect(() => {
    let cancelled = false;
    Object.keys(PRESENTATION_TEMPLATES).forEach((key) => {
      if (templateThumbCache.has(key)) return;
      const state = createStarterState(key);
      if (!state) return;
      renderThumbnail(state).then((thumb) => {
        templateThumbCache.set(key, thumb);
        if (!cancelled) setTemplateThumbs((prev) => ({ ...prev, [key]: thumb }));
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Close the open card menu on any click outside it — the menu itself
  // stops propagation (see onClick below), so this only ever fires for a
  // genuine "clicked elsewhere".
  useEffect(() => {
    if (!openMenuId) return;
    const close = () => setOpenMenuId(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [openMenuId]);

  const visible = useMemo(() => {
    if (!projects) return [];
    const q = search.trim().toLowerCase();
    const filtered = q ? projects.filter((p) => p.title.toLowerCase().includes(q)) : projects;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'name') return a.title.localeCompare(b.title);
      if (sortKey === 'created') return b.createdAt.localeCompare(a.createdAt);
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [projects, search, sortKey]);

  async function createFromState(title: string, state: EditorState) {
    setBusy(true);
    try {
      const created = await api.createProject(title, buildProjectEnvelope(state));
      navigate(`/editor/${created.id}`);
    } catch (err: any) {
      toast(err.message || 'Échec de la création.', true);
      setBusy(false);
    }
  }

  function handleCreateBlank() {
    const state = createBlankStartState() as EditorState;
    createFromState(state.meta.title, state);
  }

  function handleUseTemplate(key: string, label: string) {
    const state = createStarterState(key);
    if (!state) return;
    // createStarterState() leaves meta.title at createEmptyState()'s
    // generic default — set it to the template's own label so the editor's
    // title field and this dashboard card agree from the very first save,
    // same as createNewPresentation() already does for local-mode decks.
    state.meta.title = label;
    createFromState(label, state);
  }

  function startRename(p: ProjectSummary) {
    setOpenMenuId(null);
    setRenamingId(p.id);
    setRenameValue(p.title);
  }

  async function commitRename(id: string) {
    const title = renameValue.trim();
    setRenamingId(null);
    if (!title) return;
    try {
      await api.renameProject(id, title);
      setProjects((prev) => prev && prev.map((p) => (p.id === id ? { ...p, title } : p)));
    } catch (err: any) {
      toast(err.message || 'Échec du renommage.', true);
    }
  }

  async function handleDuplicate(p: ProjectSummary) {
    setOpenMenuId(null);
    try {
      const copy = await api.duplicateProject(p.id);
      setProjects((prev) => (prev ? [copy, ...prev] : [copy]));
      toast('Présentation dupliquée.');
    } catch (err: any) {
      toast(err.message || 'Échec de la duplication.', true);
    }
  }

  async function handleDelete(p: ProjectSummary) {
    setOpenMenuId(null);
    if (!window.confirm(`Supprimer « ${p.title} » ? Cette action est irréversible.`)) return;
    try {
      await api.deleteProject(p.id);
      setProjects((prev) => prev && prev.filter((x) => x.id !== p.id));
      toast('Présentation supprimée.');
    } catch (err: any) {
      toast(err.message || 'Échec de la suppression.', true);
    }
  }

  async function handleExportHtml(p: ProjectSummary) {
    setOpenMenuId(null);
    try {
      const doc = await api.getProject(p.id);
      exportPresentation(resolveProjectState(doc.json));
    } catch (err: any) {
      toast(err.message || "Échec de l'export.", true);
    }
  }

  async function handleExportJson(p: ProjectSummary) {
    setOpenMenuId(null);
    try {
      const doc = await api.getProject(p.id);
      exportProjectJson(resolveProjectState(doc.json));
    } catch (err: any) {
      toast(err.message || "Échec de l'export.", true);
    }
  }

  return (
    <div className="ed-app">
      <div className="ed-topbar">
        <div className="ed-brand">
          <Icon name="sitemap" /> Éditeur
        </div>
        <div className="ed-spacer" />
        <button className="ed-btn primary" onClick={handleCreateBlank} disabled={busy}>
          <Icon name="plus" /> Nouvelle présentation
        </button>
        <span className="ed-account-btn-email">{user?.displayName}</span>
        <button className="ed-btn" onClick={signOut} title="Se déconnecter">
          <Icon name="user" /> Se déconnecter
        </button>
      </div>

      <div className="ed-canvas-stage ed-welcome" style={{ width: '100%' }}>
        <div className="ed-welcome-hero">
          <h2>Bonjour {user?.displayName}</h2>
          <p>Reprenez une présentation ci-dessous, ou créez-en une nouvelle à partir d'un modèle.</p>
        </div>

        <div className="ed-welcome-section">
          <div className="ed-home-toolbar">
            <h3>Vos présentations</h3>
            <div className="ed-home-toolbar-controls">
              <div className="ed-home-search">
                <Icon name="search" />
                <input
                  type="search"
                  placeholder="Rechercher…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select className="ed-home-sort" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                <option value="updated">Dernière modification</option>
                <option value="name">Nom</option>
                <option value="created">Date de création</option>
              </select>
            </div>
          </div>

          {projects === null ? (
            <div className="ed-library-grid">
              {[0, 1, 2].map((i) => (
                <div key={i} className="ed-library-card ed-skeleton" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="ed-empty" style={{ margin: '10px auto 30px' }}>
              <p>
                {projects.length === 0
                  ? 'Aucune présentation pour le moment — démarrez avec un modèle ci-dessous.'
                  : 'Aucun résultat pour cette recherche.'}
              </p>
            </div>
          ) : (
            <div className="ed-library-grid ed-library-grid-saved">
              {visible.map((p) => (
                <div
                  key={p.id}
                  data-project-id={p.id}
                  className="ed-library-card"
                  onClick={() => renamingId !== p.id && navigate(`/editor/${p.id}`)}
                >
                  <button
                    className="ed-library-card-menu-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuId(openMenuId === p.id ? null : p.id);
                    }}
                    title="Actions"
                  >
                    <Icon name="more" />
                  </button>
                  {openMenuId === p.id && (
                    <div className="ed-library-card-menu" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => navigate(`/editor/${p.id}`)}>Ouvrir</button>
                      <button onClick={() => startRename(p)}>Renommer</button>
                      <button onClick={() => handleDuplicate(p)}>Dupliquer</button>
                      <button onClick={() => handleExportHtml(p)}>Exporter HTML</button>
                      <button onClick={() => handleExportJson(p)}>Exporter JSON</button>
                      <button className="danger" onClick={() => handleDelete(p)}>
                        Supprimer
                      </button>
                    </div>
                  )}
                  <div className="ed-library-card-thumb">
                    {p.thumbnail ? (
                      <img src={p.thumbnail} alt="" />
                    ) : (
                      <div className="ed-library-card-icon">
                        <Icon name="sitemap" />
                      </div>
                    )}
                  </div>
                  {renamingId === p.id ? (
                    <input
                      className="ed-library-card-rename-input"
                      autoFocus
                      value={renameValue}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => commitRename(p.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(p.id);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                    />
                  ) : (
                    <div className="ed-library-card-title">{p.title}</div>
                  )}
                  <div className="ed-library-card-meta">{formatRelative(p.updatedAt)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="ed-welcome-section">
          <h3>Modèles</h3>
          <div className="ed-library-grid ed-library-grid-templates">
            <button className="ed-library-card ed-library-template" onClick={handleCreateBlank} disabled={busy}>
              <div className="ed-library-card-thumb">
                <div className="ed-library-card-icon">
                  <Icon name="plus" />
                </div>
                <div className="ed-library-template-hover">Utiliser ce modèle</div>
              </div>
              <div className="ed-library-card-title">Vierge</div>
              <div className="ed-library-card-meta">Une présentation vide, à construire à partir de zéro.</div>
            </button>
            {Object.entries(PRESENTATION_TEMPLATES).map(([key, t]) => (
              <button
                key={key}
                className="ed-library-card ed-library-template"
                onClick={() => handleUseTemplate(key, t.label)}
                disabled={busy}
              >
                <div className={`ed-library-card-thumb${!(key in templateThumbs) ? ' ed-skeleton' : ''}`}>
                  {templateThumbs[key] ? (
                    <img src={templateThumbs[key] as string} alt="" />
                  ) : key in templateThumbs ? (
                    <div className="ed-library-card-icon">
                      <Icon name={t.icon} />
                    </div>
                  ) : null}
                  <div className="ed-library-template-hover">Utiliser ce modèle</div>
                </div>
                <div className="ed-library-card-title">{t.label}</div>
                <div className="ed-library-card-meta">{t.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
