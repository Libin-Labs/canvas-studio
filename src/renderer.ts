import { objectBounds } from './geometry.js';
import type { Point, StudioObject, Viewport } from './types.js';

export type RenderOptions = Readonly<{
  background: string;
  viewport: Viewport;
  pixelRatio?: number;
  selection?: readonly string[];
  selectionColor?: string;
  images?: ReadonlyMap<string, CanvasImageSource>;
}>;

const applyPaint = (context: CanvasRenderingContext2D, object: StudioObject): void => {
  context.globalAlpha = object.opacity;
  context.lineWidth = object.strokeWidth ?? 1;
  context.fillStyle = object.fill ?? 'transparent';
  context.strokeStyle = object.stroke ?? '#202124';
  context.lineCap = 'round';
  context.lineJoin = 'round';
};

function drawObject(
  context: CanvasRenderingContext2D,
  object: StudioObject,
  image?: CanvasImageSource,
): void {
  if (!object.visible || object.opacity <= 0) return;
  context.save();
  context.translate(object.x + object.width / 2, object.y + object.height / 2);
  context.rotate(object.rotation);
  context.translate(-object.width / 2, -object.height / 2);
  applyPaint(context, object);
  context.beginPath();
  switch (object.type) {
    case 'rect':
      context.rect(0, 0, object.width, object.height);
      if (object.fill) context.fill();
      if (object.stroke) context.stroke();
      break;
    case 'ellipse':
      context.ellipse(
        object.width / 2,
        object.height / 2,
        Math.abs(object.width / 2),
        Math.abs(object.height / 2),
        0,
        0,
        Math.PI * 2,
      );
      if (object.fill) context.fill();
      if (object.stroke) context.stroke();
      break;
    case 'line':
      context.moveTo(0, 0);
      context.lineTo(object.width, object.height);
      context.stroke();
      break;
    case 'path':
      if (object.points.length) {
        context.moveTo(object.points[0].x, object.points[0].y);
        for (const point of object.points.slice(1)) context.lineTo(point.x, point.y);
        if (object.closed) context.closePath();
        if (object.closed && object.fill) context.fill();
        if (object.stroke) context.stroke();
      }
      break;
    case 'text':
      context.font = `${object.fontWeight ?? 'normal'} ${object.fontSize}px ${object.fontFamily}`;
      context.textAlign = object.textAlign ?? 'left';
      context.textBaseline = 'top';
      context.fillStyle = object.fill ?? '#202124';
      object.text.split('\n').forEach((line, index) => {
        context.fillText(
          line,
          0,
          index * (object.lineHeight ?? object.fontSize * 1.2),
          object.width || undefined,
        );
      });
      break;
    case 'image':
      if (image) context.drawImage(image, 0, 0, object.width, object.height);
      else if (object.fill) {
        context.fillStyle = object.fill;
        context.fillRect(0, 0, object.width, object.height);
      }
      break;
  }
  context.restore();
}

function drawSelection(
  context: CanvasRenderingContext2D,
  object: StudioObject,
  color: string,
  showHandles: boolean,
): void {
  if (!object.visible) return;
  context.save();
  context.translate(object.x + object.width / 2, object.y + object.height / 2);
  context.rotate(object.rotation);
  context.translate(-object.width / 2, -object.height / 2);
  context.strokeStyle = color;
  context.fillStyle = '#ffffff';
  context.lineWidth = 1.5;
  context.setLineDash([4, 3]);
  context.strokeRect(0, 0, object.width, object.height);
  context.setLineDash([]);
  if (!showHandles) {
    context.restore();
    return;
  }
  const radius = 4;
  const handles: Point[] = [
    { x: 0, y: 0 },
    { x: object.width / 2, y: 0 },
    { x: object.width, y: 0 },
    { x: object.width, y: object.height / 2 },
    { x: object.width, y: object.height },
    { x: object.width / 2, y: object.height },
    { x: 0, y: object.height },
    { x: 0, y: object.height / 2 },
  ];
  for (const point of handles) {
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
  context.beginPath();
  context.moveTo(object.width / 2, 0);
  context.lineTo(object.width / 2, -24);
  context.stroke();
  context.beginPath();
  context.arc(object.width / 2, -28, radius + 1, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.restore();
}

export function renderScene(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  objects: readonly StudioObject[],
  options: RenderOptions,
): void {
  context.save();
  const pixelRatio = options.pixelRatio ?? 1;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.fillStyle = options.background;
  context.fillRect(0, 0, width, height);
  context.translate(
    options.viewport.x * options.viewport.zoom,
    options.viewport.y * options.viewport.zoom,
  );
  context.scale(options.viewport.zoom, options.viewport.zoom);
  for (const object of objects) drawObject(context, object, options.images?.get(object.id));
  if (options.selection?.length) {
    for (const id of options.selection) {
      const object = objects.find((candidate) => candidate.id === id);
      if (object)
        drawSelection(
          context,
          object,
          options.selectionColor ?? '#2563eb',
          options.selection.length === 1,
        );
    }
  }
  context.restore();
}

export function renderExport(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  objects: readonly StudioObject[],
  background: string,
  images?: ReadonlyMap<string, CanvasImageSource>,
  pixelRatio = 1,
): void {
  renderScene(context, width, height, objects, {
    background,
    viewport: { x: 0, y: 0, zoom: 1 },
    ...(images ? { images } : {}),
    pixelRatio,
  });
}

export function getSelectionBounds(
  objects: readonly StudioObject[],
): ReturnType<typeof objectBounds> | undefined {
  if (objects.length === 0) return undefined;
  const bounds = objects.map(objectBounds);
  const x = Math.min(...bounds.map((bound) => bound.x));
  const y = Math.min(...bounds.map((bound) => bound.y));
  const right = Math.max(...bounds.map((bound) => bound.x + bound.width));
  const bottom = Math.max(...bounds.map((bound) => bound.y + bound.height));
  return { x, y, width: right - x, height: bottom - y };
}
