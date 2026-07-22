import { useRef, useState } from 'react';
import { useEditor } from '../../state/EditorContext';
import { EI } from '../../lib/icons';
import { toast } from '../../lib/toastBus';
import { optimizeImageFile } from '../../lib/imageCompression';

function Icon({ name }: { name: string }) {
  return <span dangerouslySetInnerHTML={{ __html: (EI as Record<string, string>)[name] }} />;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

// Milestone 9: a third collapsible Sidebar section, alongside Masters and
// Composants (SimpleSlideSection.jsx) — but assets aren't slides (no
// select-to-edit, just insert/delete), so this is its own small component
// rather than forcing a reuse of that one. Clicking a thumbnail inserts an
// image object referencing that asset onto the *currently selected* slide,
// via the exact same ADD_OBJECT action Canvas.tsx's "Photo" button
// dispatches — the only difference is the assetId is already known here,
// instead of being freshly registered from a file pick.
export default function AssetLibrary() {
  const { state, actions } = useEditor();
  const [collapsed, setCollapsed] = useState(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const slide = state.selectedSlideId ? state.slidesById[state.selectedSlideId] : null;
  const currentSceneId = slide?.pages[state.selectedPage] ?? null;

  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const dataUrl = await optimizeImageFile(file);
    actions.registerAsset(dataUrl, 'image', file.name);
  }

  function insertOnCurrentSlide(assetId: string) {
    if (!currentSceneId) {
      toast('Sélectionnez d’abord une diapositive.', true);
      return;
    }
    actions.addObject(currentSceneId, 'image', { data: { assetId, fit: 'cover' } });
  }

  return (
    <div className={`ed-sec${collapsed ? ' collapsed' : ''}`}>
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFilePicked} />
      <div className="ed-sec-head" style={{ cursor: 'default' }}>
        <span className="ed-grip" style={{ opacity: 0.3 }}>
          <Icon name="img" />
        </span>
        <button className="ed-chevron" onClick={() => setCollapsed((v) => !v)}>
          <Icon name="chevron" />
        </button>
        <span className="ed-dot" style={{ background: 'var(--blue)' }} />
        <span className="ed-sec-label" style={{ paddingTop: 3 }}>
          Bibliothèque d'assets
        </span>
        <span className="ed-count">{state.assetOrder.length}</span>
        <button className="ed-icon-btn" title="Importer une image" onClick={() => fileInputRef.current?.click()}>
          <Icon name="plus" />
        </button>
      </div>
      <ul className="ed-asset-grid">
        {/* Milestone 10: skip mounting rows while collapsed — see
            SectionItem.jsx's identical comment. */}
        {!collapsed &&
          state.assetOrder.map((id) => {
            const asset = state.assetsById[id];
            if (!asset) return null;
            return (
              <li key={id} className="ed-asset-row" title={`${asset.name} (${formatBytes(asset.size)})`}>
                <button className="ed-asset-thumb" onClick={() => insertOnCurrentSlide(id)}>
                  <img src={asset.dataUrl} alt={asset.name} />
                </button>
                <span className="ed-asset-name">{asset.name}</span>
                <button className="ed-icon-btn danger" title="Supprimer" onClick={() => actions.deleteAsset(id)}>
                  <Icon name="trash" />
                </button>
              </li>
            );
          })}
        {!collapsed && state.assetOrder.length === 0 && (
          <li className="ed-layers-empty">Aucun asset. Importez une image ou utilisez le bouton « Photo » du canevas.</li>
        )}
      </ul>
    </div>
  );
}
