import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import * as esmNamespace from '../dist/esm/index.js';
import {
  CanvasStudio,
  History,
  containsPoint,
  distanceToSegment,
  hitTest,
  normalizeRotation,
  objectBounds,
  objectCenter,
  parseSnapshot,
  renderScene,
  rotatePoint,
  screenToWorld,
  serializeSnapshot,
  validateSnapshot,
  worldToScreen,
} from '../dist/esm/index.js';
const require = createRequire(import.meta.url);

const rect = (overrides = {}) => ({
  id: 'shape',
  type: 'rect',
  x: 10,
  y: 20,
  width: 100,
  height: 60,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  fill: '#f00',
  ...overrides,
});

test('geometry handles rotation, inverse hit tests, bounds, and viewport conversion', () => {
  const shape = rect({ rotation: Math.PI / 2 });
  const center = objectCenter(shape);
  assert.deepEqual(center, { x: 60, y: 50 });
  assert.ok(containsPoint(shape, { x: 60, y: 50 }));
  assert.ok(containsPoint(shape, { x: 80, y: 50 }));
  assert.ok(!containsPoint(shape, { x: 100, y: 50 }));
  assert.equal(hitTest([shape], { x: 80, y: 50 })?.id, 'shape');
  assert.equal(hitTest([shape], { x: 100, y: 50 }), undefined);
  const bounds = objectBounds(shape);
  assert.equal(bounds.x, 30);
  assert.ok(Math.abs(bounds.y) < 1e-10);
  assert.equal(bounds.width, 60);
  assert.equal(bounds.height, 100);
  assert.deepEqual(rotatePoint({ x: 70, y: 50 }, center, Math.PI / 2), { x: 60, y: 60 });
  const viewport = { x: 12, y: -3, zoom: 2 };
  assert.deepEqual(worldToScreen({ x: 8, y: 13 }, viewport), { x: 40, y: 20 });
  assert.deepEqual(screenToWorld({ x: 40, y: 20 }, viewport), { x: 8, y: 13 });
  assert.equal(normalizeRotation(-Math.PI / 2), Math.PI * 1.5);
  assert.equal(distanceToSegment({ x: 2, y: 3 }, { x: 0, y: 0 }, { x: 4, y: 0 }), 3);
});

test('serialization validates version, geometry, paths, unique ids, and selection references', () => {
  const snapshot = {
    version: 1,
    background: '#fff',
    viewport: { x: 0, y: 0, zoom: 1 },
    objects: [
      rect(),
      rect({
        id: 'path',
        type: 'path',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 2 },
        ],
      }),
    ],
    selection: ['shape'],
  };
  assert.equal(validateSnapshot(snapshot), true);
  assert.equal(validateSnapshot({ ...snapshot, version: 2 }), false);
  assert.equal(validateSnapshot({ ...snapshot, selection: ['missing'] }), false);
  assert.equal(validateSnapshot({ ...snapshot, objects: [rect(), rect()] }), false);
  assert.equal(validateSnapshot({ ...snapshot, objects: [rect({ x: Number.NaN })] }), false);
  assert.equal(
    validateSnapshot({
      ...snapshot,
      objects: [{ ...rect(), type: 'path', points: [{ x: 0, y: Infinity }] }],
    }),
    false,
  );
  assert.throws(() => parseSnapshot('{'), TypeError);
  assert.throws(() => parseSnapshot(JSON.stringify({ version: 8 })), TypeError);
  assert.deepEqual(parseSnapshot(serializeSnapshot(snapshot)), snapshot);
});

test('History groups, cancels, bounds, and rejects invalid transaction sequencing', () => {
  const history = new History({ count: 0 }, (value) => ({ ...value }), 2);
  history.begin();
  history.commit({ count: 1 });
  assert.equal(history.undo()?.count, 0);
  assert.equal(history.redo()?.count, 1);
  history.begin();
  assert.throws(() => history.begin(), /already active/);
  history.cancel();
  assert.equal(history.canUndo, true);
  history.record({ count: 2 });
  history.record({ count: 3 });
  history.record({ count: 4 });
  assert.equal(history.undo()?.count, 3);
  assert.equal(history.undo()?.count, 2);
  assert.equal(history.undo(), undefined);
});

class FakeContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.operations = [];
  }
  setTransform(...args) {
    this.operations.push(['setTransform', ...args]);
  }
  clearRect(...args) {
    this.operations.push(['clearRect', ...args]);
  }
  fillRect(...args) {
    this.operations.push(['fillRect', ...args]);
  }
  save() {}
  restore() {}
  translate() {}
  scale() {}
  rotate() {}
  beginPath() {}
  rect() {}
  ellipse() {}
  moveTo() {}
  lineTo() {}
  closePath() {}
  fill() {}
  stroke() {}
  strokeRect() {}
  setLineDash() {}
  arc() {}
  fillText() {}
  drawImage() {}
}

class FakeImage {
  static instances = [];
  constructor() {
    this.listeners = new Map();
    this.width = 640;
    this.height = 320;
    this.naturalWidth = 640;
    this.naturalHeight = 320;
    this._src = '';
    FakeImage.instances.push(this);
  }
  addEventListener(type, callback) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(callback);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, callback) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((item) => item !== callback),
    );
  }
  emit(type) {
    for (const listener of this.listeners.get(type) ?? []) listener();
    this.listeners.delete(type);
  }
  set src(value) {
    this._src = value;
  }
  get src() {
    return this._src;
  }
}

class FakeCanvas {
  constructor(document, width = 400, height = 300) {
    this.ownerDocument = document;
    this.clientWidth = width;
    this.clientHeight = height;
    this.width = 300;
    this.height = 150;
    this.tabIndex = -1;
    this.listeners = new Map();
    this.attributes = new Map();
    this.captured = new Set();
    this.rect = { left: 10, top: 20, width, height };
    this.context = new FakeContext(this);
  }
  getContext() {
    return this.context;
  }
  addEventListener(type, callback) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(callback);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, callback) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((item) => item !== callback),
    );
  }
  getBoundingClientRect() {
    return this.rect;
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
  setPointerCapture(id) {
    this.captured.add(id);
  }
  releasePointerCapture(id) {
    this.captured.delete(id);
  }
  hasPointerCapture(id) {
    return this.captured.has(id);
  }
  focus() {}
  dispatch(type, data = {}) {
    let prevented = false;
    const event = {
      type,
      pointerId: 1,
      button: 0,
      clientX: 0,
      clientY: 0,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      code: '',
      key: '',
      deltaY: 0,
      deltaX: 0,
      preventDefault() {
        prevented = true;
      },
      get defaultPrevented() {
        return prevented;
      },
      ...data,
    };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    if (type === 'pointercancel' || type === 'lostpointercapture')
      this.captured.delete(event.pointerId);
    return event;
  }
  toBlob(callback) {
    callback(new Blob(['canvas'], { type: 'image/png' }));
  }
}

function fakeDocument() {
  let nextFrame = 0;
  const frames = new Map();
  const view = {
    devicePixelRatio: 2,
    Image: FakeImage,
    requestAnimationFrame(callback) {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
  };
  const document = {
    defaultView: view,
    createElement() {
      const canvas = new FakeCanvas(document);
      canvas.toBlob = (callback) => {
        if (canvas.failBlob) throw new DOMException('SecurityError', 'SecurityError');
        callback(new Blob(['png'], { type: 'image/png' }));
      };
      return canvas;
    },
  };
  return { document, frames };
}

test('CanvasStudio captures pointers, applies final release coordinates, resizes, cancels, and cleans up', () => {
  const { document, frames } = fakeDocument();
  const canvas = new FakeCanvas(document);
  const errors = [];
  const editor = new CanvasStudio(canvas, { onError: (error) => errors.push(error) });
  assert.equal(canvas.width, 800);
  assert.equal(canvas.height, 600);
  const id = editor.addObject(rect());
  canvas.dispatch('pointerdown', { pointerId: 7, clientX: 30, clientY: 60 });
  assert.equal(canvas.hasPointerCapture(7), true);
  canvas.dispatch('pointermove', { pointerId: 7, clientX: 60, clientY: 80 });
  canvas.dispatch('pointerup', { pointerId: 7, clientX: 65, clientY: 85 });
  assert.deepEqual([editor.objects[0].x, editor.objects[0].y], [45, 45]);
  assert.equal(canvas.hasPointerCapture(7), false);
  assert.equal(editor.undo(), true);
  assert.deepEqual([editor.objects[0].x, editor.objects[0].y], [10, 20]);
  assert.equal(editor.redo(), true);

  canvas.dispatch('pointerdown', { pointerId: 8, clientX: 155, clientY: 95 });
  canvas.dispatch('pointermove', { pointerId: 8, clientX: 175, clientY: 95 });
  canvas.dispatch('pointerup', { pointerId: 8, clientX: 175, clientY: 95 });
  assert.equal(editor.objects[0].width, 120);
  canvas.dispatch('pointerdown', { pointerId: 9, clientX: 175, clientY: 95 });
  canvas.dispatch('pointermove', { pointerId: 9, clientX: 195, clientY: 95 });
  canvas.dispatch('pointercancel', { pointerId: 9 });
  assert.equal(editor.objects[0].width, 120);

  canvas.dispatch('pointerdown', { pointerId: 10, clientX: 115, clientY: 37 });
  canvas.dispatch('pointermove', { pointerId: 10, clientX: 143, clientY: 95 });
  canvas.dispatch('pointerup', { pointerId: 10, clientX: 143, clientY: 95 });
  assert.ok(Math.abs(editor.objects[0].rotation - Math.PI / 2) < 1e-10);

  editor.setSelection([id]);
  canvas.dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(editor.objects[0].x, 46);
  canvas.dispatch('keydown', { key: 'z', ctrlKey: true });
  assert.equal(editor.objects[0].x, 45);
  assert.ok(frames.size > 0);
  editor.dispose();
  assert.equal(frames.size, 0);
  assert.equal(canvas.listeners.get('pointerdown').length, 0);
  assert.deepEqual(errors, []);
  assert.throws(() => editor.render(), /disposed/);
});

test('CanvasStudio loads natural image dimensions, rejects image races, and reports PNG CORS errors', async () => {
  FakeImage.instances = [];
  const { document } = fakeDocument();
  const canvas = new FakeCanvas(document);
  const errors = [];
  const editor = new CanvasStudio(canvas, { onError: (error) => errors.push(error) });
  const load = editor.addImage('/photo.png', 4, 5);
  const image = FakeImage.instances.at(-1);
  assert.equal(image.src, '/photo.png');
  image.emit('load');
  assert.equal(await load, editor.objects[0].id);
  assert.deepEqual([editor.objects[0].width, editor.objects[0].height], [640, 320]);
  const png = await editor.exportPNG({ pixelRatio: 2 });
  assert.equal(png.type, 'image/png');

  const cancelled = editor.addImage('/late.png', 0, 0);
  const lateImage = FakeImage.instances.at(-1);
  const lateId = editor.objects.at(-1).id;
  await assert.rejects(editor.exportPNG(), /finish loading successfully/);
  editor.removeObject(lateId);
  await assert.rejects(cancelled, /cancelled/);
  lateImage.emit('load');
  assert.equal(
    editor.objects.some((object) => object.id === lateId),
    false,
  );

  const broken = editor.addImage('/broken.png', 0, 0);
  FakeImage.instances.at(-1).emit('error');
  await assert.rejects(broken, /Unable to load image/);
  assert.equal(errors.length, 1);

  const changing = editor.addImage('/before.png', 0, 0);
  const changingId = editor.objects.at(-1).id;
  editor.updateObject(changingId, { src: '/after.png' });
  await assert.rejects(changing, /cancelled/);
  FakeImage.instances.at(-1).emit('load');
  assert.equal(editor.objects.find((object) => object.id === changingId).src, '/after.png');

  const exportCanvas = document.createElement('canvas');
  exportCanvas.failBlob = true;
  const originalCreateElement = document.createElement;
  document.createElement = () => exportCanvas;
  await assert.rejects(editor.exportPNG(), /tainted the canvas/);
  assert.equal(errors.length, 2);
  document.createElement = originalCreateElement;

  const neverLoaded = editor.addImage('/dispose.png', 0, 0);
  editor.dispose();
  await assert.rejects(neverLoaded, /cancelled/);
});

test('group dragging leaves locked static members immovable and respects bounded undo', () => {
  const { document } = fakeDocument();
  const canvas = new FakeCanvas(document);
  const editor = new CanvasStudio(canvas, { maxHistory: 2 });
  const fixed = editor.addObject(
    rect({ id: 'fixed', x: 10, y: 10, width: 20, height: 20, locked: true }),
  );
  const movable = editor.addObject(rect({ id: 'movable', x: 50, y: 10, width: 20, height: 20 }));
  editor.setSelection([fixed, movable]);
  editor.groupSelection('pair');
  editor.setSelection([]);
  canvas.dispatch('pointerdown', { pointerId: 20, clientX: 70, clientY: 40 });
  canvas.dispatch('pointermove', { pointerId: 20, clientX: 100, clientY: 40 });
  canvas.dispatch('pointerup', { pointerId: 20, clientX: 100, clientY: 40 });
  assert.equal(editor.objects.find((object) => object.id === fixed).x, 10);
  assert.equal(editor.objects.find((object) => object.id === movable).x, 80);
  assert.equal(editor.undo(), true);
  assert.equal(editor.undo(), true);
  assert.equal(editor.undo(), false);
  editor.dispose();
});

test('CanvasStudio snapshots deeply freeze path geometry and object getters are detached', () => {
  const { document } = fakeDocument();
  const editor = new CanvasStudio(new FakeCanvas(document));
  editor.addObject({
    type: 'path',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    points: [{ x: 1, y: 2 }],
  });
  const snapshot = editor.getSnapshot();
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.objects));
  assert.ok(Object.isFrozen(snapshot.objects[0]));
  assert.ok(Object.isFrozen(snapshot.objects[0].points));
  assert.ok(Object.isFrozen(snapshot.objects[0].points[0]));
  assert.throws(() => {
    snapshot.objects[0].points[0].x = 99;
  }, TypeError);
  const detached = editor.objects;
  detached[0].points[0].x = 99;
  assert.equal(editor.objects[0].points[0].x, 1);
  const saved = editor.serialize();
  assert.throws(() => editor.loadJSON('{'), TypeError);
  const outOfRange = JSON.parse(saved);
  outOfRange.viewport.zoom = 9;
  assert.throws(() => editor.loadSnapshot(outOfRange), RangeError);
  assert.equal(editor.serialize(), saved);
  editor.dispose();
});

test('renderer is callable without a DOM and paints selection-free scene primitives', () => {
  const canvas = { width: 100, height: 100 };
  const context = new FakeContext(canvas);
  renderScene(context, 100, 100, [rect()], {
    background: '#fff',
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  assert.ok(context.operations.some((operation) => operation[0] === 'clearRect'));
});

test('ESM and CommonJS builds expose the same runtime API', () => {
  const esmNames = Object.keys(esmNamespace).sort();
  const cjsNames = Object.keys(require('../dist/cjs/index.js')).sort();
  assert.deepEqual(cjsNames, esmNames);
});
