import { useState, type ReactNode } from 'react';
import { useEditor } from '../../state/EditorContext';
import { EI, CONTENT_ICON_KEYS } from '../../lib/icons';
import { usePersistedBool } from '../../lib/usePersistedBool';
import { extractPalette } from '../../lib/paletteFromCss';
import { CHART_PALETTE } from '../../scene/renderScene';
import type {
  Scene,
  SceneObject,
  ObjectStyle,
  TextObject,
  ShapeObject,
  IconObject,
  ImageObject,
  DiagramNodeObject,
  ConnectorObject,
  ChartObject,
  TableObject,
  AnimationSpec,
} from '../../types/scene';
import { layoutLayered, toTopLeft } from '../../lib/diagramLayout';
import type { Slide } from '../../types/state';

function Icon({ name }: { name: string }) {
  return <span dangerouslySetInnerHTML={{ __html: (EI as Record<string, string>)[name] }} />;
}

// Milestone C (editor usability overhaul): groups the inspector's
// previously-flat list of rows into labeled, collapsible sections —
// remembered per title (localStorage) via usePersistedBool, so a group a
// user closes (e.g. the rarely-touched Animation controls) stays closed
// next time they select something. Purely a layout wrapper: none of the
// existing per-type control components below needed to change.
function Section({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, toggle] = usePersistedBool(`ed-inspector-section-${title}`, defaultOpen);
  return (
    <div className={`ed-inspector-section${open ? '' : ' collapsed'}`}>
      <button className="ed-inspector-section-head" onClick={() => toggle()}>
        <Icon name="chevron" /> {title}
      </button>
      {open && <div className="ed-inspector-section-body">{children}</div>}
    </div>
  );
}

// Milestone C (editor usability overhaul): the right panel's empty state
// used to be a full-height column with just "Sélectionnez un objet…" —
// mostly blank whenever nothing's selected, which is the *common* state
// while navigating slides. This gives it something genuinely useful to do
// instead: a compact slide-level panel (background + a shortcut into
// NotesPanel's own, already-shipped gradient/palette editor — deliberately
// not duplicated here, see extractPalette's reuse below) rather than
// nothing at all.
function EmptySelectionPanel({ slide }: { slide: Slide | null }) {
  const { state, actions } = useEditor();
  if (!slide) {
    return (
      <div className="ed-inspector">
        <div className="ed-inspector-head">Propriétés</div>
        <div className="ed-inspector-empty">Aucune diapositive sélectionnée.</div>
      </div>
    );
  }
  const swatches = extractPalette(state.meta.styleBlock).slice(0, 6);
  return (
    <div className="ed-inspector">
      <div className="ed-inspector-head">Propriétés</div>
      <div className="ed-inspector-body">
        <div className="ed-inspector-empty-hint">Sélectionnez un objet pour modifier ses propriétés.</div>
        <Section title="Diapositive" defaultOpen>
          <div className="ed-inspector-row">
            <label>Fond</label>
            <button
              className={`ed-btn${slide.cls === 'slide-light' ? ' on' : ''}`}
              onClick={() => actions.updateSlideBg(slide.id, 'slide-light')}
            >
              Clair
            </button>
            <button
              className={`ed-btn${slide.cls === 'slide-dark' ? ' on' : ''}`}
              onClick={() => actions.updateSlideBg(slide.id, 'slide-dark')}
            >
              Sombre
            </button>
          </div>
          {swatches.length > 0 && (
            <div className="ed-inspector-row ed-empty-palette">
              {swatches.map((s) => (
                <span key={s.name} className="ed-empty-palette-swatch" style={{ background: s.value }} title={s.name} />
              ))}
            </div>
          )}
          <div className="ed-inspector-row">
            <button className="ed-btn" onClick={actions.toggleNotes}>
              <Icon name="note" /> Notes & fond de diapositive…
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
}

// x/y/width/height/rotation/opacity/locked/hidden, plus (Milestone 3)
// per-type style controls: text color/size/weight/align, shape
// fill/stroke/radius/shape-kind, icon picker+color, image fit/radius.
// Animation controls arrive with Milestone 8.
export default function ObjectInspector() {
  const { state, actions } = useEditor();
  const slide = state.selectedSlideId ? state.slidesById[state.selectedSlideId] : null;
  const scene = slide ? state.scenesById[slide.pages[state.selectedPage] ?? slide.pages[0]] : null;
  const selectedIds = scene && state.selection?.sceneId === scene.id ? state.selection.objectIds : [];

  if (!scene || selectedIds.length === 0) {
    return <EmptySelectionPanel slide={slide} />;
  }

  if (selectedIds.length > 1) {
    return <MultiObjectInspector sceneId={scene.id} objectIds={selectedIds} />;
  }

  const obj = scene.objectsById[selectedIds[0]];
  if (!obj) {
    return <EmptySelectionPanel slide={slide} />;
  }

  const set = (patch: Record<string, unknown>) => actions.updateObjectTransform(scene.id, obj.id, patch as any);
  const setStyle = (patch: Partial<ObjectStyle>) => set({ style: { ...obj.style, ...patch } });
  const setData = (patch: Record<string, unknown>) => actions.updateObjectData(scene.id, obj.id, patch);
  const num = (v: number) => Math.round(v * 10) / 10;
  const layerIndex = scene.objectOrder.indexOf(obj.id);
  const layerCount = scene.objectOrder.length;

  // A connector's x/y/width/height/rotation are never read at render time
  // (its path is re-derived from its two endpoints every render — see
  // renderScene.ts), so showing editable-but-inert fields for them would
  // just be confusing; only opacity (which the wrapper div does apply) and
  // the controls below stay.
  const showTransformFields = obj.type !== 'connector';

  return (
    <div className="ed-inspector">
      <div className="ed-inspector-head">Propriétés</div>
      <div className="ed-inspector-body">
        {showTransformFields && (
          <Section title="Position & taille" defaultOpen>
            <div className="ed-inspector-row">
              <label>X</label>
              <input type="number" value={num(obj.x)} onChange={(e) => set({ x: Number(e.target.value) })} />
              <label>Y</label>
              <input type="number" value={num(obj.y)} onChange={(e) => set({ y: Number(e.target.value) })} />
            </div>
            <div className="ed-inspector-row">
              <label>L</label>
              <input
                type="number"
                min={1}
                value={num(obj.width)}
                onChange={(e) => set({ width: Math.max(1, Number(e.target.value)) })}
              />
              <label>H</label>
              <input
                type="number"
                min={1}
                value={num(obj.height)}
                onChange={(e) => set({ height: Math.max(1, Number(e.target.value)) })}
              />
            </div>
            <div className="ed-inspector-row">
              <label>Rotation</label>
              <input type="number" value={num(obj.rotation)} onChange={(e) => set({ rotation: Number(e.target.value) })} />
              <label>Opacité</label>
              <input
                type="number"
                min={0}
                max={100}
                value={Math.round(obj.opacity * 100)}
                onChange={(e) => set({ opacity: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })}
              />
            </div>
          </Section>
        )}
        <Section title="Apparence" defaultOpen>
          {obj.type === 'connector' && (
            <div className="ed-inspector-row">
              <label>Opacité</label>
              <input
                type="number"
                min={0}
                max={100}
                value={Math.round(obj.opacity * 100)}
                onChange={(e) => set({ opacity: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })}
              />
            </div>
          )}
          {obj.type === 'text' && <TextStyleControls obj={obj} setStyle={setStyle} setData={setData} />}
          {obj.type === 'shape' && <ShapeStyleControls obj={obj} setStyle={setStyle} setData={setData} />}
          {obj.type === 'icon' && <IconStyleControls obj={obj} setStyle={setStyle} setData={setData} />}
          {obj.type === 'image' && <ImageStyleControls obj={obj} setStyle={setStyle} setData={setData} />}
          {obj.type === 'diagram-node' && <DiagramNodeStyleControls obj={obj} setStyle={setStyle} setData={setData} />}
          {obj.type === 'connector' && <ConnectorStyleControls obj={obj} setStyle={setStyle} setData={setData} />}
          {obj.type === 'chart' && <ChartStyleControls obj={obj} setStyle={setStyle} setData={setData} />}
          {obj.type === 'table' && <TableStyleControls obj={obj} setStyle={setStyle} setData={setData} />}
        </Section>
        {obj.type !== 'connector' && (
          <Section title="Animation" defaultOpen={false}>
            <AnimationControls obj={obj} sceneId={scene.id} />
          </Section>
        )}
        <Section title="Calque & actions" defaultOpen>
          <div className="ed-inspector-row">
            <button className={`ed-btn${obj.locked ? ' on' : ''}`} onClick={() => set({ locked: !obj.locked })}>
              <Icon name={obj.locked ? 'lock' : 'unlock'} /> {obj.locked ? 'Verrouillé' : 'Libre'}
            </button>
            <button className={`ed-btn${obj.hidden ? ' on' : ''}`} onClick={() => set({ hidden: !obj.hidden })}>
              <Icon name={obj.hidden ? 'eyeOff' : 'eye'} /> {obj.hidden ? 'Masqué' : 'Visible'}
            </button>
          </div>
          <div className="ed-inspector-row">
            <span className="ed-inspector-layer-pos">
              Calque {layerIndex + 1} / {layerCount}
            </span>
          </div>
          <div className="ed-inspector-row">
            <button
              className="ed-btn"
              title="Avancer d'un niveau"
              onClick={() => actions.reorderObjectZ(scene.id, obj.id, { dir: 1 })}
            >
              <Icon name="arrowUp" /> Avancer
            </button>
            <button
              className="ed-btn"
              title="Reculer d'un niveau"
              onClick={() => actions.reorderObjectZ(scene.id, obj.id, { dir: -1 })}
            >
              <Icon name="arrowDown" /> Reculer
            </button>
          </div>
          {obj.groupId && (
            <div className="ed-inspector-row">
              <button className="ed-btn" onClick={() => actions.ungroupObjects(scene.id, obj.groupId as string)}>
                <Icon name="ungroup" /> Dissocier le groupe
              </button>
            </div>
          )}
          <div className="ed-inspector-row">
            <button className="ed-btn" onClick={() => actions.duplicateObject(scene.id, obj.id)}>
              <Icon name="copy" /> Dupliquer
            </button>
            <button className="ed-btn danger" onClick={() => actions.deleteObject(scene.id, obj.id)}>
              <Icon name="trash" /> Supprimer
            </button>
          </div>
          {obj.type !== 'component-instance' && (
            <div className="ed-inspector-row">
              <button className="ed-btn" onClick={() => actions.createComponentFromSelection(scene.id, [obj.id])}>
                <Icon name="puzzle" /> Créer un composant
              </button>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function TextStyleControls({
  obj,
  setStyle,
  setData,
}: {
  obj: TextObject;
  setStyle: (patch: Partial<ObjectStyle>) => void;
  setData: (patch: Record<string, unknown>) => void;
}) {
  const style = obj.style || {};
  const isBold = Number(style.fontWeight ?? 400) >= 700;
  return (
    <>
      <div className="ed-inspector-row">
        <label>Couleur</label>
        <input type="color" value={style.color || '#241130'} onChange={(e) => setStyle({ color: e.target.value })} />
        <label>Taille</label>
        <input
          type="number"
          min={8}
          value={style.fontSize ?? 20}
          onChange={(e) => setStyle({ fontSize: Number(e.target.value) })}
        />
      </div>
      <div className="ed-inspector-row ed-align-row">
        <button
          className={`ed-icon-btn${isBold ? ' on' : ''}`}
          title="Gras"
          onClick={() => setStyle({ fontWeight: isBold ? 400 : 700 })}
        >
          <Icon name="bold" />
        </button>
        <button
          className={`ed-icon-btn${style.textAlign === 'left' || !style.textAlign ? ' on' : ''}`}
          title="Aligner à gauche"
          onClick={() => setStyle({ textAlign: 'left' })}
        >
          <Icon name="alignLeft" />
        </button>
        <button
          className={`ed-icon-btn${style.textAlign === 'center' ? ' on' : ''}`}
          title="Centrer"
          onClick={() => setStyle({ textAlign: 'center' })}
        >
          <Icon name="alignCenterX" />
        </button>
        <button
          className={`ed-icon-btn${style.textAlign === 'right' ? ' on' : ''}`}
          title="Aligner à droite"
          onClick={() => setStyle({ textAlign: 'right' })}
        >
          <Icon name="alignRight" />
        </button>
      </div>
      <div className="ed-inspector-row">
        <label>Champ dynamique</label>
        <select
          className="ed-select"
          value={obj.data.dynamicField || ''}
          onChange={(e) => setData({ dynamicField: e.target.value || undefined })}
        >
          <option value="">Texte normal</option>
          <option value="pageNumber">Numéro de page</option>
          <option value="pageCount">Nombre total de pages</option>
        </select>
      </div>
    </>
  );
}

function ShapeStyleControls({
  obj,
  setStyle,
  setData,
}: {
  obj: ShapeObject;
  setStyle: (patch: Partial<ObjectStyle>) => void;
  setData: (patch: Record<string, unknown>) => void;
}) {
  const style = obj.style || {};
  return (
    <>
      <div className="ed-inspector-row">
        <button
          className={`ed-btn${obj.data.shape === 'rect' ? ' on' : ''}`}
          onClick={() => setData({ shape: 'rect' })}
        >
          <Icon name="square" /> Rectangle
        </button>
        <button
          className={`ed-btn${obj.data.shape === 'ellipse' ? ' on' : ''}`}
          onClick={() => setData({ shape: 'ellipse' })}
        >
          <Icon name="circle" /> Ellipse
        </button>
      </div>
      <div className="ed-inspector-row">
        <label>Fond</label>
        <input type="color" value={style.fill || '#4b0976'} onChange={(e) => setStyle({ fill: e.target.value })} />
        <label>Contour</label>
        <input
          type="color"
          value={style.stroke || '#000000'}
          onChange={(e) => setStyle({ stroke: e.target.value, strokeWidth: style.strokeWidth ?? 2 })}
        />
      </div>
      {obj.data.shape === 'rect' && (
        <div className="ed-inspector-row">
          <label>Arrondi</label>
          <input
            type="number"
            min={0}
            value={style.radius ?? 0}
            onChange={(e) => setStyle({ radius: Number(e.target.value) })}
          />
          <button className="ed-btn" onClick={() => setStyle({ stroke: undefined })} title="Retirer le contour">
            Sans contour
          </button>
        </div>
      )}
    </>
  );
}

function IconStyleControls({
  obj,
  setStyle,
  setData,
}: {
  obj: IconObject;
  setStyle: (patch: Partial<ObjectStyle>) => void;
  setData: (patch: Record<string, unknown>) => void;
}) {
  const style = obj.style || {};
  return (
    <>
      <div className="ed-inspector-row">
        <label>Couleur</label>
        <input type="color" value={style.color || '#4b0976'} onChange={(e) => setStyle({ color: e.target.value })} />
      </div>
      <div className="ed-icon-grid">
        {CONTENT_ICON_KEYS.map((key) => (
          <button
            key={key}
            className={`ed-icon-grid-btn${obj.data.icon === key ? ' on' : ''}`}
            title={key}
            onClick={() => setData({ icon: key })}
          >
            <Icon name={key} />
          </button>
        ))}
      </div>
    </>
  );
}

function ImageStyleControls({
  obj,
  setStyle,
  setData,
}: {
  obj: ImageObject;
  setStyle: (patch: Partial<ObjectStyle>) => void;
  setData: (patch: Record<string, unknown>) => void;
}) {
  const style = obj.style || {};
  return (
    <>
      <div className="ed-inspector-row">
        <button
          className={`ed-btn${obj.data.fit === 'cover' ? ' on' : ''}`}
          onClick={() => setData({ fit: 'cover' })}
        >
          Remplir
        </button>
        <button
          className={`ed-btn${obj.data.fit === 'contain' ? ' on' : ''}`}
          onClick={() => setData({ fit: 'contain' })}
        >
          Ajuster
        </button>
      </div>
      <div className="ed-inspector-row">
        <label>Arrondi</label>
        <input
          type="number"
          min={0}
          value={style.radius ?? 0}
          onChange={(e) => setStyle({ radius: Number(e.target.value) })}
        />
      </div>
    </>
  );
}

function DiagramNodeStyleControls({
  obj,
  setStyle,
  setData,
}: {
  obj: DiagramNodeObject;
  setStyle: (patch: Partial<ObjectStyle>) => void;
  setData: (patch: Record<string, unknown>) => void;
}) {
  const style = obj.style || {};
  return (
    <>
      <div className="ed-inspector-row">
        <label>Libellé</label>
        <input type="text" value={obj.data.label} onChange={(e) => setData({ label: e.target.value })} />
      </div>
      <div className="ed-inspector-row ed-align-row">
        <button
          className={`ed-icon-btn${obj.data.shape === 'rect' ? ' on' : ''}`}
          title="Rectangle"
          onClick={() => setData({ shape: 'rect' })}
        >
          <Icon name="square" />
        </button>
        <button
          className={`ed-icon-btn${obj.data.shape === 'ellipse' ? ' on' : ''}`}
          title="Ellipse"
          onClick={() => setData({ shape: 'ellipse' })}
        >
          <Icon name="circle" />
        </button>
        <button
          className={`ed-icon-btn${obj.data.shape === 'diamond' ? ' on' : ''}`}
          title="Losange (décision)"
          onClick={() => setData({ shape: 'diamond' })}
        >
          <Icon name="diamond" />
        </button>
      </div>
      <div className="ed-inspector-row">
        <label>Fond</label>
        <input type="color" value={style.fill || '#4b0976'} onChange={(e) => setStyle({ fill: e.target.value })} />
        <label>Texte</label>
        <input type="color" value={style.color || '#ffffff'} onChange={(e) => setStyle({ color: e.target.value })} />
      </div>
    </>
  );
}

function ConnectorStyleControls({
  obj,
  setStyle,
  setData,
}: {
  obj: ConnectorObject;
  setStyle: (patch: Partial<ObjectStyle>) => void;
  setData: (patch: Record<string, unknown>) => void;
}) {
  const style = obj.style || {};
  return (
    <>
      <div className="ed-inspector-row">
        <label>Trait</label>
        <input
          type="color"
          value={style.stroke || '#4b0976'}
          onChange={(e) => setStyle({ stroke: e.target.value })}
        />
        <label>Épaisseur</label>
        <input
          type="number"
          min={1}
          value={style.strokeWidth ?? 2}
          onChange={(e) => setStyle({ strokeWidth: Number(e.target.value) })}
        />
      </div>
      <div className="ed-inspector-row">
        <button
          className={`ed-btn${obj.data.arrowStart ? ' on' : ''}`}
          title="Flèche au départ"
          onClick={() => setData({ arrowStart: !obj.data.arrowStart })}
        >
          ← Flèche
        </button>
        <button className={`ed-btn${obj.data.arrowEnd ? ' on' : ''}`} onClick={() => setData({ arrowEnd: !obj.data.arrowEnd })}>
          Flèche →
        </button>
        <button
          className="ed-btn"
          title="Inverser le sens"
          onClick={() => setData({ fromId: obj.data.toId, toId: obj.data.fromId })}
        >
          <Icon name="connector" /> Inverser
        </button>
      </div>
      <div className="ed-inspector-row">
        <label>Tracé</label>
        <select value={obj.data.routing || 'straight'} onChange={(e) => setData({ routing: e.target.value })}>
          <option value="straight">Droit</option>
          <option value="elbow">Coudé</option>
          <option value="curved">Courbe</option>
        </select>
        <button className={`ed-btn${obj.data.dash ? ' on' : ''}`} title="Trait pointillé" onClick={() => setData({ dash: !obj.data.dash })}>
          Pointillé
        </button>
      </div>
      <div className="ed-inspector-row">
        <label>Étiquette</label>
        <input
          type="text"
          value={obj.data.label || ''}
          onChange={(e) => setData({ label: e.target.value || undefined })}
        />
      </div>
    </>
  );
}

function ChartStyleControls({
  obj,
  setStyle,
  setData,
}: {
  obj: ChartObject;
  setStyle: (patch: Partial<ObjectStyle>) => void;
  setData: (patch: Record<string, unknown>) => void;
}) {
  const [showImport, setShowImport] = useState(false);
  const [csvText, setCsvText] = useState('');
  const style = obj.style || {};
  const series = obj.data.series;
  const basePalette = style.fill ? [style.fill, ...CHART_PALETTE] : CHART_PALETTE;
  const showValues = obj.data.showValues !== false;

  function updateRow(i: number, patch: Partial<{ label: string; value: number; color?: string }>) {
    setData({ series: series.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) });
  }
  function addRow() {
    setData({ series: [...series, { label: `Élément ${series.length + 1}`, value: 10 }] });
  }
  function removeRow(i: number) {
    setData({ series: series.filter((_, idx) => idx !== i) });
  }
  function importCsv() {
    const parsed = csvText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [label, value] = line.split(',');
        return { label: (label || '').trim(), value: Number((value || '').trim()) || 0 };
      });
    if (parsed.length) setData({ series: parsed });
    setShowImport(false);
    setCsvText('');
  }

  return (
    <>
      {/* Every kind labeled, not just iconed — icon-only type buttons here
          previously were the reason this felt like "only one chart type
          exists" (bar, always inserted by default, with no obvious way to
          change it). "Aire" is a distinct kind now (a line chart with a
          filled area under the curve); "Anneau" stays pie's own toggle
          below rather than a 5th type button, since donut is a shape
          variant of pie, not a different data layout. */}
      <div className="ed-inspector-row ed-chart-kind-row">
        <button className={`ed-btn small${obj.data.kind === 'bar' ? ' on' : ''}`} title="Barres" onClick={() => setData({ kind: 'bar' })}>
          <Icon name="barChart" /> Barres
        </button>
        <button className={`ed-btn small${obj.data.kind === 'line' ? ' on' : ''}`} title="Lignes" onClick={() => setData({ kind: 'line' })}>
          <Icon name="lineChart" /> Lignes
        </button>
        <button className={`ed-btn small${obj.data.kind === 'area' ? ' on' : ''}`} title="Aire" onClick={() => setData({ kind: 'area' })}>
          <Icon name="areaChart" /> Aire
        </button>
        <button className={`ed-btn small${obj.data.kind === 'pie' ? ' on' : ''}`} title="Camembert" onClick={() => setData({ kind: 'pie' })}>
          <Icon name="pieChart" /> Camembert
        </button>
      </div>
      <div className="ed-inspector-row">
        <label>Titre</label>
        <input type="text" value={obj.data.title || ''} onChange={(e) => setData({ title: e.target.value || undefined })} />
      </div>
      <div className="ed-inspector-row">
        <label>Couleur de base</label>
        <input type="color" value={style.fill || '#4b0976'} onChange={(e) => setStyle({ fill: e.target.value })} />
      </div>
      {obj.data.kind === 'bar' && (
        <div className="ed-inspector-row">
          <label>Arrondi</label>
          <input
            type="number"
            min={0}
            value={style.radius ?? 3}
            onChange={(e) => setStyle({ radius: Number(e.target.value) })}
          />
        </div>
      )}
      {obj.data.kind === 'pie' && (
        <div className="ed-inspector-row">
          <label>Forme</label>
          <button className={`ed-btn small${!obj.data.donut ? ' on' : ''}`} onClick={() => setData({ donut: false })}>
            Camembert
          </button>
          <button className={`ed-btn small${obj.data.donut ? ' on' : ''}`} onClick={() => setData({ donut: true })}>
            Anneau
          </button>
        </div>
      )}
      <div className="ed-inspector-row">
        <label>Étiquettes</label>
        <button className={`ed-btn small${showValues ? ' on' : ''}`} onClick={() => setData({ showValues: !showValues })}>
          {showValues ? 'Valeurs affichées' : 'Valeurs masquées'}
        </button>
      </div>
      <div className="ed-grid-editor">
        {series.map((s, i) => (
          <div key={i} className="ed-grid-editor-row">
            <input
              type="color"
              className="ed-chart-row-swatch"
              title="Couleur de cet élément"
              value={s.color || basePalette[i % basePalette.length]}
              onChange={(e) => updateRow(i, { color: e.target.value })}
            />
            <input type="text" value={s.label} onChange={(e) => updateRow(i, { label: e.target.value })} />
            <input
              type="number"
              value={s.value}
              onChange={(e) => updateRow(i, { value: Number(e.target.value) })}
              style={{ width: 64, flex: 'none' }}
            />
            <button className="ed-icon-btn danger" title="Supprimer" onClick={() => removeRow(i)}>
              <Icon name="x" />
            </button>
          </div>
        ))}
      </div>
      <div className="ed-inspector-row">
        <button className="ed-btn small" onClick={addRow}>
          <Icon name="plus" /> Ajouter
        </button>
        <button className="ed-btn small" onClick={() => setShowImport((v) => !v)}>
          Importer CSV
        </button>
      </div>
      {showImport && (
        <div className="ed-palette-import">
          <textarea
            className="ed-palette-import-area"
            placeholder={'Étiquette,Valeur\nA,30\nB,55'}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
          />
          <button className="ed-btn small" onClick={importCsv}>
            Appliquer
          </button>
        </div>
      )}
    </>
  );
}

function TableStyleControls({
  obj,
  setStyle,
  setData,
}: {
  obj: TableObject;
  setStyle: (patch: Partial<ObjectStyle>) => void;
  setData: (patch: Record<string, unknown>) => void;
}) {
  const [showImport, setShowImport] = useState(false);
  const [csvText, setCsvText] = useState('');
  const style = obj.style || {};
  const rows = obj.data.rows;
  const cols = rows[0]?.length || 0;

  function updateCell(ri: number, ci: number, value: string) {
    setData({ rows: rows.map((row, r) => (r === ri ? row.map((c, cIdx) => (cIdx === ci ? value : c)) : row)) });
  }
  function addRow() {
    setData({ rows: [...rows, Array(cols || 1).fill('')] });
  }
  function removeRow(ri: number) {
    if (rows.length <= 1) return;
    setData({ rows: rows.filter((_, r) => r !== ri) });
  }
  function addCol() {
    setData({ rows: rows.map((row) => [...row, '']) });
  }
  function removeCol() {
    if (cols <= 1) return;
    setData({ rows: rows.map((row) => row.slice(0, -1)) });
  }
  function importCsv() {
    const parsed = csvText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => line.split(',').map((c) => c.trim()));
    if (parsed.length) setData({ rows: parsed });
    setShowImport(false);
    setCsvText('');
  }

  return (
    <>
      <div className="ed-inspector-row">
        <label>En-tête</label>
        <input type="color" value={style.fill || '#4b0976'} onChange={(e) => setStyle({ fill: e.target.value })} />
        <label>Texte</label>
        <input type="color" value={style.color || '#241130'} onChange={(e) => setStyle({ color: e.target.value })} />
      </div>
      <div className="ed-grid-editor">
        {rows.map((row, ri) => (
          <div key={ri} className="ed-grid-editor-row">
            {row.map((cell, ci) => (
              <input key={ci} type="text" value={cell} onChange={(e) => updateCell(ri, ci, e.target.value)} />
            ))}
            <button className="ed-icon-btn danger" title="Supprimer la ligne" disabled={rows.length <= 1} onClick={() => removeRow(ri)}>
              <Icon name="x" />
            </button>
          </div>
        ))}
      </div>
      <div className="ed-inspector-row">
        <button className="ed-btn small" onClick={addRow}>
          <Icon name="plus" /> Ligne
        </button>
        <button className="ed-btn small" onClick={addCol}>
          <Icon name="plus" /> Colonne
        </button>
        <button className="ed-btn small" disabled={cols <= 1} onClick={removeCol}>
          Retirer colonne
        </button>
      </div>
      <div className="ed-inspector-row">
        <button className="ed-btn small" onClick={() => setShowImport((v) => !v)}>
          Importer CSV
        </button>
      </div>
      {showImport && (
        <div className="ed-palette-import">
          <textarea
            className="ed-palette-import-area"
            placeholder={'col1,col2\nval1,val2'}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
          />
          <button className="ed-btn small" onClick={importCsv}>
            Appliquer
          </button>
        </div>
      )}
    </>
  );
}

const ENTRANCE_PRESETS: Array<{ value: string; label: string }> = [
  { value: 'fade', label: 'Fondu' },
  { value: 'slide-up', label: 'Glissement (bas → haut)' },
  { value: 'slide-down', label: 'Glissement (haut → bas)' },
  { value: 'slide-left', label: 'Glissement (droite → gauche)' },
  { value: 'slide-right', label: 'Glissement (gauche → droite)' },
  { value: 'zoom', label: 'Zoom' },
];

const EMPHASIS_PRESETS: Array<{ value: string; label: string }> = [
  { value: 'pulse', label: 'Pulsation' },
  { value: 'bounce', label: 'Rebond' },
  { value: 'shake', label: 'Secousse' },
  { value: 'flash', label: 'Flash' },
];

// Milestone 8. `obj.animations` holds at most one entry per kind — see
// types/scene.ts's AnimationSpec doc comment. Only visible in the live
// canvas as its *settled* state (the editor's own iframe never toggles
// `content-in` the way the real engine's slide navigation does — see
// lib/animationCss.js) — the actual motion only plays in "Présenter" mode
// or the exported file, both of which run the real engine.
function AnimationControls({ obj, sceneId }: { obj: SceneObject; sceneId: string }) {
  const { actions } = useEditor();
  const entrance = obj.animations?.find((a) => a.kind === 'entrance') ?? null;
  const emphasis = obj.animations?.find((a) => a.kind === 'emphasis') ?? null;

  function setAnimations(next: AnimationSpec[]) {
    actions.updateObjectTransform(sceneId, obj.id, { animations: next } as any);
  }
  function updateEntrance(patch: Partial<AnimationSpec> | null) {
    const others = (obj.animations || []).filter((a) => a.kind !== 'entrance');
    setAnimations(patch === null ? others : [...others, { kind: 'entrance', preset: 'fade', delayMs: 0, ...entrance, ...patch }]);
  }
  function updateEmphasis(patch: Partial<AnimationSpec> | null) {
    const others = (obj.animations || []).filter((a) => a.kind !== 'emphasis');
    setAnimations(patch === null ? others : [...others, { kind: 'emphasis', preset: 'pulse', delayMs: 0, ...emphasis, ...patch }]);
  }

  return (
    <>
      <div className="ed-inspector-row">
        <label>Entrée</label>
        <select
          className="ed-select"
          value={entrance?.preset || ''}
          onChange={(e) => (e.target.value ? updateEntrance({ preset: e.target.value }) : updateEntrance(null))}
        >
          <option value="">Aucune</option>
          {ENTRANCE_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      {entrance && (
        <div className="ed-inspector-row">
          <label>Délai (ms)</label>
          <input
            type="number"
            min={0}
            step={70}
            value={entrance.delayMs ?? 0}
            onChange={(e) => updateEntrance({ delayMs: Math.max(0, Number(e.target.value)) })}
          />
        </div>
      )}
      <div className="ed-inspector-row">
        <label>Emphase</label>
        <select
          className="ed-select"
          value={emphasis?.preset || ''}
          onChange={(e) => (e.target.value ? updateEmphasis({ preset: e.target.value }) : updateEmphasis(null))}
        >
          <option value="">Aucune</option>
          {EMPHASIS_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      {emphasis && (
        <div className="ed-inspector-row">
          <label>Délai (ms)</label>
          <input
            type="number"
            min={0}
            step={70}
            value={emphasis.delayMs ?? 0}
            onChange={(e) => updateEmphasis({ delayMs: Math.max(0, Number(e.target.value)) })}
          />
        </div>
      )}
    </>
  );
}

const ALIGN_OPTIONS: Array<{ edge: string; icon: string; title: string }> = [
  { edge: 'left', icon: 'alignLeft', title: 'Aligner à gauche' },
  { edge: 'centerX', icon: 'alignCenterX', title: 'Centrer horizontalement' },
  { edge: 'right', icon: 'alignRight', title: 'Aligner à droite' },
  { edge: 'top', icon: 'alignTop', title: 'Aligner en haut' },
  { edge: 'centerY', icon: 'alignCenterY', title: 'Centrer verticalement' },
  { edge: 'bottom', icon: 'alignBottom', title: 'Aligner en bas' },
];

// Milestone A (v2): re-layout just the selected diagram nodes, using the
// connectors *already in this scene* whose both endpoints are within the
// selection as the edge set — same layoutLayered() function
// lib/diagramTemplates.js's build()s use for fresh inserts, just fed the
// current live topology instead of a template's. Nodes not selected (or a
// connector reaching outside the selection) are left untouched.
function computeAutoLayoutPatches(scene: Scene, nodeIds: string[]): Record<string, { x: number; y: number }> {
  const nodeIdSet = new Set(nodeIds);
  const edges = scene.objectOrder
    .map((id) => scene.objectsById[id])
    .filter((o): o is ConnectorObject => !!o && o.type === 'connector')
    .filter((c) => nodeIdSet.has(c.data.fromId) && nodeIdSet.has(c.data.toId))
    .map((c) => ({ from: c.data.fromId, to: c.data.toId }));
  const points = layoutLayered(nodeIds, edges);
  const patches: Record<string, { x: number; y: number }> = {};
  points.forEach((p) => {
    const node = scene.objectsById[p.id];
    if (!node) return;
    patches[p.id] = toTopLeft(p, node.width, node.height);
  });
  return patches;
}

function MultiObjectInspector({ sceneId, objectIds }: { sceneId: string; objectIds: string[] }) {
  const { state, actions } = useEditor();
  const scene = state.scenesById[sceneId];
  const objects = objectIds.map((id) => scene?.objectsById[id]).filter(Boolean) as SceneObject[];
  const groupIds = new Set(objects.map((o) => o.groupId).filter((g): g is string => !!g));
  const canDistribute = objects.length >= 3;
  const diagramNodeIds = objects.filter((o) => o.type === 'diagram-node').map((o) => o.id);

  return (
    <div className="ed-inspector">
      <div className="ed-inspector-head">{objects.length} objets sélectionnés</div>
      <div className="ed-inspector-body">
        <div className="ed-inspector-row">
          <button className="ed-btn" onClick={() => actions.groupObjects(sceneId, objectIds)}>
            <Icon name="group" /> Grouper
          </button>
          <button
            className="ed-btn"
            disabled={groupIds.size === 0}
            onClick={() => groupIds.forEach((gid) => actions.ungroupObjects(sceneId, gid))}
          >
            <Icon name="ungroup" /> Dissocier
          </button>
        </div>
        <div className="ed-inspector-row ed-align-row">
          {ALIGN_OPTIONS.map(({ edge, icon, title }) => (
            <button key={edge} className="ed-icon-btn" title={title} onClick={() => actions.alignObjects(sceneId, objectIds, edge)}>
              <Icon name={icon} />
            </button>
          ))}
        </div>
        {objectIds.length === 2 && (
          <div className="ed-inspector-row">
            <button className="ed-btn" onClick={() => actions.createConnector(sceneId, objectIds[0], objectIds[1])}>
              <Icon name="connector" /> Relier ces objets
            </button>
          </div>
        )}
        {diagramNodeIds.length >= 2 && scene && (
          <div className="ed-inspector-row">
            <button
              className="ed-btn"
              title="Repositionne les nœuds sélectionnés selon leurs connecteurs"
              onClick={() => {
                const patches = computeAutoLayoutPatches(scene, diagramNodeIds);
                if (Object.keys(patches).length) actions.updateObjectsTransform(sceneId, patches);
              }}
            >
              <Icon name="sitemap" /> Disposition automatique
            </button>
          </div>
        )}
        <div className="ed-inspector-row">
          <button
            className="ed-btn"
            disabled={!canDistribute}
            title={canDistribute ? 'Distribuer horizontalement' : 'Distribuer nécessite 3 objets ou plus'}
            onClick={() => actions.distributeObjects(sceneId, objectIds, 'horizontal')}
          >
            <Icon name="distributeH" /> Distribuer H
          </button>
          <button
            className="ed-btn"
            disabled={!canDistribute}
            title={canDistribute ? 'Distribuer verticalement' : 'Distribuer nécessite 3 objets ou plus'}
            onClick={() => actions.distributeObjects(sceneId, objectIds, 'vertical')}
          >
            <Icon name="distributeV" /> Distribuer V
          </button>
        </div>
        <div className="ed-inspector-row">
          <button className="ed-btn" onClick={() => actions.duplicateObjects(sceneId, objectIds)}>
            <Icon name="copy" /> Dupliquer
          </button>
          <button className="ed-btn danger" onClick={() => actions.deleteObjects(sceneId, objectIds)}>
            <Icon name="trash" /> Supprimer
          </button>
        </div>
        <div className="ed-inspector-row">
          <button className="ed-btn" onClick={() => actions.createComponentFromSelection(sceneId, objectIds)}>
            <Icon name="puzzle" /> Créer un composant
          </button>
        </div>
      </div>
    </div>
  );
}
