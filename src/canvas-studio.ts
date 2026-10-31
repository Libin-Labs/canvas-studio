import { History } from './history.js';
import {
  hitTest,
  normalizeRotation,
  objectCenter,
  rotatePoint,
  screenToWorld,
} from './geometry.js';
import {
  cloneObjects,
  parseSnapshot,
  serializeSnapshot,
  validateSnapshot,
} from './serialization.js';
import { renderExport, renderScene } from './renderer.js';
import type {
  CanvasStudioOptions,
  ExportOptions,
  HitArea,
  ObjectInput,
  ObjectUpdate,
  Point,
  PointerTarget,
  StudioObject,
  StudioSnapshot,
  Viewport,
} from './types.js';

type PointerState = {
  pointerId: number;
  start: Point;
  startScreen: Point;
  target: PointerTarget | undefined;
  startObjects: StudioObject[];
  startViewport: Viewport;
  startSelection: string[];
  startObject: StudioObject | undefined;
  moved: boolean;
  panning: boolean;
  spacePan: boolean;
};

type InternalState = {
  objects: StudioObject[];
  viewport: Viewport;
  background: string;
  selection: string[];
};

const cloneState = (state: InternalState): InternalState => ({
  objects: cloneObjects(state.objects),
  viewport: { ...state.viewport },
  background: state.background,
  selection: [...state.selection],
});
const finite = (value: number, name: string): void => {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite number.`);
};
const makeId = (): string => {
  const cryptoObject = globalThis.crypto;
  return cryptoObject && typeof cryptoObject.randomUUID === 'function'
    ? cryptoObject.randomUUID()
    : `canvas-studio-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};
const copyObject = (object: StudioObject): StudioObject =>
  ({
    ...object,
    ...(object.type === 'path' ? { points: object.points.map((point) => ({ ...point })) } : {}),
  }) as StudioObject;
const wrapError = (message: string, cause: unknown): Error => {
  const error = new Error(message);
  if (cause !== undefined) (error as Error & { cause?: unknown }).cause = cause;
  return error;
};

export class CanvasStudio {
  readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly options: CanvasStudioOptions;
  private readonly history: History<InternalState>;
  private state: InternalState;
  private readonly loadedImages = new Map<string, CanvasImageSource>();
  private readonly pendingImages = new Map<string, HTMLImageElement>();
  private readonly imageRejectors = new Map<string, (error: Error) => void>();
  private readonly imageCleanup = new Map<string, () => void>();
  private frame: number | ReturnType<typeof setTimeout> | undefined;
  private frameIsTimeout = false;
  private pointer: PointerState | undefined;
  private spaceDown = false;
  private disposed = false;
  private logicalWidth: number;
  private logicalHeight: number;
  private readonly dpr: () => number;

  constructor(canvas: HTMLCanvasElement, options: CanvasStudioOptions = {}) {
    if (!canvas || typeof canvas.getContext !== 'function')
      throw new TypeError('CanvasStudio requires an HTMLCanvasElement.');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('A 2D canvas context is required.');
    this.canvas = canvas;
    this.context = context;
    this.options = options;
    this.logicalWidth =
      options.width ?? (canvas.clientWidth > 0 ? canvas.clientWidth : canvas.width || 800);
    this.logicalHeight =
      options.height ?? (canvas.clientHeight > 0 ? canvas.clientHeight : canvas.height || 600);
    if (!(this.logicalWidth > 0) || !(this.logicalHeight > 0))
      throw new RangeError('Canvas dimensions must be positive.');
    const view = canvas.ownerDocument?.defaultView;
    this.dpr = () => Math.max(1, view?.devicePixelRatio ?? 1);
    const minZoom = options.minZoom ?? 0.1;
    const maxZoom = options.maxZoom ?? 8;
    if (
      !Number.isFinite(minZoom) ||
      !Number.isFinite(maxZoom) ||
      minZoom <= 0 ||
      maxZoom < minZoom
    ) {
      throw new RangeError('Zoom limits must be positive finite values with maxZoom >= minZoom.');
    }
    this.state = {
      objects: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      background: options.background ?? '#ffffff',
      selection: [],
    };
    this.history = new History(this.state, cloneState, options.maxHistory ?? 100);
    canvas.tabIndex = canvas.tabIndex >= 0 ? canvas.tabIndex : 0;
    if (!canvas.getAttribute('aria-label'))
      canvas.setAttribute('aria-label', 'Canvas Studio editor');
    this.resizeBackingStore();
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('lostpointercapture', this.onPointerCancel);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('keydown', this.onKeyDown);
    canvas.addEventListener('keyup', this.onKeyUp);
    canvas.addEventListener('contextmenu', this.onContextMenu);
    this.render();
  }

  private cancelPointerState(): void {
    if (!this.pointer) return;
    const pointer = this.pointer;
    this.pointer = undefined;
    try {
      this.canvas.releasePointerCapture(pointer.pointerId);
    } catch (error) {
      this.reportError(wrapError('Unable to release pointer capture.', error));
    }
    if (this.history.inTransaction) this.history.cancel();
    this.state.objects = cloneObjects(pointer.startObjects);
    this.state.viewport = { ...pointer.startViewport };
    this.state.selection = [...pointer.startSelection];
    this.scheduleRender();
  }

  get objects(): readonly StudioObject[] {
    this.assertActive();
    return cloneObjects(this.state.objects);
  }
  get selection(): readonly string[] {
    this.assertActive();
    return [...this.state.selection];
  }
  get viewport(): Viewport {
    this.assertActive();
    return { ...this.state.viewport };
  }
  get background(): string {
    this.assertActive();
    return this.state.background;
  }
  get canUndo(): boolean {
    this.assertActive();
    return this.history.canUndo;
  }
  get canRedo(): boolean {
    this.assertActive();
    return this.history.canRedo;
  }

  addObject(input: ObjectInput): string {
    this.assertActive();
    const id = input.id ?? makeId();
    if (this.state.objects.some((object) => object.id === id))
      throw new Error(`Object id "${id}" already exists.`);
    const object = { ...input, id } as StudioObject;
    if (
      !validateSnapshot({
        version: 1,
        background: this.state.background,
        viewport: this.state.viewport,
        objects: [...this.state.objects, object],
        selection: [],
      })
    ) {
      throw new TypeError('Object is not a valid canvas-studio object.');
    }
    this.state.objects = [...this.state.objects, copyObject(object)];
    this.changed();
    if (object.type === 'image') this.loadImage(object);
    return id;
  }

  addImage(
    src: string,
    x: number,
    y: number,
    options: Readonly<{
      width?: number;
      height?: number;
      crossOrigin?: 'anonymous' | 'use-credentials';
      id?: string;
    }> = {},
  ): Promise<string> {
    this.assertActive();
    if (typeof src !== 'string' || src.length === 0)
      return Promise.reject(new TypeError('Image src must be a non-empty string.'));
    finite(x, 'x');
    finite(y, 'y');
    const id = options.id ?? makeId();
    const object: StudioObject = {
      type: 'image',
      id,
      src,
      x,
      y,
      width: options.width ?? 1,
      height: options.height ?? 1,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      ...(options.crossOrigin ? { crossOrigin: options.crossOrigin } : {}),
    };
    try {
      if (this.state.objects.some((candidate) => candidate.id === id))
        throw new Error(`Object id "${id}" already exists.`);
      if (
        !validateSnapshot({
          version: 1,
          background: this.state.background,
          viewport: this.state.viewport,
          objects: [...this.state.objects, object],
          selection: [],
        })
      ) {
        throw new TypeError('Image object options are invalid.');
      }
      this.state.objects = [...this.state.objects, object];
      this.changed();
    } catch (error) {
      return Promise.reject(error);
    }
    const view = this.canvas.ownerDocument?.defaultView;
    if (!view?.Image) {
      this.removeObject(id);
      return Promise.reject(new Error('Image loading requires a browser Image implementation.'));
    }
    const image = new view.Image();
    if (options.crossOrigin) image.crossOrigin = options.crossOrigin;
    this.pendingImages.set(id, image);
    return new Promise((resolve, reject) => {
      const current = this.state.objects.find((candidate) => candidate.id === id);
      if (!current || current.type !== 'image') {
        reject(new Error('Image was removed before it loaded.'));
        return;
      }
      const onLoad = (): void => {
        if (this.disposed || this.pendingImages.get(id) !== image) {
          reject(new Error('Image loading was cancelled.'));
          return;
        }
        this.imageCleanup.get(id)?.();
        this.imageCleanup.delete(id);
        this.imageRejectors.delete(id);
        this.loadedImages.set(id, image);
        this.pendingImages.delete(id);
        const index = this.state.objects.findIndex((candidate) => candidate.id === id);
        const latest = this.state.objects[index];
        if (latest?.type === 'image') {
          this.state.objects[index] = {
            ...latest,
            width: options.width ?? (image.naturalWidth || image.width),
            height: options.height ?? (image.naturalHeight || image.height),
          };
          if (!this.history.inTransaction) this.history.record(this.state);
          this.notifyChange();
        }
        this.scheduleRender();
        resolve(id);
      };
      const onError = (): void => {
        if (this.pendingImages.get(id) === image) {
          this.pendingImages.delete(id);
          this.imageCleanup.get(id)?.();
          this.imageCleanup.delete(id);
          this.imageRejectors.delete(id);
        }
        const error = new Error(
          `Unable to load image "${src}". Check the URL and image CORS policy.`,
        );
        reject(error);
        this.removeObject(id);
        this.reportError(error);
      };
      image.addEventListener('load', onLoad, { once: true });
      image.addEventListener('error', onError, { once: true });
      this.imageCleanup.set(id, () => {
        image.removeEventListener('load', onLoad);
        image.removeEventListener('error', onError);
      });
      this.imageRejectors.set(id, (error) => reject(error));
      image.src = src;
    });
  }

  updateObject(id: string, changes: ObjectUpdate): void {
    this.assertActive();
    const index = this.objectIndex(id);
    const current = this.state.objects[index];
    const next = { ...current, ...changes, id, type: current.type } as StudioObject;
    if (
      !validateSnapshot({
        version: 1,
        background: this.state.background,
        viewport: this.state.viewport,
        objects: this.state.objects.map((object, i) => (i === index ? next : object)),
        selection: this.state.selection,
      })
    ) {
      throw new TypeError('Updated object is not valid.');
    }
    const reloadImage =
      current.type === 'image' &&
      next.type === 'image' &&
      (current.src !== next.src || current.crossOrigin !== next.crossOrigin);
    if (reloadImage) this.cancelImage(id);
    this.state.objects[index] = copyObject(next);
    this.changed();
    if (reloadImage && next.type === 'image') this.loadImage(next);
  }

  removeObject(id: string): boolean {
    this.assertActive();
    const index = this.state.objects.findIndex((object) => object.id === id);
    if (index < 0) return false;
    this.state.objects.splice(index, 1);
    this.state.selection = this.state.selection.filter((selected) => selected !== id);
    this.cancelImage(id);
    this.changed();
    this.options.onSelectionChange?.([...this.state.selection]);
    return true;
  }

  clear(): void {
    this.assertActive();
    for (const id of this.state.objects.map((object) => object.id)) this.cancelImage(id);
    this.state.objects = [];
    this.state.selection = [];
    this.changed();
    this.options.onSelectionChange?.([...this.state.selection]);
  }

  setSelection(ids: readonly string[]): void {
    this.assertActive();
    const known = new Set(this.state.objects.map((object) => object.id));
    const selection = [...new Set(ids)];
    if (selection.some((id) => !known.has(id)))
      throw new Error('Selection contains an unknown object id.');
    this.state.selection = selection;
    this.notifySelection();
    this.scheduleRender();
  }

  selectAll(): void {
    this.setSelection(
      this.state.objects
        .filter((object) => object.visible && !object.locked)
        .map((object) => object.id),
    );
  }

  groupSelection(groupId = makeId()): string {
    this.assertActive();
    if (this.state.selection.length < 2)
      throw new Error('Select at least two objects to group them.');
    if (typeof groupId !== 'string' || groupId.length === 0)
      throw new TypeError('groupId must be a non-empty string.');
    for (const id of this.state.selection) {
      const index = this.objectIndex(id);
      this.state.objects[index] = { ...this.state.objects[index], groupId } as StudioObject;
    }
    this.changed();
    return groupId;
  }

  ungroupSelection(): void {
    this.assertActive();
    const selected = new Set(this.state.selection);
    this.state.objects = this.state.objects.map((object) => {
      if (!selected.has(object.id) || object.groupId === undefined) return object;
      const { groupId: _groupId, ...rest } = object;
      return rest as StudioObject;
    });
    this.changed();
  }

  bringToFront(id: string): void {
    this.reorder(id, this.state.objects.length - 1);
  }
  sendToBack(id: string): void {
    this.reorder(id, 0);
  }

  setBackground(background: string): void {
    this.assertActive();
    if (typeof background !== 'string') throw new TypeError('Background must be a string.');
    this.state.background = background;
    this.changed();
  }

  setViewport(viewport: Viewport): void {
    this.assertActive();
    finite(viewport.x, 'viewport.x');
    finite(viewport.y, 'viewport.y');
    finite(viewport.zoom, 'viewport.zoom');
    const min = this.options.minZoom ?? 0.1;
    const max = this.options.maxZoom ?? 8;
    if (viewport.zoom < min || viewport.zoom > max)
      throw new RangeError(`Zoom must be between ${min} and ${max}.`);
    this.state.viewport = { ...viewport };
    this.scheduleRender();
  }

  panBy(dx: number, dy: number): void {
    finite(dx, 'dx');
    finite(dy, 'dy');
    this.setViewport({
      ...this.state.viewport,
      x: this.state.viewport.x + dx,
      y: this.state.viewport.y + dy,
    });
  }

  zoomAt(screenPoint: Point, factor: number): void {
    this.assertActive();
    finite(screenPoint.x, 'screenPoint.x');
    finite(screenPoint.y, 'screenPoint.y');
    if (!(factor > 0) || !Number.isFinite(factor))
      throw new RangeError('Zoom factor must be a positive finite number.');
    const before = screenToWorld(screenPoint, this.state.viewport);
    const min = this.options.minZoom ?? 0.1;
    const max = this.options.maxZoom ?? 8;
    const zoom = Math.max(min, Math.min(max, this.state.viewport.zoom * factor));
    this.state.viewport = {
      x: screenPoint.x / zoom - before.x,
      y: screenPoint.y / zoom - before.y,
      zoom,
    };
    this.scheduleRender();
  }

  resize(width?: number, height?: number): void {
    this.assertActive();
    const rect = this.canvas.getBoundingClientRect();
    const nextWidth = width ?? rect.width;
    const nextHeight = height ?? rect.height;
    if (
      !(nextWidth > 0) ||
      !(nextHeight > 0) ||
      !Number.isFinite(nextWidth) ||
      !Number.isFinite(nextHeight)
    ) {
      throw new RangeError('Canvas dimensions must be positive finite numbers.');
    }
    this.logicalWidth = nextWidth;
    this.logicalHeight = nextHeight;
    this.resizeBackingStore();
    this.scheduleRender();
  }

  getSnapshot(): StudioSnapshot {
    this.assertActive();
    const objects = cloneObjects(this.state.objects).map((object) => {
      if (object.type === 'path') {
        object.points.forEach((point) => Object.freeze(point));
        Object.freeze(object.points);
      }
      return Object.freeze(object);
    });
    return Object.freeze({
      version: 1,
      background: this.state.background,
      viewport: Object.freeze({ ...this.state.viewport }),
      objects: Object.freeze(objects),
      selection: Object.freeze([...this.state.selection]),
    });
  }

  serialize(space?: number): string {
    return serializeSnapshot(this.getSnapshot(), space);
  }

  loadJSON(json: string): void {
    this.loadSnapshot(parseSnapshot(json));
  }

  loadSnapshot(snapshot: unknown): void {
    this.assertActive();
    if (!validateSnapshot(snapshot)) throw new TypeError('Invalid canvas-studio snapshot.');
    if (
      snapshot.viewport.zoom < (this.options.minZoom ?? 0.1) ||
      snapshot.viewport.zoom > (this.options.maxZoom ?? 8)
    ) {
      throw new RangeError("Snapshot zoom is outside this editor's configured zoom limits.");
    }
    this.cancelPointerState();
    for (const id of this.state.objects.map((object) => object.id)) this.cancelImage(id);
    this.state = {
      objects: cloneObjects(snapshot.objects),
      viewport: { ...snapshot.viewport },
      background: snapshot.background,
      selection: [...snapshot.selection],
    };
    for (const object of this.state.objects) if (object.type === 'image') this.loadImage(object);
    this.history.record(this.state);
    this.notifySelection();
    this.scheduleRender();
  }

  undo(): boolean {
    this.assertActive();
    this.cancelPointerState();
    const state = this.history.undo();
    if (!state) return false;
    this.restoreState(state);
    return true;
  }

  redo(): boolean {
    this.assertActive();
    this.cancelPointerState();
    const state = this.history.redo();
    if (!state) return false;
    this.restoreState(state);
    return true;
  }

  async exportPNG(options: ExportOptions = {}): Promise<Blob> {
    this.assertActive();
    const pixelRatio = options.pixelRatio ?? 1;
    if (!Number.isFinite(pixelRatio) || pixelRatio <= 0 || pixelRatio > 8)
      throw new RangeError('pixelRatio must be greater than 0 and at most 8.');
    if (
      this.state.objects.some(
        (object) => object.type === 'image' && !this.loadedImages.has(object.id),
      )
    ) {
      throw new Error('PNG export requires every scene image to finish loading successfully.');
    }
    const document = this.canvas.ownerDocument;
    if (!document?.createElement) throw new Error('PNG export requires a browser document.');
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = Math.ceil(this.logicalWidth * pixelRatio);
    exportCanvas.height = Math.ceil(this.logicalHeight * pixelRatio);
    const context = exportCanvas.getContext('2d');
    if (!context) throw new Error('PNG export requires a 2D canvas context.');
    try {
      renderExport(
        context,
        this.logicalWidth,
        this.logicalHeight,
        this.state.objects,
        options.background ?? this.state.background,
        this.loadedImages,
        pixelRatio,
      );
      const blob = await new Promise<Blob>((resolve, reject) => {
        exportCanvas.toBlob((result) => {
          if (result) resolve(result);
          else reject(new Error('Canvas export returned no image data.'));
        }, 'image/png');
      });
      return blob;
    } catch (cause) {
      const error = wrapError(
        'PNG export failed. A cross-origin image may have tainted the canvas; use an image host that permits CORS or omit that image.',
        cause,
      );
      this.reportError(error);
      throw error;
    }
  }

  render(): void {
    this.assertActive();
    renderScene(this.context, this.logicalWidth, this.logicalHeight, this.state.objects, {
      background: this.state.background,
      viewport: this.state.viewport,
      pixelRatio: this.dpr(),
      selection: this.state.selection,
      ...(this.options.selectionColor ? { selectionColor: this.options.selectionColor } : {}),
      images: this.loadedImages,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelScheduledRender();
    if (this.pointer) {
      try {
        this.canvas.releasePointerCapture(this.pointer.pointerId);
      } catch (error) {
        this.reportError(wrapError('Unable to release pointer capture during disposal.', error));
      }
      if (this.history.inTransaction) this.history.cancel();
      this.pointer = undefined;
    }
    for (const id of [...this.pendingImages.keys()]) this.cancelImage(id);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
    this.canvas.removeEventListener('lostpointercapture', this.onPointerCancel);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('keydown', this.onKeyDown);
    this.canvas.removeEventListener('keyup', this.onKeyUp);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.loadedImages.clear();
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('CanvasStudio has been disposed.');
  }

  private objectIndex(id: string): number {
    const index = this.state.objects.findIndex((object) => object.id === id);
    if (index < 0) throw new Error(`Object "${id}" does not exist.`);
    return index;
  }

  private resizeBackingStore(): void {
    const ratio = this.dpr();
    this.canvas.width = Math.round(this.logicalWidth * ratio);
    this.canvas.height = Math.round(this.logicalHeight * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  private changed(): void {
    if (!this.history.inTransaction) this.history.record(this.state);
    this.notifyChange();
    this.scheduleRender();
  }

  private notifyChange(): void {
    if (this.options.onChange) this.options.onChange(this.getSnapshot());
  }

  private notifySelection(): void {
    this.options.onSelectionChange?.([...this.state.selection]);
    this.notifyChange();
  }

  private reportError(error: Error): void {
    this.options.onError?.(error);
  }

  private restoreState(state: InternalState): void {
    for (const id of [...this.pendingImages.keys()]) this.cancelImage(id);
    this.state = cloneState(state);
    this.loadedImages.clear();
    for (const object of this.state.objects) if (object.type === 'image') this.loadImage(object);
    this.notifySelection();
    this.scheduleRender();
  }

  private reorder(id: string, target: number): void {
    this.assertActive();
    const index = this.objectIndex(id);
    const [object] = this.state.objects.splice(index, 1);
    this.state.objects.splice(Math.min(target, this.state.objects.length), 0, object);
    this.changed();
  }

  private scheduleRender(): void {
    if (this.disposed || this.frame !== undefined) return;
    const view = this.canvas.ownerDocument?.defaultView;
    if (view?.requestAnimationFrame) {
      this.frameIsTimeout = false;
      this.frame = view.requestAnimationFrame(() => {
        this.frame = undefined;
        if (!this.disposed) this.render();
      });
    } else {
      this.frameIsTimeout = true;
      this.frame = setTimeout(() => {
        this.frame = undefined;
        if (!this.disposed) this.render();
      }, 0);
    }
  }

  private cancelScheduledRender(): void {
    if (this.frame === undefined) return;
    const view = this.canvas.ownerDocument?.defaultView;
    if (this.frameIsTimeout) clearTimeout(this.frame as ReturnType<typeof setTimeout>);
    else view?.cancelAnimationFrame?.(this.frame as number);
    this.frame = undefined;
  }

  private cancelImage(id: string): void {
    const image = this.pendingImages.get(id);
    if (image) {
      this.pendingImages.delete(id);
      this.imageCleanup.get(id)?.();
      this.imageCleanup.delete(id);
      image.onload = null;
      image.onerror = null;
      image.src = '';
    }
    this.imageRejectors.get(id)?.(new Error(`Image "${id}" loading was cancelled.`));
    this.imageRejectors.delete(id);
    this.loadedImages.delete(id);
  }

  private loadImage(object: Extract<StudioObject, { type: 'image' }>): void {
    const view = this.canvas.ownerDocument?.defaultView;
    if (!view?.Image) return;
    const image = new view.Image();
    if (object.crossOrigin) image.crossOrigin = object.crossOrigin;
    this.pendingImages.set(object.id, image);
    const cleanup = (): void => {
      image.removeEventListener('load', onLoad);
      image.removeEventListener('error', onError);
      this.imageCleanup.delete(object.id);
    };
    const onLoad = (): void => {
      if (this.disposed || this.pendingImages.get(object.id) !== image) return;
      this.pendingImages.delete(object.id);
      cleanup();
      this.loadedImages.set(object.id, image);
      this.scheduleRender();
    };
    const onError = (): void => {
      if (this.pendingImages.get(object.id) !== image) return;
      this.pendingImages.delete(object.id);
      cleanup();
      const error = new Error(
        `Unable to load image "${object.src}". Check the URL and image CORS policy.`,
      );
      this.reportError(error);
    };
    image.addEventListener('load', onLoad, { once: true });
    image.addEventListener('error', onError, { once: true });
    this.imageCleanup.set(object.id, cleanup);
    image.src = object.src;
  }

  private localPointer(clientX: number, clientY: number): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  private hitTarget(screen: Point): PointerTarget | undefined {
    const world = screenToWorld(screen, this.state.viewport);
    const selected =
      this.state.selection.length === 1
        ? this.state.objects.find((object) => object.id === this.state.selection[0])
        : undefined;
    if (selected && !selected.locked) {
      const local = rotatePoint(world, objectCenter(selected), -selected.rotation);
      const x = local.x - selected.x;
      const y = local.y - selected.y;
      const tolerance = 8 / this.state.viewport.zoom;
      const handles: Array<[HitArea, number, number]> = [
        ['nw', 0, 0],
        ['n', selected.width / 2, 0],
        ['ne', selected.width, 0],
        ['e', selected.width, selected.height / 2],
        ['se', selected.width, selected.height],
        ['s', selected.width / 2, selected.height],
        ['sw', 0, selected.height],
        ['w', 0, selected.height / 2],
      ];
      for (const [area, hx, hy] of handles)
        if (Math.hypot(x - hx, y - hy) <= tolerance) return { id: selected.id, area };
      if (Math.hypot(x - selected.width / 2, y + 28) <= tolerance)
        return { id: selected.id, area: 'rotate' };
    }
    const object = hitTest(this.state.objects, world, 4 / this.state.viewport.zoom);
    if (!object || object.locked) return undefined;
    return { id: object.id, area: 'body' };
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.disposed || (event.button !== 0 && event.button !== 1 && event.button !== 2)) return;
    this.canvas.focus();
    const screen = this.localPointer(event.clientX, event.clientY);
    const panning = event.button === 1 || event.button === 2 || this.spaceDown;
    const target = panning ? undefined : this.hitTarget(screen);
    if (target) {
      const object = this.state.objects.find((candidate) => candidate.id === target.id);
      if (object) {
        const groupMembers = object.groupId
          ? this.state.objects
              .filter((candidate) => candidate.groupId === object.groupId)
              .map((candidate) => candidate.id)
          : [object.id];
        if (event.shiftKey) {
          this.state.selection = this.state.selection.includes(object.id)
            ? this.state.selection.filter((id) => id !== object.id)
            : [...this.state.selection, object.id];
          this.notifySelection();
        } else if (event.ctrlKey || event.metaKey) {
          this.state.selection = this.state.selection.includes(object.id)
            ? this.state.selection.filter((id) => !groupMembers.includes(id))
            : [...new Set([...this.state.selection, ...groupMembers])];
          this.notifySelection();
        } else if (!this.state.selection.includes(object.id)) {
          this.state.selection = groupMembers;
          this.notifySelection();
        }
      }
    } else if (!panning && !event.shiftKey) {
      this.state.selection = [];
      this.notifySelection();
    }
    const pointer: PointerState = {
      pointerId: event.pointerId,
      start: screenToWorld(screen, this.state.viewport),
      startScreen: screen,
      target,
      startObjects: cloneObjects(this.state.objects),
      startViewport: { ...this.state.viewport },
      startSelection: [...this.state.selection],
      startObject: target
        ? this.state.objects.find((object) => object.id === target.id)
        : undefined,
      moved: false,
      panning,
      spacePan: this.spaceDown,
    };
    this.pointer = pointer;
    this.history.begin();
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch (error) {
      this.pointer = undefined;
      this.history.cancel();
      this.reportError(wrapError('Unable to capture pointer.', error));
      return;
    }
    event.preventDefault();
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.disposed || !this.pointer || this.pointer.pointerId !== event.pointerId) return;
    const pointer = this.pointer;
    const screen = this.localPointer(event.clientX, event.clientY);
    const world = screenToWorld(screen, this.state.viewport);
    const dx = world.x - pointer.start.x;
    const dy = world.y - pointer.start.y;
    if (!pointer.moved && Math.hypot(dx, dy) < 0.5) return;
    pointer.moved = true;
    if (pointer.panning) {
      this.state.viewport = {
        ...pointer.startViewport,
        x:
          pointer.startViewport.x + (screen.x - pointer.startScreen.x) / pointer.startViewport.zoom,
        y:
          pointer.startViewport.y + (screen.y - pointer.startScreen.y) / pointer.startViewport.zoom,
      };
    } else if (
      pointer.target?.area === 'body' &&
      this.state.selection.includes(pointer.target.id)
    ) {
      const selected = new Set(this.state.selection);
      this.state.objects = pointer.startObjects.map((object) =>
        selected.has(object.id) && !object.locked
          ? ({ ...object, x: object.x + dx, y: object.y + dy } as StudioObject)
          : object,
      );
    } else if (pointer.startObject && pointer.target) {
      const index = this.state.objects.findIndex((object) => object.id === pointer.startObject?.id);
      if (index >= 0)
        this.state.objects[index] = this.transformObject(
          pointer.startObject,
          pointer.target.area,
          world,
          pointer.start,
        );
    }
    this.scheduleRender();
  };

  private transformObject(
    object: StudioObject,
    area: HitArea,
    world: Point,
    start: Point,
  ): StudioObject {
    if (area === 'rotate') {
      const center = objectCenter(object);
      return {
        ...object,
        rotation: normalizeRotation(
          Math.atan2(world.y - center.y, world.x - center.x) + Math.PI / 2,
        ),
      } as StudioObject;
    }
    if (area === 'body') return object;
    const localStart = rotatePoint(start, objectCenter(object), -object.rotation);
    const localNow = rotatePoint(world, objectCenter(object), -object.rotation);
    const dx = localNow.x - localStart.x;
    const dy = localNow.y - localStart.y;
    const left = area === 'nw' || area === 'w' || area === 'sw';
    const right = area === 'ne' || area === 'e' || area === 'se';
    const top = area === 'nw' || area === 'n' || area === 'ne';
    const bottom = area === 'sw' || area === 's' || area === 'se';
    const width = Math.max(1, object.width + (left ? -dx : right ? dx : 0));
    const height = Math.max(1, object.height + (top ? -dy : bottom ? dy : 0));
    const anchor = rotatePoint(
      {
        x: object.x + (left ? object.width : right ? 0 : object.width / 2),
        y: object.y + (top ? object.height : bottom ? 0 : object.height / 2),
      },
      objectCenter(object),
      object.rotation,
    );
    const anchorLocal = {
      x: left ? width : right ? 0 : width / 2,
      y: top ? height : bottom ? 0 : height / 2,
    };
    const center = {
      x:
        anchor.x -
        (anchorLocal.x - width / 2) * Math.cos(object.rotation) +
        (anchorLocal.y - height / 2) * Math.sin(object.rotation),
      y:
        anchor.y -
        (anchorLocal.x - width / 2) * Math.sin(object.rotation) -
        (anchorLocal.y - height / 2) * Math.cos(object.rotation),
    };
    const adjusted =
      object.type === 'path'
        ? {
            ...object,
            points: object.points.map((point) => ({
              x: (point.x * width) / (object.width || 1),
              y: (point.y * height) / (object.height || 1),
            })),
          }
        : object;
    return {
      ...adjusted,
      x: center.x - width / 2,
      y: center.y - height / 2,
      width,
      height,
    } as StudioObject;
  }

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.pointer || this.pointer.pointerId !== event.pointerId) return;
    this.onPointerMove(event);
    const pointer = this.pointer;
    this.pointer = undefined;
    try {
      this.canvas.releasePointerCapture(event.pointerId);
    } catch (error) {
      this.reportError(wrapError('Unable to release pointer capture.', error));
    }
    if (pointer.moved) this.history.commit(this.state);
    else this.history.cancel();
    if (pointer.moved) this.notifyChange();
    this.scheduleRender();
  };

  private onPointerCancel = (event: PointerEvent): void => {
    if (!this.pointer || this.pointer.pointerId !== event.pointerId) return;
    const pointer = this.pointer;
    this.pointer = undefined;
    if (this.history.inTransaction) this.history.cancel();
    this.state.objects = cloneObjects(pointer.startObjects);
    this.state.viewport = { ...pointer.startViewport };
    this.state.selection = [...pointer.startSelection];
    this.notifySelection();
    this.scheduleRender();
  };

  private onWheel = (event: WheelEvent): void => {
    if (this.disposed) return;
    if (event.ctrlKey || event.metaKey) {
      const point = this.localPointer(event.clientX, event.clientY);
      this.zoomAt(point, Math.exp(-event.deltaY * 0.002));
      event.preventDefault();
    } else if (event.shiftKey) {
      this.panBy(
        -event.deltaY / this.state.viewport.zoom,
        -event.deltaX / this.state.viewport.zoom,
      );
      event.preventDefault();
    }
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.disposed) return;
    if (event.code === 'Space') {
      this.spaceDown = true;
      event.preventDefault();
    }
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (modifier && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (modifier && key === 'y') {
      event.preventDefault();
      this.redo();
      return;
    }
    if (modifier && key === 'a') {
      event.preventDefault();
      this.selectAll();
      return;
    }
    if (key === 'escape') {
      this.setSelection([]);
      return;
    }
    if ((key === 'delete' || key === 'backspace') && this.state.selection.length) {
      event.preventDefault();
      this.history.begin();
      for (const id of [...this.state.selection]) this.removeObject(id);
      this.history.commit(this.state);
      return;
    }
    const offset = event.shiftKey ? 10 : 1;
    const delta =
      key === 'arrowleft'
        ? [-offset, 0]
        : key === 'arrowright'
          ? [offset, 0]
          : key === 'arrowup'
            ? [0, -offset]
            : key === 'arrowdown'
              ? [0, offset]
              : undefined;
    if (delta && this.state.selection.length) {
      event.preventDefault();
      const selected = new Set(this.state.selection);
      this.state.objects = this.state.objects.map((object) =>
        selected.has(object.id) && !object.locked
          ? ({ ...object, x: object.x + delta[0], y: object.y + delta[1] } as StudioObject)
          : object,
      );
      this.changed();
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space') this.spaceDown = false;
  };
  private onContextMenu = (event: Event): void => {
    if (!this.disposed) event.preventDefault();
  };
}
