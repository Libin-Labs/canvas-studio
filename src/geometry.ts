import type { Point, StudioObject, Viewport } from './types.js';

export type Bounds = Readonly<{ x: number; y: number; width: number; height: number }>;

export function rotatePoint(point: Point, center: Point, radians: number): Point {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const x = point.x - center.x;
  const y = point.y - center.y;
  return { x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos };
}

export function objectCenter(object: Pick<StudioObject, 'x' | 'y' | 'width' | 'height'>): Point {
  return { x: object.x + object.width / 2, y: object.y + object.height / 2 };
}

export function objectBounds(object: StudioObject): Bounds {
  const center = objectCenter(object);
  const corners = [
    { x: object.x, y: object.y },
    { x: object.x + object.width, y: object.y },
    { x: object.x + object.width, y: object.y + object.height },
    { x: object.x, y: object.y + object.height },
  ].map((point) => rotatePoint(point, center, object.rotation));
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

export function worldToScreen(point: Point, viewport: Viewport): Point {
  return { x: (point.x + viewport.x) * viewport.zoom, y: (point.y + viewport.y) * viewport.zoom };
}

export function screenToWorld(point: Point, viewport: Viewport): Point {
  return { x: point.x / viewport.zoom - viewport.x, y: point.y / viewport.zoom - viewport.y };
}

export function containsPoint(object: StudioObject, point: Point, tolerance = 0): boolean {
  if (!object.visible) return false;
  const local = rotatePoint(point, objectCenter(object), -object.rotation);
  const left = object.x - tolerance;
  const top = object.y - tolerance;
  const right = object.x + object.width + tolerance;
  const bottom = object.y + object.height + tolerance;
  if (object.type === 'ellipse') {
    const rx = object.width / 2 + tolerance;
    const ry = object.height / 2 + tolerance;
    if (rx <= 0 || ry <= 0) return false;
    const dx = (local.x - (object.x + object.width / 2)) / rx;
    const dy = (local.y - (object.y + object.height / 2)) / ry;
    return dx * dx + dy * dy <= 1;
  }
  if (object.type === 'line') {
    const start = { x: object.x, y: object.y };
    const end = { x: object.x + object.width, y: object.y + object.height };
    return distanceToSegment(local, start, end) <= Math.max(tolerance, object.strokeWidth ?? 1);
  }
  if (object.type === 'path') {
    const points = object.points.map((item) => ({ x: object.x + item.x, y: object.y + item.y }));
    const count = object.closed ? points.length : points.length - 1;
    for (let i = 0; i < count; i += 1) {
      if (
        distanceToSegment(local, points[i], points[(i + 1) % points.length]) <=
        Math.max(tolerance, object.strokeWidth ?? 1)
      )
        return true;
    }
    if (object.closed && object.fill && points.length >= 3) {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
        const crosses =
          points[i].y > local.y !== points[j].y > local.y &&
          local.x <
            ((points[j].x - points[i].x) * (local.y - points[i].y)) / (points[j].y - points[i].y) +
              points[i].x;
        if (crosses) inside = !inside;
      }
      return inside;
    }
    return false;
  }
  return local.x >= left && local.x <= right && local.y >= top && local.y <= bottom;
}

export function hitTest(
  objects: readonly StudioObject[],
  point: Point,
  tolerance = 0,
): StudioObject | undefined {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    if (containsPoint(objects[index], point, tolerance)) return objects[index];
  }
  return undefined;
}

export function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const projection = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  return Math.hypot(point.x - (start.x + projection * dx), point.y - (start.y + projection * dy));
}

export function normalizeRotation(radians: number): number {
  const fullTurn = Math.PI * 2;
  return ((radians % fullTurn) + fullTurn) % fullTurn;
}
