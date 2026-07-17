import { useEditor } from '../../state/EditorContext';
import { EI } from '../../lib/icons';
import { slideRowLabel } from '../../lib/slideLabel';
import { useDragRef } from './DragContext';
import SlideRow from './SlideRow';

function Icon({ name }) {
  return <span dangerouslySetInnerHTML={{ __html: EI[name] }} />;
}

// The hidden Q&A deck (QA_SLIDES in the source presentation) isn't part of
// the overview map, so it gets a simplified pseudo-section: no color, no
// rename, no reordering against other sections — just collapse + add.
export default function QaSection({ onAddSlide }) {
  const { state, actions } = useEditor();
  const dragRef = useDragRef();

  return (
    <div className={`ed-sec${state.qaCollapsed ? ' collapsed' : ''}`}>
      <div className="ed-sec-head" style={{ cursor: 'default' }}>
        <span className="ed-grip" style={{ opacity: 0.3 }}>
          <Icon name="folder" />
        </span>
        <button className="ed-chevron" onClick={actions.toggleQaCollapse}>
          <Icon name="chevron" />
        </button>
        <span className="ed-dot" style={{ background: '#8c6aa3' }} />
        <span className="ed-sec-label" style={{ paddingTop: 3 }}>
          Q&amp;R (masqué)
        </span>
        <span className="ed-count">{state.qaSlideIds.length}</span>
        <button className="ed-icon-btn" title="Ajouter une diapositive" onClick={() => onAddSlide('__qa__')}>
          <Icon name="plus" />
        </button>
      </div>
      <ul
        className="ed-slidelist"
        onDragOver={(e) => {
          if (dragRef.current?.type === 'slide') e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          const dragged = dragRef.current;
          dragRef.current = null;
          if (dragged?.type === 'slide') actions.relocateSlide(dragged.id, '__qa__', state.qaSlideIds.length);
        }}
      >
        {/* Milestone 10: see SectionItem.jsx's identical comment — skip
            mounting rows while collapsed instead of only CSS-hiding them. */}
        {!state.qaCollapsed &&
          state.qaSlideIds.map((slideId, i) => (
            <SlideRow
              key={slideId}
              slideId={slideId}
              index={i}
              ownerKey="__qa__"
              label={slideRowLabel(state.slidesById[slideId], state.scenesById)}
              isSelected={state.selectedSlideId === slideId}
              actions={actions}
            />
          ))}
      </ul>
    </div>
  );
}
