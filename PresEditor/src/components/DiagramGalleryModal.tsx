import { useEffect, useMemo } from 'react';
import { EI } from '../lib/icons';
import { DIAGRAM_TEMPLATES } from '../lib/diagramTemplates';
import { createScene } from '../scene/objectDefaults';
import { renderScene } from '../scene/renderScene';
import { PAGE_WIDTH, PAGE_HEIGHT } from '../scene/geometry';

function Icon({ name }: { name: string }) {
  return <span dangerouslySetInnerHTML={{ __html: (EI as Record<string, string>)[name] }} />;
}

const THUMB_WIDTH = 220;
const THUMB_SCALE = THUMB_WIDTH / PAGE_WIDTH;
const THUMB_HEIGHT = PAGE_HEIGHT * THUMB_SCALE;

// Milestone A (v2): a live preview, not a static icon — the template's own
// build() output is rendered through the exact same renderScene() the
// canvas and export use, wrapped in a scaled-down box. No new preview
// mechanism, no risk of the thumbnail ever drifting from what actually
// gets inserted.
function DiagramThumbnail({ templateKey }: { templateKey: string }) {
  const html = useMemo(() => {
    const template = (DIAGRAM_TEMPLATES as Record<string, { build: () => any[] }>)[templateKey];
    const scene = createScene(template.build());
    return renderScene(scene, 'export', {});
  }, [templateKey]);

  return (
    <div className="ed-diagram-thumb" style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}>
      <div
        className="ed-diagram-thumb-inner"
        style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT, transform: `scale(${THUMB_SCALE})` }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

export default function DiagramGalleryModal({ onPick, onClose }: { onPick: (key: string) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="ed-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ed-modal ed-diagram-gallery-modal">
        <button className="ed-modal-close" onClick={onClose} aria-label="Fermer">
          <Icon name="x" />
        </button>
        <h3>Modèles de diagramme</h3>
        <div className="ed-diagram-gallery-grid">
          {Object.entries(DIAGRAM_TEMPLATES).map(([key, t]) => (
            <button
              key={key}
              className="ed-diagram-gallery-item"
              onClick={() => {
                onPick(key);
                onClose();
              }}
            >
              <DiagramThumbnail templateKey={key} />
              <span className="ed-diagram-gallery-title">
                <Icon name={(t as { icon: string }).icon} /> {t.label}
              </span>
              <span className="ed-diagram-gallery-desc">{(t as { desc: string }).desc}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
