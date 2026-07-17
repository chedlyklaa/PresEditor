import { useState } from 'react';
import { useEditor } from '../../state/EditorContext';
import { EI } from '../../lib/icons';

function Icon({ name }) {
  return <span dangerouslySetInnerHTML={{ __html: EI[name] }} />;
}

// Milestone 5: a lighter-weight row than SlideRow — master/component
// slides don't reorder against each other or duplicate, so there's no
// drag-and-drop or "Dupliquer" button to wire up, just select + delete.
function SimpleSlideRow({ label, isSelected, onSelect, onDelete }) {
  return (
    <li className={`ed-slide-row${isSelected ? ' selected' : ''}`} onClick={onSelect}>
      <span className="ed-slide-label">{label}</span>
      <span className="ed-slide-actions">
        <button
          className="ed-icon-btn danger"
          title="Supprimer"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Icon name="trash" />
        </button>
      </span>
    </li>
  );
}

// Shared by the Masters and Composants sections in Sidebar.jsx — both are
// just "browse this list of slides living outside the normal deck" UIs
// (see types/state.ts's EditorState doc comment on masterSlideIds/
// componentSlideIds), differing only in icon, label, and which
// action/collection they point at.
export default function SimpleSlideSection({ icon, dotColor, title, ids, addTitle, onAdd, onDelete, emptyLabel }) {
  const { state, actions } = useEditor();
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className={`ed-sec${collapsed ? ' collapsed' : ''}`}>
      <div className="ed-sec-head" style={{ cursor: 'default' }}>
        <span className="ed-grip" style={{ opacity: 0.3 }}>
          <Icon name={icon} />
        </span>
        <button className="ed-chevron" onClick={() => setCollapsed((v) => !v)}>
          <Icon name="chevron" />
        </button>
        <span className="ed-dot" style={{ background: dotColor }} />
        <span className="ed-sec-label" style={{ paddingTop: 3 }}>
          {title}
        </span>
        <span className="ed-count">{ids.length}</span>
        <button className="ed-icon-btn" title={addTitle} onClick={onAdd}>
          <Icon name="plus" />
        </button>
      </div>
      <ul className="ed-slidelist">
        {/* Milestone 10: skip mounting rows while collapsed — see
            SectionItem.jsx's identical comment. */}
        {!collapsed &&
          ids.map((id) => (
            <SimpleSlideRow
              key={id}
              slideId={id}
              label={state.slidesById[id]?.nodeLabel || title}
              isSelected={state.selectedSlideId === id}
              onSelect={() => actions.selectSlide(id, 0)}
              onDelete={() => onDelete(id)}
            />
          ))}
        {!collapsed && ids.length === 0 && <li className="ed-layers-empty">{emptyLabel}</li>}
      </ul>
    </div>
  );
}
