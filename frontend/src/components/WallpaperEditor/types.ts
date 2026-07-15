export type BackgroundMode = 'solid' | 'gradient' | 'image';
export type GradientType = 'linear' | 'radial' | 'conic';
export type TextureType = 'none' | 'grain' | 'dots' | 'grid' | 'diagonal' | 'waves' | 'paper';
export type BorderStyle = 'none' | 'solid' | 'double' | 'dashed' | 'film' | 'corners';
export type ImageFit = 'cover' | 'contain' | 'stretch';
export type LayerBlendMode = 'source-over' | 'multiply' | 'screen' | 'overlay' | 'soft-light' | 'hard-light' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn' | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';
export type CropMaskShape = 'rectangle' | 'circle' | 'ellipse' | 'triangle' | 'parallelogram' | 'diamond';
export type ShapeKind = 'rectangle' | 'circle' | 'triangle' | 'star' | 'hexagon' | 'heart';
export type DecorationKind = 'sparkle' | 'flower' | 'leaf' | 'orbit' | 'rainbow' | 'tape';
export type BrushKind = 'solid' | 'gradient' | 'image' | 'emoji';
export type BrushTexture = 'smooth' | 'marker' | 'chalk' | 'spray';
export type StampOrientation = 'fixed' | 'follow';

export interface BrushPoint {
  x: number;
  y: number;
  angle: number;
}

export interface BrushSettings {
  kind: BrushKind;
  texture: BrushTexture;
  size: number;
  opacity: number;
  color: string;
  gradientColors: string[];
  spacing: number;
  imageSrc?: string;
  emoji: string;
  stampOrientation: StampOrientation;
  stampRotation: number;
  distortWithDirection: boolean;
}

export interface ImageAdjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  vibrance: number;
  warmth: number;
  hue: number;
  grayscale: number;
  sepia: number;
  blur: number;
  grain: number;
}

export interface LayerEffects {
  rotateX: number;
  rotateY: number;
  perspective: number;
  thickness: number;
  thicknessColorMode: 'auto' | 'solid' | 'gradient';
  thicknessColor: string;
  thicknessGradientColors: string[];
  edgeSoftness: number;
  shadowEnabled: boolean;
  shadowType: 'outer' | 'inner';
  shadowColor: string;
  shadowOpacity: number;
  shadowBlur: number;
  shadowDistance: number;
  shadowAngle: number;
  reflectionEnabled: boolean;
  reflectionOpacity: number;
  reflectionDistance: number;
  reflectionBlur: number;
}

export interface EditorBackground {
  mode: BackgroundMode;
  color: string;
  gradientType: GradientType;
  gradientColors: string[];
  gradientAngle: number;
  imageSrc?: string;
  imageFit: ImageFit;
  imageBlur: number;
  imageBrightness: number;
  texture: TextureType;
  textureColor: string;
  textureOpacity: number;
  textureScale: number;
  adjustments?: ImageAdjustments;
}

export interface EditorBorder {
  style: BorderStyle;
  color: string;
  width: number;
  inset: number;
  radius: number;
  opacity: number;
}

export interface BaseLayer {
  id: string;
  type: 'shape' | 'text' | 'image' | 'decoration' | 'paint';
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipX?: boolean;
  flipY?: boolean;
  effects?: LayerEffects;
}

export interface ShapeLayer extends BaseLayer {
  type: 'shape';
  shape: ShapeKind;
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
  shadowColor: string;
  shadowBlur: number;
}

export interface TextCharacterStyle {
  color?: string;
  backgroundColor?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  underline?: boolean;
  letterSpacing?: number;
}

export interface TextLayer extends BaseLayer {
  type: 'text';
  text: string;
  color: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  align: CanvasTextAlign;
  letterSpacing: number;
  lineHeight: number;
  stroke: string;
  strokeWidth: number;
  shadowColor: string;
  shadowBlur: number;
  characterStyles?: TextCharacterStyle[];
}

export interface ImageLayer extends BaseLayer {
  type: 'image';
  src: string;
  fit: ImageFit;
  radius: number;
  stroke: string;
  strokeWidth: number;
  shadowColor: string;
  shadowBlur: number;
  sourceAspectRatio?: number;
  aspectRatioLocked?: boolean;
  blendMode?: LayerBlendMode;
  adjustments?: ImageAdjustments;
  cropShape?: CropMaskShape;
  dominantColor?: string;
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface DecorationLayer extends BaseLayer {
  type: 'decoration';
  decoration: DecorationKind;
  color: string;
  secondaryColor: string;
  strokeWidth: number;
}

export interface PaintLayer extends BaseLayer, BrushSettings {
  type: 'paint';
  points: BrushPoint[];
  sourceWidth: number;
  sourceHeight: number;
}

export type EditorLayer = ShapeLayer | TextLayer | ImageLayer | DecorationLayer | PaintLayer;

export const DEFAULT_IMAGE_ADJUSTMENTS: ImageAdjustments = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  vibrance: 0,
  warmth: 0,
  hue: 0,
  grayscale: 0,
  sepia: 0,
  blur: 0,
  grain: 0,
};

export const DEFAULT_LAYER_EFFECTS: LayerEffects = {
  rotateX: 0,
  rotateY: 0,
  perspective: 40,
  thickness: 0,
  thicknessColorMode: 'auto',
  thicknessColor: '#5B6472',
  thicknessGradientColors: ['#263241', '#8A96A6'],
  edgeSoftness: 0,
  shadowEnabled: false,
  shadowType: 'outer',
  shadowColor: '#000000',
  shadowOpacity: 35,
  shadowBlur: 20,
  shadowDistance: 16,
  shadowAngle: 45,
  reflectionEnabled: false,
  reflectionOpacity: 30,
  reflectionDistance: 12,
  reflectionBlur: 3,
};

export interface WallpaperDocument {
  width: number;
  height: number;
  background: EditorBackground;
  border: EditorBorder;
  layers: EditorLayer[];
}

export interface Point {
  x: number;
  y: number;
}

export type CanvasHandle = 'move' | 'nw' | 'ne' | 'se' | 'sw' | 'rotate' | 'radius';

export interface CanvasInteraction {
  handle: CanvasHandle;
  start: Point;
  original: EditorLayer;
  duplicated?: boolean;
}

export const DEFAULT_DOCUMENT: WallpaperDocument = {
  width: 1920,
  height: 1080,
  background: {
    mode: 'gradient',
    color: '#F4F1EA',
    gradientType: 'linear',
    gradientColors: ['#17233B', '#446A66', '#D8B67A'],
    gradientAngle: 128,
    imageFit: 'cover',
    imageBlur: 0,
    imageBrightness: 100,
    texture: 'grain',
    textureColor: '#FFFFFF',
    textureOpacity: 8,
    textureScale: 48,
    adjustments: { ...DEFAULT_IMAGE_ADJUSTMENTS },
  },
  border: {
    style: 'none',
    color: '#FFFFFF',
    width: 18,
    inset: 36,
    radius: 12,
    opacity: 90,
  },
  layers: [],
};

export function createLayerId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function cloneDocument(document: WallpaperDocument): WallpaperDocument {
  return structuredClone(document);
}
