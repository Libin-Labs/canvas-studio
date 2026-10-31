import type { StudioSnapshot, StudioObject } from './types.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const validObjectTypes = new Set(['rect', 'ellipse', 'line', 'path', 'text', 'image']);

export function validateSnapshot(input: unknown): input is StudioSnapshot {
  if (!isRecord(input) || input.version !== 1 || typeof input.background !== 'string') return false;
  if (
    !isRecord(input.viewport) ||
    !finite(input.viewport.x) ||
    !finite(input.viewport.y) ||
    !finite(input.viewport.zoom) ||
    input.viewport.zoom <= 0
  )
    return false;
  if (!Array.isArray(input.objects) || !Array.isArray(input.selection)) return false;
  const ids = new Set<string>();
  for (const candidate of input.objects) {
    if (
      !isRecord(candidate) ||
      !validObjectTypes.has(String(candidate.type)) ||
      typeof candidate.id !== 'string' ||
      candidate.id.length === 0 ||
      ids.has(candidate.id) ||
      !finite(candidate.x) ||
      !finite(candidate.y) ||
      !finite(candidate.width) ||
      !finite(candidate.height) ||
      candidate.width < 0 ||
      candidate.height < 0 ||
      !finite(candidate.rotation) ||
      !finite(candidate.opacity) ||
      candidate.opacity < 0 ||
      candidate.opacity > 1 ||
      typeof candidate.visible !== 'boolean' ||
      typeof candidate.locked !== 'boolean' ||
      (candidate.groupId !== undefined && typeof candidate.groupId !== 'string') ||
      (candidate.fill !== undefined && typeof candidate.fill !== 'string') ||
      (candidate.stroke !== undefined && typeof candidate.stroke !== 'string') ||
      (candidate.strokeWidth !== undefined &&
        (!finite(candidate.strokeWidth) || candidate.strokeWidth < 0))
    )
      return false;
    ids.add(candidate.id);
    if (
      candidate.type === 'rect' &&
      candidate.radius !== undefined &&
      (!finite(candidate.radius) || candidate.radius < 0)
    )
      return false;
    if (candidate.type === 'path') {
      if (
        !Array.isArray(candidate.points) ||
        !candidate.points.every((point) => isRecord(point) && finite(point.x) && finite(point.y))
      )
        return false;
      if (candidate.closed !== undefined && typeof candidate.closed !== 'boolean') return false;
    }
    if (candidate.type === 'text') {
      if (
        typeof candidate.text !== 'string' ||
        !finite(candidate.fontSize) ||
        candidate.fontSize <= 0 ||
        typeof candidate.fontFamily !== 'string' ||
        (candidate.fontWeight !== undefined && typeof candidate.fontWeight !== 'string') ||
        (candidate.textAlign !== undefined &&
          !['left', 'right', 'center', 'start', 'end'].includes(String(candidate.textAlign))) ||
        (candidate.lineHeight !== undefined &&
          (!finite(candidate.lineHeight) || candidate.lineHeight <= 0))
      )
        return false;
    }
    if (
      candidate.type === 'image' &&
      (typeof candidate.src !== 'string' ||
        candidate.src.length === 0 ||
        (candidate.crossOrigin !== undefined &&
          !['anonymous', 'use-credentials'].includes(String(candidate.crossOrigin))))
    )
      return false;
  }
  return input.selection.every((id) => typeof id === 'string' && ids.has(id));
}

export function serializeSnapshot(snapshot: StudioSnapshot, space?: number): string {
  return JSON.stringify(snapshot, null, space);
}

export function parseSnapshot(json: string): StudioSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch (error) {
    throw new TypeError(`Invalid canvas-studio JSON: ${(error as Error).message}`);
  }
  if (!validateSnapshot(value)) throw new TypeError('Invalid canvas-studio snapshot.');
  return value;
}

export function cloneObjects(objects: readonly StudioObject[]): StudioObject[] {
  return objects.map((object) => ({
    ...object,
    ...(object.type === 'path' ? { points: object.points.map((point) => ({ ...point })) } : {}),
  })) as StudioObject[];
}
