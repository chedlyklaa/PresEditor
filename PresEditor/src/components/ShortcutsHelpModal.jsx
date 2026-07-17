import { useEffect } from 'react';
import { EI } from '../lib/icons';
import { SHORTCUTS } from '../lib/useKeyboardShortcuts';

function Icon({ name }) {
  return <span dangerouslySetInnerHTML={{ __html: EI[name] }} />;
}

// Milestone 10: renders straight from useKeyboardShortcuts.js's own
// SHORTCUTS list — a pure reference, no shortcut logic of its own — so
// "consolidated shortcuts" means one discoverable place to see every
// binding, not a second list that can drift out of sync with the real one.
export default function ShortcutsHelpModal({ onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="ed-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ed-modal ed-shortcuts-modal">
        <button className="ed-modal-close" onClick={onClose} aria-label="Fermer">
          <Icon name="x" />
        </button>
        <h3>Raccourcis clavier</h3>
        {SHORTCUTS.map((group) => (
          <div key={group.category} className="ed-shortcuts-group">
            <div className="ed-shortcuts-group-title">{group.category}</div>
            <table className="ed-shortcuts-table">
              <tbody>
                {group.items.map((item) => (
                  <tr key={item.keys + item.label}>
                    <td>
                      <kbd>{item.keys}</kbd>
                    </td>
                    <td>{item.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
