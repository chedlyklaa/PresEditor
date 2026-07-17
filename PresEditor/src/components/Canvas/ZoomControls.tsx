import { EI } from '../../lib/icons';
import type { CanvasZoomApi } from '../../lib/useCanvasZoom';

function Icon({ name }: { name: string }) {
  return <span dangerouslySetInnerHTML={{ __html: (EI as Record<string, string>)[name] }} />;
}

// A clicked <button> keeps keyboard focus by default — harmless normally,
// but Space is *also* this app's pan-drag modifier (useCanvasZoom.ts), and
// a browser natively re-activates a focused button on Space. Without this,
// clicking any zoom button and then holding Space+drag to pan re-fires
// that button's click mid-gesture instead of panning. preventDefault on
// mousedown suppresses the implicit focus-on-click without affecting the
// click itself.
function suppressFocus(e: React.MouseEvent) {
  e.preventDefault();
}

// Milestone A (editor usability overhaul): the one always-visible zoom
// affordance, bottom-right of the canvas stage — see useCanvasZoom.ts for
// the actual zoom/pan state this only ever reads/triggers.
export default function ZoomControls({ zoom }: { zoom: CanvasZoomApi }) {
  return (
    <div className="ed-zoom-controls">
      <button className="ed-zoom-btn" onMouseDown={suppressFocus} onClick={zoom.zoomOut} title="Dézoomer (Ctrl/Cmd + -)">
        <Icon name="zoomOut" />
      </button>
      <button
        className="ed-zoom-pct"
        onMouseDown={suppressFocus}
        onClick={zoom.zoomToActual}
        title="Zoom 100 % (Ctrl/Cmd + 1)"
      >
        {zoom.zoomPercent}%
      </button>
      <button className="ed-zoom-btn" onMouseDown={suppressFocus} onClick={zoom.zoomIn} title="Zoomer (Ctrl/Cmd + +)">
        <Icon name="zoomIn" />
      </button>
      <button
        className={`ed-zoom-btn ed-zoom-fit${zoom.isFit ? ' on' : ''}`}
        onMouseDown={suppressFocus}
        onClick={zoom.zoomToFit}
        title="Ajuster à l'écran (Ctrl/Cmd + 0)"
      >
        <Icon name="fit" />
      </button>
    </div>
  );
}
