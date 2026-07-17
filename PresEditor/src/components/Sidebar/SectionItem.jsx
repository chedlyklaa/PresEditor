import { useState } from 'react';
import { useEditor } from '../../state/EditorContext';
import { EI } from '../../lib/icons';
import { slideRowLabel } from '../../lib/slideLabel';
import { useDragRef } from './DragContext';
import SlideRow from './SlideRow';
import Menu from '../Menu';

function Icon({ name }) {
  return <span dangerouslySetInnerHTML={{ __html: EI[name] }} />;
}

export default function SectionItem({ section, onAddSlide }) {
  const { state, actions } = useEditor();
  const dragRef = useDragRef();
  const [headDragOver, setHeadDragOver] = useState(false);

  return (
    <div className={`ed-sec${section.collapsed ? ' collapsed' : ''}`}>
      <div
        className={`ed-sec-head${headDragOver ? ' drag-over' : ''}`}
        draggable
        onDragStart={(e) => {
          dragRef.current = { type: 'section', id: section.id };
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          if (dragRef.current?.type === 'section') {
            e.preventDefault();
            setHeadDragOver(true);
          }
        }}
        onDragLeave={() => setHeadDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setHeadDragOver(false);
          const dragged = dragRef.current;
          dragRef.current = null;
          if (dragged?.type === 'section' && dragged.id !== section.id) {
            const from = state.sections.findIndex((s) => s.id === dragged.id);
            const to = state.sections.findIndex((s) => s.id === section.id);
            actions.moveSection(dragged.id, to - from);
          }
        }}
      >
        <span className="ed-grip">
          <Icon name="grip" />
        </span>
        <button className="ed-chevron" onClick={() => actions.toggleSectionCollapse(section.id)}>
          <Icon name="chevron" />
        </button>
        <span
          className="ed-dot"
          style={{ background: section.color }}
          title="Changer la couleur"
          onClick={() => actions.cycleSectionColor(section.id)}
        />
        <input
          className="ed-sec-label"
          value={section.label}
          title={section.label}
          spellCheck={false}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => actions.renameSection(section.id, e.target.value)}
        />
        <span className="ed-count">{section.slideIds.length}</span>
        <button className="ed-icon-btn" title="Ajouter une diapositive" onClick={() => onAddSlide(section.id)}>
          <Icon name="plus" />
        </button>
        {/* Milestone C (editor usability overhaul): Monter/Descendre/
            Supprimer folded into a "⋯" menu — drag-to-reorder (the grip
            handle) already covers reordering day-to-day, and freeing this
            width is what lets the title stop clipping mid-word. */}
        <Menu
          align="right"
          trigger={({ open, toggle }) => (
            <button
              className={`ed-icon-btn${open ? ' on' : ''}`}
              title="Autres actions de section"
              onClick={(e) => {
                e.stopPropagation();
                toggle();
              }}
            >
              <Icon name="more" />
            </button>
          )}
        >
          <button onClick={() => actions.moveSection(section.id, -1)}>
            <Icon name="arrowUp" /> Monter
          </button>
          <button onClick={() => actions.moveSection(section.id, 1)}>
            <Icon name="arrowDown" /> Descendre
          </button>
          <div className="ed-menu-sep" />
          <button className="danger" onClick={() => actions.deleteSection(section.id)}>
            <Icon name="trash" /> Supprimer la section
          </button>
        </Menu>
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
          if (dragged?.type === 'slide') actions.relocateSlide(dragged.id, section.id, section.slideIds.length);
        }}
      >
        {/* Milestone 10: collapsed sections skip mounting their rows
            entirely, not just CSS-hiding them — the previous "always map,
            hide with display:none" approach still paid full React render
            cost per row regardless of visibility, which scales badly for
            decks with hundreds of slides split across many sections that
            are collapsed most of the time. The drop handlers above stay on
            the (still-rendered, empty) <ul> shell, so dropping a slide onto
            a collapsed section still works. */}
        {!section.collapsed &&
          section.slideIds.map((slideId, i) => (
            <SlideRow
              key={slideId}
              slideId={slideId}
              index={i}
              ownerKey={section.id}
              label={slideRowLabel(state.slidesById[slideId], state.scenesById)}
              isSelected={state.selectedSlideId === slideId}
              actions={actions}
            />
          ))}
      </ul>
    </div>
  );
}
