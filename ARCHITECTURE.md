# Architecture

This document goes one level deeper than the [README](./README.md)'s overview: the internal design decisions in each package, why they were made, and where the sharp edges are. Read the README first for the high-level diagrams.

## Contents

- [System boundaries](#system-boundaries)
- [Client: the scene/object model](#client-the-sceneobject-model)
- [Client: one renderer, four consumers](#client-one-renderer-four-consumers)
- [Client: the canvas rebuild problem](#client-the-canvas-rebuild-problem)
- [Client: undo/redo](#client-undoredo)
- [Client: local mode vs. cloud mode](#client-local-mode-vs-cloud-mode)
- [Server: session model](#server-session-model)
- [Server: data model](#server-data-model)
- [Known trade-offs](#known-trade-offs)

## System boundaries

`PresEditor/` (the client) and `server/` (the API) are two independent npm packages with no shared code and no build-time coupling — the only contract between them is the JSON shape of the REST API. This is deliberate: the client is fully usable with the server absent (local mode persists to `localStorage` instead), and the server has zero knowledge of what's inside a project's `json` field beyond "it's some JSON" (`server/src/db.ts`'s `ProjectDoc.json: unknown`). A client-side change to the deck's internal data format never requires touching the server.

## Client: the scene/object model

Historically, a slide "page" was one opaque HTML string — editing meant walking hand-authored markup looking for text to make `contenteditable`. The rewrite that produced the current codebase replaces that with a `Scene`: an ordered list of independently positioned `SceneObject`s (`src/types/scene.ts`). Every object shares transform/style/animation fields (`BaseSceneObject`) and adds its own `data` — a `TextObject`'s is `{ html }`, a `ChartObject`'s is `{ kind, series, title, showValues, donut }`, and so on for ten object types.

The one deliberately different type is `LegacyHtmlObject`. An imported `presentation.html` file's slide content becomes one full-bleed `legacy-html` object per slide on import (`scene/legacyHtmlAdapter.ts`'s `wrapHtmlAsScene`) — this is the backward-compatibility seam that lets an untouched imported deck export back out byte-identical to the original (`unwrapIfPureLegacy`'s fast path in `scene/renderScene.ts`). Editing that content natively (rather than as one opaque HTML blob) is opt-in: the "detach into objects" action (`lib/detachLegacyObject.ts`) measures the *live rendered* DOM to figure out where each visual piece of that blob currently sits, then replaces the one `legacy-html` object with several real `text`/`image` objects at those exact positions — the split is visually a no-op the instant it happens, and only afterward does each piece become independently movable.

## Client: one renderer, four consumers

`scene/renderScene.ts`'s `renderScene(scene, mode, ctx)` is the only function that turns a `Scene` into HTML, and every surface that needs to show a slide calls it rather than maintaining its own copy of "what a slide looks like":

| Caller | Why |
|---|---|
| `Canvas.tsx` | the live editing iframe (`mode: 'edit'`) |
| `lib/thumbnail.ts` | dashboard card previews, rasterized via `foreignObject` → canvas → PNG |
| `lib/exportPresentation.ts` | the standalone exported `.html` file (`mode: 'export'`) |
| `lib/presenterMode.ts` | injected into that same exported file, so it inherits the same content |

`mode` only changes whether editor-only instrumentation (`data-object-id`, `data-object-type`, the `scene-object` selection hook class) is emitted — the visual DOM structure is identical either way, specifically so the editor's preview and the exported file can never visually drift from each other by construction.

**This guarantee has a caller-side gap.** Each of the four call sites still has to independently supply the right *context* — the resolved background cascade, the active master overlay, page-number/count, which section a slide belongs to — as separate arguments. `renderScene()` itself can't enforce that every caller supplies the same context the same way, and every real cross-surface visual bug found in this codebase's history traces back to exactly that: one caller correctly threading a piece of context through, another silently omitting it. The concrete example that motivated writing this down: the real deck engine tints every light-mode slide by its section index (a `--slide-bg` CSS variable set inline per slide in `lib/genericTemplate.js`), but `lib/canvasEditing.js`'s `buildSlideDoc()` — the function that assembles the *editor's* preview document — never replicated that computation, so every light slide silently rendered plain white in the editor regardless of section. The fix threaded a `sectionIndex` parameter through explicitly; the underlying pattern (four call sites, one shared computation each has to remember to redo) is still there and worth watching for in review.

## Client: the canvas rebuild problem

The live canvas is an `<iframe>` with `srcdoc` set to `renderScene()`'s output — a real, separate document, not a portal into the app's own DOM. That's what lets the slide's own CSS run unmodified (`.slide-light`, `.eyebrow`, `.title`, etc. from the deck's stylesheet) without colliding with the editor's own chrome CSS.

The cost is that setting `srcdoc` again *reloads the iframe* — the browser tears down and rebuilds the whole document, including any `contenteditable` element's cursor position and focus. `Canvas.tsx`'s rebuild `useEffect` therefore depends on a deliberately narrow set of signature keys (`slide?.id`, `backgroundKey`, `objectOrderKey`, `transformSignature`, `dataSignature`, `sectionIndex`, …) rather than on the scene's raw content — a keystroke inside a text object updates that object's `data.html` in React state, but none of the tracked signature keys change, so the effect doesn't re-run and the iframe is never rebuilt mid-keystroke. Adding a new dependency to that effect is the single easiest way to reintroduce lost-focus-while-typing bugs; any new per-render context (like `sectionIndex` above) needs its own narrowly-scoped key, not a blanket "just re-run on any state change."

Selection, drag, resize, and rotate (`lib/sceneEditing.ts`) are wired up once per iframe load via native DOM listeners *inside* that iframe's own document — a same-origin iframe reports `MouseEvent.clientX/clientY` in its own internal layout space, which the outer canvas's zoom/pan CSS transform doesn't affect, so none of that math needs to know the current zoom level at all.

## Client: undo/redo

`state/history/historyReducer.ts` wraps the main `reducer.ts` with a past/future stack. Two mechanisms keep it from producing a wall of one-keystroke undo steps:

- **Coalescing** (`undoableActions.ts`'s `coalesceKey`): consecutive actions sharing a key within a short window collapse into a single history entry — every intermediate commit of one drag, or a burst of debounced typing commits for the same object, becomes one undo step instead of dozens.
- **Non-undoable actions** (`SELECT_SLIDE`, `SET_SELECTION`, `TOGGLE_NOTES`, …): pure navigation/UI state that would otherwise pollute the history with no meaningful "content changed" to undo.

## Client: local mode vs. cloud mode

`EditorProvider` is told its `BootSource` by whichever route mounts it (`'local'` or `{ kind: 'cloud', projectId }`) — everything downstream (the reducer, `renderScene`, undo history, export) behaves identically either way; only *what gets loaded on boot and where a save goes* differs (`lib/storage.js` + `localStorage` for local mode, `lib/apiClient.ts` + the Fastify API for cloud mode). A local-mode project can be pushed to the cloud later (`saveLocalCopyToCloud` in `EditorContext.tsx`) without any id remapping, since a project's id is client-generated (`lib/id.js`'s `uid('doc')`) up front rather than assigned by the server on first save.

## Server: session model

Sessions are opaque, random 256-bit tokens (`crypto.randomBytes(32)`, `server/src/auth/session.ts`), not JWTs — the token itself carries no information, it's just a lookup key into a `sessions` collection. That trade-off means every authenticated request costs one extra MongoDB read (`resolveSession`), but revocation is trivial (delete the session document) and there's nothing to verify a signature on, which is why the `COOKIE_SECRET` configuration value currently goes unused — cookies aren't signed because the token isn't meaningful without the corresponding server-side row anyway. A stale session is cleaned up two ways: an explicit expiry check on every lookup, and belt-and-suspenders a MongoDB TTL index on `expiresAt` (`db.ts`) that garbage-collects expired sessions without a cron job.

## Server: data model

Three collections, no ORM (`server/src/db.ts`):

```
users     { _id, email (unique index), passwordHash, displayName, createdAt }
sessions  { _id: <random token>, userId, createdAt, expiresAt (TTL index) }
projects  { _id: <client-generated id>, ownerId, title, json, thumbnail, createdAt, updatedAt }
```

Every project query in `routes/projects.ts` filters by `{ ownerId: req.userId }` at the database level, including reads — a project id that exists but belongs to a different user simply never matches the query and returns the same 404 as one that doesn't exist at all. There is no separate "is this mine?" check to remember to add to a new route; the ownership filter *is* the query.

## Known trade-offs

- **No automated tests.** Every regression found in this codebase's history so far was caught by hand, not by a suite — see the project's audit notes for the concrete test plan this implies.
- **Four render call sites, one shared function, caller-supplied context** — see [Client: one renderer, four consumers](#client-one-renderer-four-consumers) above. Workable today at this codebase's size; worth reconsidering (e.g. a single typed "render request" object every caller builds the same way) if a fifth consumer shows up.
- **Iframe-per-slide-load canvas.** Correct and necessary for CSS isolation, but means the rebuild-dependency-array discipline in [Client: the canvas rebuild problem](#client-the-canvas-rebuild-problem) has to be maintained by convention, not enforced by the type system — nothing stops a future change from adding a dependency that silently reintroduces a lost-focus bug.
