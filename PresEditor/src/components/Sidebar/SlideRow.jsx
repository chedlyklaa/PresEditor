import { memo, useState } from 'react';
import { EI } from '../../lib/icons';
import { useDragRef } from './DragContext';

function Icon({ name }) {
  return <span dangerouslySetInnerHTML={{ __html: EI[name] }} />;
}

// Memoized, and deliberately does *not* call useEditor() itself — `actions`
// comes in as a (referentially stable) prop instead. If this component read
// context directly, React would re-render it on every keystroke elsewhere
// in the deck regardless of memo(), since useContext subscriptions bypass
// prop-based memoization. `label` is passed as a plain string (computed by
// the parent, which reads scenesById) rather than the slide/scene objects
// themselves, for the same reason: those references change on every scene
// edit anywhere in the deck, which would defeat the memoization here even
// though only a handful of rows' *text* actually changes.
const SlideRow = memo(function SlideRow({ slideId, index, ownerKey, label, isSelected, actions }) {
  const dragRef = useDragRef();
  const [dropSide, setDropSide] = useState(null); // 'top' | 'bot' | null

  return (
    <li
      className={`ed-slide-row${isSelected ? ' selected' : ''}${dropSide ? ` drag-over-${dropSide}` : ''}`}
      draggable
      onClick={() => actions.selectSlide(slideId, 0)}
      onDragStart={(e) => {
        dragRef.current = { type: 'slide', id: slideId };
        e.dataTransfer.effectAllowed = 'move';
        e.stopPropagation();
      }}
      onDragOver={(e) => {
        if (!dragRef.current || dragRef.current.type !== 'slide') return;
        e.preventDefault();
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        setDropSide(e.clientY - rect.top < rect.height / 2 ? 'top' : 'bot');
      }}
      onDragLeave={() => setDropSide(null)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const side = dropSide;
        setDropSide(null);
        const dragged = dragRef.current;
        dragRef.current = null;
        if (!dragged || dragged.type !== 'slide' || dragged.id === slideId) return;
        actions.relocateSlide(dragged.id, ownerKey, index + (side === 'bot' ? 1 : 0));
      }}
    >
      <span className="ed-slide-num">{String(index + 1).padStart(2, '0')}</span>
      <span className="ed-slide-ic">
        <Icon name="type" />
      </span>
      <span className="ed-slide-label">{label}</span>
      <span className="ed-slide-actions">
        <button className="ed-icon-btn" title="Monter" onClick={(e) => { e.stopPropagation(); actions.moveSlide(slideId, -1); }}>
          <Icon name="arrowUp" />
        </button>
        <button className="ed-icon-btn" title="Descendre" onClick={(e) => { e.stopPropagation(); actions.moveSlide(slideId, 1); }}>
          <Icon name="arrowDown" />
        </button>
        <button className="ed-icon-btn" title="Dupliquer" onClick={(e) => { e.stopPropagation(); actions.duplicateSlide(slideId); }}>
          <Icon name="copy" />
        </button>
        <button className="ed-icon-btn danger" title="Supprimer" onClick={(e) => { e.stopPropagation(); actions.deleteSlide(slideId); }}>
          <Icon name="trash" />
        </button>
      </span>
    </li>
  );
});

export default SlideRow;
