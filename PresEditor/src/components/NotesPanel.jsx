import { useRef, useState } from 'react';
import { useEditor } from '../state/EditorContext';
import { findLocation } from '../state/reducer';
import { EI, ICON_KEYS } from '../lib/icons';
import { extractPalette } from '../lib/paletteFromCss';
import { optimizeImageFile } from '../lib/imageCompression';

function Icon({ name }) {
  return <span dangerouslySetInnerHTML={{ __html: EI[name] }} />;
}

function safeHex(v) {
  return /^#([0-9a-f]{6})$/i.test(v || '') ? v : '#ffffff';
}

function parseGradient(value) {
  const m = /linear-gradient\((-?\d+)deg,\s*([^,]+),\s*([^)]+)\)/.exec(value || '');
  if (!m) return { angle: 135, c1: '#4b0976', c2: '#f4c10b' };
  return { angle: Number(m[1]), c1: m[2].trim(), c2: m[3].trim() };
}

// Milestone 4: the CSS conversion here (linear-gradient, url(...) cover) must
// stay in sync with lib/slideBackground.js's backgroundToCss and
// exportPresentation.ts's BG_LAYER_INJECTION — those are the two places that
// turn a BackgroundSpec back into paint, this is the one place that composes
// the `value` a gradient/image spec carries.
function GradientEditor({ value, disabled, onChange }) {
  const { angle, c1, c2 } = parseGradient(value);
  const compose = (a, x, y) => `linear-gradient(${a}deg, ${x}, ${y})`;
  return (
    <div className="ed-gradient-row">
      <input type="color" disabled={disabled} value={safeHex(c1)} onChange={(e) => onChange(compose(angle, e.target.value, c2))} />
      <input type="color" disabled={disabled} value={safeHex(c2)} onChange={(e) => onChange(compose(angle, c1, e.target.value))} />
      <input
        type="number"
        min={0}
        max={360}
        disabled={disabled}
        value={angle}
        onChange={(e) => onChange(compose(Number(e.target.value), c1, c2))}
      />
      <span className="ed-gradient-preview" style={{ background: compose(angle, c1, c2) }} />
    </div>
  );
}

function ImageBgPicker({ value, disabled, onPick }) {
  const inputRef = useRef(null);
  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    onPick(await optimizeImageFile(file));
  }
  return (
    <div className="ed-bg-image-row">
      <button type="button" className="ed-btn" disabled={disabled} onClick={() => inputRef.current?.click()}>
        <Icon name="img" /> Choisir une image
      </button>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
      {value && <span className="ed-bg-image-preview" style={{ backgroundImage: `url(${value})` }} />}
    </div>
  );
}

const BG_KINDS = [
  { kind: 'none', label: 'Aucun' },
  { kind: 'color', label: 'Couleur' },
  { kind: 'gradient', label: 'Dégradé' },
  { kind: 'image', label: 'Image' },
];

// Shared by the slide/section/deck scope tabs below — `background`/`onChange`
// are whichever BackgroundSpec the current scope resolves to, so this
// component itself has no idea which level it's editing.
function BackgroundEditor({ background, onChange, palette, disabled }) {
  const kind = background?.kind || 'none';
  return (
    <div className="ed-bg-editor">
      <div className="ed-bg-kind-row">
        {BG_KINDS.map(({ kind: k, label }) => (
          <button
            key={k}
            type="button"
            className={`ed-btn small${kind === k ? ' on' : ''}`}
            disabled={disabled}
            onClick={() => {
              if (k === 'none') onChange(null);
              else if (k === 'color') onChange({ kind: 'color', value: kind === 'color' ? background.value : '#4b0976' });
              else if (k === 'gradient')
                onChange({ kind: 'gradient', value: kind === 'gradient' ? background.value : 'linear-gradient(135deg, #4b0976, #f4c10b)' });
              else if (k === 'image' && kind !== 'image') onChange({ kind: 'image', value: '' });
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {kind === 'color' && (
        <div className="ed-swatch-row">
          {palette.map((sw) => (
            <button
              key={sw.name}
              type="button"
              className={`ed-swatch${background?.value === sw.value ? ' active' : ''}`}
              style={{ background: sw.value }}
              title={`--${sw.name}: ${sw.value}`}
              disabled={disabled}
              onClick={() => onChange({ kind: 'color', value: sw.value })}
            />
          ))}
          <input
            type="color"
            className="ed-swatch-custom"
            title="Couleur personnalisée"
            disabled={disabled}
            value={safeHex(background?.value)}
            onChange={(e) => onChange({ kind: 'color', value: e.target.value })}
          />
        </div>
      )}
      {kind === 'gradient' && (
        <GradientEditor value={background?.value} disabled={disabled} onChange={(value) => onChange({ kind: 'gradient', value })} />
      )}
      {kind === 'image' && (
        <ImageBgPicker value={background?.value} disabled={disabled} onPick={(value) => onChange({ kind: 'image', value })} />
      )}
    </div>
  );
}

const BG_SCOPES = [
  { scope: 'slide', label: 'Diapositive' },
  { scope: 'section', label: 'Section' },
  { scope: 'deck', label: 'Présentation' },
];

const MASTER_SCOPES = [
  { scope: 'section', label: 'Section' },
  { scope: 'deck', label: 'Présentation' },
];

export default function NotesPanel() {
  const { state, actions } = useEditor();
  const [bgScope, setBgScope] = useState('slide');
  const [masterScope, setMasterScope] = useState('section');
  const [importText, setImportText] = useState('');
  const [importedSwatches, setImportedSwatches] = useState([]);
  const [showImport, setShowImport] = useState(false);

  if (!state.notesOpen) return null;

  const slide = state.selectedSlideId ? state.slidesById[state.selectedSlideId] : null;
  const loc = slide ? findLocation(state, slide.id) : null;
  const isQa = loc?.kind === 'qa';
  const section = loc?.kind === 'section' ? state.sections.find((s) => s.id === loc.sectionId) ?? null : null;
  const sceneId = slide ? slide.pages[state.selectedPage] ?? slide.pages[0] : null;
  const scene = sceneId ? state.scenesById[sceneId] : null;
  const palette = extractPalette(state.meta.styleBlock);

  let currentBg = null;
  let setBg = () => {};
  let scopeDisabled = false;
  if (bgScope === 'slide') {
    currentBg = scene?.background || null;
    setBg = (bg) => scene && actions.updateSceneBackground(scene.id, bg);
    scopeDisabled = !scene;
  } else if (bgScope === 'section') {
    currentBg = section?.defaultBackground || null;
    setBg = (bg) => section && actions.updateSectionBackground(section.id, bg);
    scopeDisabled = !section;
  } else {
    currentBg = state.meta.defaultBackground || null;
    setBg = (bg) => actions.updateDeckBackground(bg);
    scopeDisabled = false;
  }

  // Milestone 5: one level shallower than the background cascade above —
  // no per-slide override (see SectionMeta.masterSlideId's doc comment).
  let currentMasterId = null;
  let setMasterId = () => {};
  let masterScopeDisabled = false;
  if (masterScope === 'section') {
    currentMasterId = section?.masterSlideId || null;
    setMasterId = (id) => section && actions.setSectionMaster(section.id, id);
    masterScopeDisabled = !section;
  } else {
    currentMasterId = state.meta.defaultMasterSlideId || null;
    setMasterId = (id) => actions.setDeckMaster(id);
  }

  function handleExtractPalette() {
    setImportedSwatches(extractPalette(importText));
  }

  function handleAdoptSwatch(sw, i) {
    const existingNames = new Set(palette.map((p) => p.name));
    let name = `imported-${i + 1}`;
    let n = 1;
    while (existingNames.has(name)) {
      name = `imported-${i + 1}-${n}`;
      n += 1;
    }
    actions.updateThemeToken(name, sw.value);
  }

  return (
    <div className="ed-notes">
      <div className="ed-notes-head">
        <Icon name="note" /> Notes de l'intervenant
      </div>
      <textarea
        className="ed-notes-area"
        placeholder="Notes visibles uniquement dans l'éditeur (non affichées pendant la présentation)…"
        disabled={!slide}
        value={slide?.notes || ''}
        onChange={(e) => slide && actions.updateSlideNotes(slide.id, e.target.value)}
      />
      <div className="ed-node-meta">
        <div>
          <label>Fond</label>
          <select
            className="ed-select"
            disabled={!slide}
            value={slide?.cls || 'slide-light'}
            onChange={(e) => slide && actions.updateSlideBg(slide.id, e.target.value)}
          >
            <option value="slide-light">Clair</option>
            <option value="slide-dark">Sombre</option>
          </select>
        </div>
        <div>
          <label>Arrière-plan</label>
          <div className="ed-bg-scope-row">
            {BG_SCOPES.map(({ scope, label }) => (
              <button
                key={scope}
                type="button"
                className={`ed-btn small${bgScope === scope ? ' on' : ''}`}
                onClick={() => setBgScope(scope)}
              >
                {label}
              </button>
            ))}
          </div>
          <BackgroundEditor background={currentBg} onChange={setBg} palette={palette} disabled={scopeDisabled} />
        </div>
        <div>
          <label>Modèle (en-tête / pied de page)</label>
          <div className="ed-bg-scope-row">
            {MASTER_SCOPES.map(({ scope, label }) => (
              <button
                key={scope}
                type="button"
                className={`ed-btn small${masterScope === scope ? ' on' : ''}`}
                onClick={() => setMasterScope(scope)}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            className="ed-select"
            disabled={masterScopeDisabled}
            value={currentMasterId || ''}
            onChange={(e) => setMasterId(e.target.value || null)}
          >
            <option value="">Aucun</option>
            {state.masterSlideIds.map((id) => (
              <option key={id} value={id}>
                {state.slidesById[id]?.nodeLabel || 'Modèle'}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Icône (vue d'ensemble)</label>
          <select
            className="ed-select"
            disabled={!slide || isQa}
            value={slide?.nodeIcon || 'clipboard'}
            onChange={(e) => slide && actions.updateSlideNodeIcon(slide.id, e.target.value)}
          >
            {ICON_KEYS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Libellé (vue d'ensemble)</label>
          <input
            type="text"
            disabled={!slide || isQa}
            value={slide?.nodeLabel || ''}
            onChange={(e) => slide && actions.updateSlideNodeLabel(slide.id, e.target.value)}
          />
        </div>
        <div>
          <label>Thème (couleurs de la présentation)</label>
          <div className="ed-theme-token-list">
            {palette.map((sw) => (
              <div key={sw.name} className="ed-theme-token-row">
                <input
                  type="color"
                  value={safeHex(sw.value)}
                  title={`--${sw.name}`}
                  onChange={(e) => actions.updateThemeToken(sw.name, e.target.value)}
                />
                <span className="ed-theme-token-name">--{sw.name}</span>
              </div>
            ))}
            {palette.length === 0 && <div className="ed-layers-empty">Aucune variable de couleur détectée.</div>}
          </div>
          <button type="button" className="ed-btn small" onClick={() => setShowImport((v) => !v)}>
            <Icon name="palette" /> Importer une palette
          </button>
          {showImport && (
            <div className="ed-palette-import">
              <textarea
                className="ed-palette-import-area"
                placeholder="Collez un bloc CSS (:root{--x:#123456;...} ou toute déclaration de couleurs)…"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
              <button type="button" className="ed-btn small" onClick={handleExtractPalette}>
                Extraire les couleurs
              </button>
              {importedSwatches.length > 0 && (
                <div className="ed-swatch-row">
                  {importedSwatches.map((sw, i) => (
                    <button
                      key={`${sw.name}-${i}`}
                      type="button"
                      className="ed-swatch"
                      style={{ background: sw.value }}
                      title={`Ajouter --${sw.name}: ${sw.value} au thème`}
                      onClick={() => handleAdoptSwatch(sw, i)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
