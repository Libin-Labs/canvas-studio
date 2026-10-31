export { CanvasStudio } from './canvas-studio.js';
export { History } from './history.js';
export {
  containsPoint,
  distanceToSegment,
  hitTest,
  normalizeRotation,
  objectBounds,
  objectCenter,
  rotatePoint,
  screenToWorld,
  worldToScreen,
} from './geometry.js';
export {
  cloneObjects,
  parseSnapshot,
  serializeSnapshot,
  validateSnapshot,
} from './serialization.js';
export { getSelectionBounds, renderExport, renderScene } from './renderer.js';
export type {
  BaseObject,
  CanvasStudioOptions,
  EllipseObject,
  ExportOptions,
  HitArea,
  ImageObject,
  LineObject,
  ObjectInput,
  ObjectUpdate,
  PathObject,
  Point,
  PointerTarget,
  RectObject,
  StudioObject,
  StudioSnapshot,
  TextObject,
  Viewport,
} from './types.js';
export type { Bounds } from './geometry.js';
export type { RenderOptions } from './renderer.js';
