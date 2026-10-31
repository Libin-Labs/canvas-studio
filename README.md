# @lp-labs/canvas-studio

`@lp-labs/canvas-studio` is an original, dependency-free 2D scene editor for a browser `HTMLCanvasElement`. It has its own typed scene model, renderer, geometry, selection, and history. It is not a Fabric.js integration, compatibility layer, or drop-in replacement.

The package has no runtime or peer dependencies. It publishes ESM and CommonJS builds plus TypeScript declarations. Importing the package does not access `window`, `document`, or other browser globals; instantiate `CanvasStudio` only when a canvas is available.

## Install and create an editor

```sh
npm install @lp-labs/canvas-studio
```

```html
<canvas id="artboard" class="artboard" aria-label="Illustration canvas"></canvas>
<script type="module" src="/app.js"></script>
```

```css
.artboard {
  display: block;
  width: min(100%, 960px);
  height: 600px;
  border: 1px solid #d1d5db;
  touch-action: none;
}
```

```ts
import { CanvasStudio } from "@lp-labs/canvas-studio";

const canvas = document.querySelector<HTMLCanvasElement>("#artboard");
if (!canvas) throw new Error("Missing #artboard canvas");

const editor = new CanvasStudio(canvas, {
  background: "#f8fafc",
  onSelectionChange(ids) {
    selectionStatus.textContent = ids.length ? `${ids.length} selected` : "Nothing selected";
  },
  onChange(snapshot) {
    saveDraft(snapshot);
  },
  onError(error) {
    showError(error.message);
  },
});

const cardId = editor.addObject({
  type: "rect", x: 80, y: 80, width: 240, height: 140,
  rotation: 0, opacity: 1, visible: true, locked: false,
  fill: "#dbeafe", stroke: "#2563eb", strokeWidth: 2, radius: 12,
});
editor.addObject({
  type: "text", x: 110, y: 120, width: 190, height: 40,
  rotation: 0, opacity: 1, visible: true, locked: false,
  text: "Canvas Studio", fontSize: 24, fontFamily: "sans-serif",
  fontWeight: "600", fill: "#172554",
});
editor.setSelection([cardId]);
```

An object requires finite `x`, `y`, `width`, `height`, and `rotation`; non-negative dimensions; an `opacity` in `[0, 1]`; and `visible` and `locked` flags. An omitted ID is generated. An ID must be unique within the current scene. Fill and stroke are CSS canvas paint strings. Missing fill is not painted; a missing stroke uses the renderer's default dark stroke on stroked geometry. `visible: false`, `opacity: 0`, and `locked: true` are supported.

## Scene object models

All models include `id`, `x`, `y`, `width`, `height`, `rotation` (radians, clockwise in canvas coordinates), `opacity`, `visible`, and `locked`. `groupId` is optional and is assigned by grouping. `fill`, `stroke`, and `strokeWidth` are optional.

* `RectObject`: `type: "rect"`; optional `radius`. The current renderer draws square corners; `radius` is retained in the scene model for consumers but does not round the rectangle.
* `EllipseObject`: `type: "ellipse"`.
* `LineObject`: `type: "line"`; `x, y` to `x + width, y + height`.
* `PathObject`: `type: "path"`; `points` are local to the object's top-left; optional `closed`. Closed paths with a fill are filled.
* `TextObject`: `type: "text"`; `text`, positive `fontSize`, `fontFamily`, and optional `fontWeight`, `textAlign`, and `lineHeight`. Text is rendered as lines; there is no text editing UI, glyph shaping engine, or automatic measured bounds.
* `ImageObject`: `type: "image"`; `src` and optional `crossOrigin`. `addObject` accepts an image scene record immediately; use `addImage` when the caller wants an asynchronous load result and natural image dimensions.

```ts
const pathId = editor.addObject({
  type: "path", x: 360, y: 90, width: 120, height: 100,
  rotation: 0, opacity: 1, visible: true, locked: false,
  points: [{ x: 0, y: 80 }, { x: 40, y: 0 }, { x: 120, y: 80 }],
  closed: true, fill: "#dcfce7", stroke: "#15803d", strokeWidth: 3,
});
const imageId = await editor.addImage("/assets/photo.png", 520, 80, {
  crossOrigin: "anonymous",
});
```

`addImage(src, x, y, options?)` resolves to the new ID after loading, chooses natural dimensions for omitted dimensions, and rejects if loading fails, the image is removed, its source/CORS mode is updated, or the editor is disposed before loading finishes. If only one dimension is given, the other uses the image's natural dimension (it is not aspect-ratio-scaled). `crossOrigin` is set before assigning `src`; configure the image host's CORS response as well. Loading cancellation prevents stale completion from changing the scene.

## Selection, transforms, and controls

The editor supports reverse-layer-order hit testing with rotated shape geometry. Click to select, Shift/Ctrl/Command-click to toggle selection, drag selected objects to move them, and drag handles around a single selected object to resize or rotate it. Dragging a grouped member selects its group. Multi-selection can be moved together; resize/rotate handles are shown only for a single selection. Locked objects cannot be hit-selected through the canvas or moved by keyboard/drag. API selection may include locked objects, but transforms still leave locked members stationary.

* `setSelection(ids)` replaces the selection; unknown IDs throw.
* `selectAll()` selects visible unlocked objects.
* `groupSelection(groupId?)` assigns one shared group ID to at least two selected objects and returns it. This is a selection group, not a nested composite object.
* `ungroupSelection()` clears the group ID on selected objects.
* `bringToFront(id)` and `sendToBack(id)` change layer order.
* `panBy(dx, dy)`, `setViewport(viewport)`, and `zoomAt(screenPoint, factor)` control the view.
* Ctrl/Command+wheel zooms at the pointer; Shift+wheel pans. Middle/right drag or Space+left-drag pans.
* Arrow keys nudge selected objects by one world unit; Shift+Arrow nudges by ten. Ctrl/Command+A selects all, Delete/Backspace removes selection, Escape clears selection, Ctrl/Command+Z undoes, Ctrl/Command+Shift+Z or Ctrl/Command+Y redoes.
* The canvas is made keyboard-focusable if needed and receives a default `aria-label` only when it has none. Provide a meaningful label and keyboard-accessible external controls/status in your application. Touch input uses Pointer Events; set `touch-action: none` on the canvas if the browser should not scroll while editing.

`CanvasStudioOptions` supports `width` and `height` (logical CSS-pixel dimensions), `background` (`"#ffffff"`), `maxHistory` (`100` prior changes), `minZoom` (`0.1`), `maxZoom` (`8`), `selectionColor` (`"#2563eb"`), and callbacks `onSelectionChange(ids)`, `onChange(snapshot)`, and `onError(error)`. When dimensions are omitted, the constructor uses positive `clientWidth`/`clientHeight`, then intrinsic dimensions, then 800 × 600. Backing dimensions account for the current device-pixel ratio; call `resize(width?, height?)` after layout or device-pixel-ratio changes. `resize()` without arguments reads the current canvas bounding rectangle. It does not install a `ResizeObserver`.

## API reference

### `CanvasStudio`

`new CanvasStudio(canvas, options?)` requires a canvas with a 2D context. Construction throws for a missing canvas/context or invalid dimensions. Public methods throw after `dispose()`, except `dispose()` itself, which is idempotent.

* Read-only getters: `canvas`, `objects`, `selection`, `viewport`, `background`, `canUndo`, and `canRedo`. `objects` returns copies, not live scene records.
* Scene changes: `addObject(input): id`, `addImage(src, x, y, options?): Promise<id>`, `updateObject(id, changes)`, `removeObject(id): boolean`, `clear()`, `setBackground(color)`, and `bringToFront(id)` / `sendToBack(id)`. Updating an image's `src` or `crossOrigin` cancels its old request and starts a fresh load. Missing IDs in update/layer methods throw; removing a missing ID returns `false`. A duplicate ID throws.
* Selection: `setSelection(ids)`, `selectAll()`, `groupSelection(groupId?)`, `ungroupSelection()`.
* View and canvas: `setViewport({x, y, zoom})`, `panBy(dx, dy)`, `zoomAt(screenPoint, factor)`, `resize(width?, height?)`, and `render()`. Zoom defaults are 0.1 to 8. `setViewport` rejects out-of-range zoom. Screen points are CSS-pixel coordinates relative to the canvas content box.
* Persistence: `getSnapshot()` returns a deeply frozen scene snapshot; `serialize(space?)` returns JSON; `loadJSON(json)` and `loadSnapshot(value)` validate before replacing the scene. The snapshot format is version 1 and includes background, viewport, object order, and selection. Invalid JSON or data throws `TypeError`; zoom outside this instance's configured range throws `RangeError`; failed validation does not partially load.
* History: `undo(): boolean` and `redo(): boolean`. Consecutive pointer movement is one history entry; keyboard nudge and deletion are grouped per key action. `maxHistory` limits retained edits (initial state plus at most that many undoable entries).
* Export and cleanup: `exportPNG({pixelRatio?, background?}?): Promise<Blob>` renders the scene without selection UI or viewport pan/zoom. `pixelRatio` defaults to 1 and must be greater than 0 and at most 8. Pending/unavailable image assets, a missing browser document/context, or a tainted canvas reject with an error; CORS-related failures include a diagnostic hint. `dispose()` removes listeners, stops scheduled drawing, releases active pointer capture, cancels pending image loads, and releases image references.

`onChange` runs after scene changes and receives a frozen snapshot. `onSelectionChange` receives a copied array. Neither callback is called for no-op selection-independent view operations. Callback exceptions are not swallowed. `onError` is used for asynchronous image failures and caught pointer-capture/PNG export errors; `addImage` also rejects its own load error.

### Pure geometry and serialization

These functions have no DOM requirement and can be used in Node:

* `rotatePoint(point, center, radians): Point`
* `objectCenter(object): Point`
* `objectBounds(object): Bounds` returns the axis-aligned bounds after rotation.
* `containsPoint(object, point, tolerance?)` and `hitTest(objects, point, tolerance?)` test geometry in world coordinates; `hitTest` returns the topmost visible hit or `undefined`.
* `distanceToSegment(point, start, end): number`
* `normalizeRotation(radians): number` normalizes to `[0, 2π)`.
* `worldToScreen(point, viewport)` and `screenToWorld(point, viewport)` convert coordinates using `screen = (world + viewport offset) × zoom`.
* `validateSnapshot(value): value is StudioSnapshot`, `parseSnapshot(json): StudioSnapshot`, `serializeSnapshot(snapshot, space?)`, and `cloneObjects(objects)`. Validation requires version 1, finite geometry, valid object records, unique non-empty IDs, positive zoom, and selection IDs that exist. `parseSnapshot` throws `TypeError` for malformed JSON or invalid data.

### Rendering helpers and history

`renderScene(context, width, height, objects, options)` paints a scene with background, viewport, optional pixel ratio, image map, and selection overlay. `renderExport(context, width, height, objects, background, images?, pixelRatio?)` paints without selection/viewport transforms. `getSelectionBounds(objects)` returns the combined rotated AABB or `undefined` for empty input. Both renderer functions require a compatible 2D context.

`History<T>(initial, clone, limit?)` is the bounded generic transaction history used by the editor. Its `canUndo`, `canRedo`, and `inTransaction` getters accompany `begin()`, `commit(value)`, `cancel()`, `record(value)`, `undo()`, and `redo()`. Nested transactions, undo/redo during a transaction, and recording during a transaction throw. The caller-supplied clone function is used for stored and returned values.

The package's runtime exports are `CanvasStudio`, `History`, `containsPoint`, `distanceToSegment`, `hitTest`, `normalizeRotation`, `objectBounds`, `objectCenter`, `rotatePoint`, `screenToWorld`, `worldToScreen`, `cloneObjects`, `parseSnapshot`, `serializeSnapshot`, `validateSnapshot`, `getSelectionBounds`, `renderExport`, and `renderScene`. Type exports include `BaseObject`, `Bounds`, `CanvasStudioOptions`, `EllipseObject`, `ExportOptions`, `HitArea`, `ImageObject`, `LineObject`, `ObjectInput`, `ObjectUpdate`, `PathObject`, `Point`, `PointerTarget`, `RectObject`, `RenderOptions`, `StudioObject`, `StudioSnapshot`, `TextObject`, and `Viewport`.

## Boundaries, integration, and safety

Snapshots are plain versioned JSON scene data and do not embed binary image contents. Keep persistence storage, migrations, autosave policy, and asset permissions in your application. Restore a snapshot with `loadSnapshot` or `loadJSON`; call `dispose()` when the owning view is removed.

This is deliberately a small editor rather than full illustration software. It has no free-draw tool, text editing UI, clipboard, filters, masks, gradients, SVG import, nested groups, collision solver, or full Fabric-category parity. Text metrics and line wrapping are basic canvas operations. `radius` is retained but not drawn. Rendering and PNG export depend on browser canvas behavior; no real-browser guarantee or accessibility certification is implied. Verify target browsers, fonts, image CORS behavior, and output quality in your own application.

Only load image URLs that your application trusts. Cross-origin pixels can taint export; `crossOrigin: "anonymous"` is not a bypass for server CORS policy. Avoid persisting untrusted JSON without your own limits and asset policy; the built-in validator enforces the scene shape but not application-specific object counts, URL allow-lists, or maximum text/path sizes. The renderer does not execute content from scene records as code.

This is an original implementation with no copied Fabric.js source and no Fabric.js dependency. The package makes no claim of certification, affiliation, or compatibility with Fabric.js.

## License

[MIT](./LICENSE).

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
