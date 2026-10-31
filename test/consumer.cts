import studio = require('@lp-labs/canvas-studio');

declare const canvas: HTMLCanvasElement;
const editor = new studio.CanvasStudio(canvas);
editor.addObject({
  type: 'text',
  x: 0,
  y: 0,
  width: 80,
  height: 20,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  text: 'CommonJS',
  fontSize: 14,
  fontFamily: 'sans-serif',
});
const history = new studio.History(0, (value) => value);
history.begin();
history.commit(1);
void studio.parseSnapshot;
void editor;
