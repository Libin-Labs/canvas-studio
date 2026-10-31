export type Point = Readonly<{ x: number; y: number }>;

export type Viewport = Readonly<{
  x: number;
  y: number;
  zoom: number;
}>;

export type BaseObject = Readonly<{
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  groupId?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}>;

export type RectObject = BaseObject & Readonly<{ type: 'rect'; radius?: number }>;
export type EllipseObject = BaseObject & Readonly<{ type: 'ellipse' }>;
export type LineObject = BaseObject & Readonly<{ type: 'line' }>;
export type PathObject = BaseObject &
  Readonly<{ type: 'path'; points: readonly Point[]; closed?: boolean }>;
export type TextObject = BaseObject &
  Readonly<{
    type: 'text';
    text: string;
    fontSize: number;
    fontFamily: string;
    fontWeight?: string;
    textAlign?: CanvasTextAlign;
    lineHeight?: number;
  }>;
export type ImageObject = BaseObject &
  Readonly<{
    type: 'image';
    src: string;
    crossOrigin?: 'anonymous' | 'use-credentials';
  }>;
export type StudioObject =
  RectObject | EllipseObject | LineObject | PathObject | TextObject | ImageObject;
export type ObjectInput = StudioObject extends infer T
  ? T extends StudioObject
    ? Omit<T, 'id'> & { id?: string }
    : never
  : never;
export type ObjectUpdate = StudioObject extends infer T
  ? T extends StudioObject
    ? Partial<Omit<T, 'id' | 'type'>>
    : never
  : never;

export type CanvasStudioOptions = Readonly<{
  width?: number;
  height?: number;
  background?: string;
  maxHistory?: number;
  minZoom?: number;
  maxZoom?: number;
  selectionColor?: string;
  onSelectionChange?: (selection: readonly string[]) => void;
  onChange?: (snapshot: StudioSnapshot) => void;
  onError?: (error: Error) => void;
}>;

export type StudioSnapshot = Readonly<{
  version: 1;
  background: string;
  viewport: Viewport;
  objects: readonly StudioObject[];
  selection: readonly string[];
}>;

export type ExportOptions = Readonly<{
  pixelRatio?: number;
  background?: string;
}>;

export type HitArea = 'body' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';

export type PointerTarget = Readonly<{
  id: string;
  area: HitArea;
}>;
