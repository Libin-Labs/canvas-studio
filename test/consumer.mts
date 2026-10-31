import { CanvasStudio, History, hitTest, type RectObject } from '@lp-labs/canvas-studio';

declare const canvas: HTMLCanvasElement;
const rect: RectObject = {
  id: 'shape',
  type: 'rect',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
};
const editor = new CanvasStudio(canvas);
editor.addObject(rect);
const top = hitTest(editor.objects, { x: 1, y: 1 });
const history = new History({ count: 0 }, (value) => ({ ...value }));
history.record({ count: 1 });
void top;
void editor;
