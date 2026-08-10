import { useEffect, useRef, useState } from 'react';
import {
  Button, Card, Kbd, Label, ListBox, NumberField, Select, Separator, Slider,
  Spinner, Switch, Tabs, Tooltip, toast,
} from '@heroui/react';
import {
  ArrowLeft, Download, Eye, EyeOff, FlipHorizontal2, FlipVertical2,
  Check, Crop, Focus, FolderOpen, ImagePlus, Lock, Redo2, RefreshCcw, RotateCcw, RotateCw,
  Save, SlidersHorizontal, Undo2, Unlock, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import { useNavigate } from '@/lib/router';
import { getImageEditorSession, type ImageEditorSession } from '@/lib/imageEditorSession';
import { fetchEditableImage, localFileUrl, saveBlobAs, saveBlobToDownloads, selectLocalImage } from '@/api/backend';
import { safeNameForFile } from '@/lib/download';

interface ImageAdjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  exposure: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  gamma: number;
  temperature: number;
  tint: number;
  hue: number;
  red: number;
  green: number;
  blue: number;
  sepia: number;
  grayscale: number;
  fade: number;
  dehaze: number;
  blur: number;
  vignette: number;
  grain: number;
  opacity: number;
}

interface EditorState {
  width: number;
  height: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  crop: CropRect;
  adjustments: ImageAdjustments;
}

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type CropAspect = 'free' | 'original' | '1:1' | '4:3' | '16:9' | '3:4' | '9:16';
type CropHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

interface FilterPreset {
  id: string;
  name: string;
  description: string;
  adjustments: Partial<ImageAdjustments>;
}

const DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  exposure: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  gamma: 100,
  temperature: 0,
  tint: 0,
  hue: 0,
  red: 0,
  green: 0,
  blue: 0,
  sepia: 0,
  grayscale: 0,
  fade: 0,
  dehaze: 0,
  blur: 0,
  vignette: 0,
  grain: 0,
  opacity: 100,
};

const FILTER_PRESETS: FilterPreset[] = [
  { id: 'original', name: '原图', description: '保留真实色彩', adjustments: {} },
  { id: 'vivid', name: '鲜活', description: '浓郁而通透', adjustments: { contrast: 112, saturation: 128, brightness: 103 } },
  { id: 'clear', name: '清透', description: '明亮低反差', adjustments: { brightness: 108, contrast: 92, saturation: 108, temperature: -5 } },
  { id: 'sunset', name: '暖阳', description: '柔和暖色调', adjustments: { contrast: 104, saturation: 112, temperature: 32, sepia: 8 } },
  { id: 'noir', name: '黑白', description: '经典高反差', adjustments: { grayscale: 100, contrast: 122, brightness: 96 } },
  { id: 'film', name: '胶片', description: '暖调与颗粒', adjustments: { contrast: 108, saturation: 88, temperature: 18, sepia: 18, grain: 18, vignette: 14 } },
  { id: 'cool', name: '冷峻', description: '清冷蓝调', adjustments: { contrast: 110, saturation: 92, temperature: -30, brightness: 98 } },
  { id: 'fade', name: '褪色', description: '低饱和柔光', adjustments: { contrast: 84, saturation: 72, brightness: 108, sepia: 12, vignette: 8 } },
];

const SIZE_PRESETS = [
  { id: 'original', label: '原始尺寸' },
  { id: '1920x1080', label: '桌面 Full HD · 1920 × 1080' },
  { id: '2560x1440', label: '桌面 2K · 2560 × 1440' },
  { id: '3840x2160', label: '桌面 4K · 3840 × 2160' },
  { id: '1080x1920', label: '手机竖屏 · 1080 × 1920' },
  { id: '1080x1080', label: '正方形 · 1080 × 1080' },
];

const CROP_ASPECTS: Array<{ id: CropAspect; label: string; ratio: number | null }> = [
  { id: 'free', label: '自由比例', ratio: null },
  { id: 'original', label: '当前比例', ratio: 0 },
  { id: '1:1', label: '正方形 · 1:1', ratio: 1 },
  { id: '4:3', label: '横向 · 4:3', ratio: 4 / 3 },
  { id: '16:9', label: '宽屏 · 16:9', ratio: 16 / 9 },
  { id: '3:4', label: '纵向 · 3:4', ratio: 3 / 4 },
  { id: '9:16', label: '竖屏 · 9:16', ratio: 9 / 16 },
];

const MAX_EXPORT_DIMENSION = 8192;
const MAX_EXPORT_PIXELS = 50_000_000;
const CONTEXT_MENU_WIDTH = 260;
const CONTEXT_MENU_MARGIN = 8;

interface EditorContextMenu {
  x: number;
  y: number;
}

interface CropInteraction {
  pointerId: number;
  handle: CropHandle;
  startX: number;
  startY: number;
  original: CropRect;
}

function clamp(value: number, min = 0, max = 255): number {
  return Math.max(min, Math.min(max, value));
}

function clampCrop(crop: CropRect): CropRect {
  const width = Math.max(0.02, Math.min(1, crop.width));
  const height = Math.max(0.02, Math.min(1, crop.height));
  return {
    x: Math.max(0, Math.min(1 - width, crop.x)),
    y: Math.max(0, Math.min(1 - height, crop.y)),
    width,
    height,
  };
}

function rotateEditorState(current: EditorState, direction: -1 | 1): EditorState {
  const crop = current.crop;
  const rotatedCrop = direction === 1
    ? { x: 1 - crop.y - crop.height, y: crop.x, width: crop.height, height: crop.width }
    : { x: crop.y, y: 1 - crop.x - crop.width, width: crop.height, height: crop.width };
  return {
    ...current,
    width: current.height,
    height: current.width,
    rotation: (current.rotation + direction * 90 + 360) % 360,
    crop: clampCrop(rotatedCrop),
  };
}

function flipEditorState(current: EditorState, axis: 'x' | 'y'): EditorState {
  const crop = current.crop;
  return axis === 'x'
    ? { ...current, flipX: !current.flipX, crop: { ...crop, x: 1 - crop.x - crop.width } }
    : { ...current, flipY: !current.flipY, crop: { ...crop, y: 1 - crop.y - crop.height } };
}

function adjustmentFilter(adjustments: ImageAdjustments, scale = 1): string {
  const exposureMultiplier = 2 ** (adjustments.exposure / 100);
  return [
    `brightness(${adjustments.brightness * exposureMultiplier}%)`,
    `contrast(${adjustments.contrast}%)`,
    `saturate(${adjustments.saturation}%)`,
    `hue-rotate(${adjustments.hue}deg)`,
    `sepia(${adjustments.sepia}%)`,
    `grayscale(${adjustments.grayscale}%)`,
    adjustments.blur > 0 ? `blur(${adjustments.blur * scale}px)` : '',
  ].filter(Boolean).join(' ');
}

function presetPreviewFilter(preset: FilterPreset): string {
  return adjustmentFilter({ ...DEFAULT_ADJUSTMENTS, ...preset.adjustments }, 0.35);
}

function renderImage(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  state: EditorState,
  targetWidth: number,
  targetHeight: number,
  original = false,
): void {
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  const adjustments = original ? DEFAULT_ADJUSTMENTS : state.adjustments;
  const scale = targetWidth / Math.max(1, state.width);
  const crop = state.crop;
  const isQuarterTurn = Math.abs(state.rotation % 180) === 90;
  const fullWidth = isQuarterTurn ? image.naturalHeight : image.naturalWidth;
  const fullHeight = isQuarterTurn ? image.naturalWidth : image.naturalHeight;
  const workingCanvas = document.createElement('canvas');
  workingCanvas.width = fullWidth;
  workingCanvas.height = fullHeight;
  const workingContext = workingCanvas.getContext('2d');
  if (!workingContext) return;

  workingContext.clearRect(0, 0, fullWidth, fullHeight);
  workingContext.save();
  workingContext.translate(fullWidth / 2, fullHeight / 2);
  workingContext.rotate(state.rotation * Math.PI / 180);
  workingContext.scale(state.flipX ? -1 : 1, state.flipY ? -1 : 1);
  const drawWidth = isQuarterTurn ? fullHeight : fullWidth;
  const drawHeight = isQuarterTurn ? fullWidth : fullHeight;
  workingContext.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  workingContext.restore();
  context.clearRect(0, 0, targetWidth, targetHeight);
  context.filter = adjustmentFilter(adjustments, scale);
  context.drawImage(
    workingCanvas,
    Math.round(crop.x * fullWidth),
    Math.round(crop.y * fullHeight),
    Math.round(crop.width * fullWidth),
    Math.round(crop.height * fullHeight),
    0,
    0,
    targetWidth,
    targetHeight,
  );
  context.filter = 'none';

  const needsPixelProcessing = adjustments.temperature !== 0
    || adjustments.tint !== 0
    || adjustments.highlights !== 0
    || adjustments.shadows !== 0
    || adjustments.whites !== 0
    || adjustments.blacks !== 0
    || adjustments.gamma !== 100
    || adjustments.red !== 0
    || adjustments.green !== 0
    || adjustments.blue !== 0
    || adjustments.fade !== 0
    || adjustments.dehaze !== 0
    || adjustments.vignette !== 0
    || adjustments.grain !== 0
    || adjustments.opacity !== 100;
  if (original || !needsPixelProcessing) return;
  const pixels = context.getImageData(0, 0, targetWidth, targetHeight);
  const data = pixels.data;
  const temperature = adjustments.temperature;
  const tint = adjustments.tint;
  const vignetteStrength = adjustments.vignette / 100;
  const grainStrength = adjustments.grain * 0.42;
  const gammaExponent = 100 / Math.max(1, adjustments.gamma);
  const fadeStrength = adjustments.fade / 100;
  const dehazeStrength = adjustments.dehaze / 100;
  const redMultiplier = 1 + adjustments.red / 100;
  const greenMultiplier = 1 + adjustments.green / 100;
  const blueMultiplier = 1 + adjustments.blue / 100;
  const opacityMultiplier = adjustments.opacity / 100;
  const centerX = targetWidth / 2;
  const centerY = targetHeight / 2;
  const maxDistance = Math.hypot(centerX, centerY);

  for (let index = 0; index < data.length; index += 4) {
    const pixelIndex = index / 4;
    const x = pixelIndex % targetWidth;
    const y = Math.floor(pixelIndex / targetWidth);
    const distance = Math.hypot(x - centerX, y - centerY) / maxDistance;
    const vignette = 1 - Math.max(0, distance - 0.28) ** 1.7 * vignetteStrength * 0.88;
    const noise = grainStrength ? (((pixelIndex * 16807) % 127) / 126 - 0.5) * grainStrength : 0;
    const luminance = (data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722) / 255;
    const shadowWeight = (1 - luminance) ** 2;
    const highlightWeight = luminance ** 2;
    const tonalShift = adjustments.shadows * shadowWeight * 0.82
      + adjustments.highlights * highlightWeight * 0.82
      + adjustments.blacks * shadowWeight ** 2 * 0.62
      + adjustments.whites * highlightWeight ** 2 * 0.62;
    const channelContrast = 1 + dehazeStrength * 0.55;
    const processChannel = (value: number, multiplier: number, temperatureShift: number, tintShift: number) => {
      let next = value + tonalShift + temperatureShift + tintShift;
      next = 128 + (next - 128) * channelContrast;
      next = 255 * (clamp(next) / 255) ** gammaExponent;
      next = next * (1 - fadeStrength * 0.42) + 142 * fadeStrength * 0.42;
      return clamp((next * multiplier + noise) * vignette);
    };
    data[index] = processChannel(data[index], redMultiplier, temperature * 0.34, -tint * 0.12);
    data[index + 1] = processChannel(data[index + 1], greenMultiplier, 0, tint * 0.24);
    data[index + 2] = processChannel(data[index + 2], blueMultiplier, -temperature * 0.34, -tint * 0.12);
    data[index + 3] = clamp(data[index + 3] * opacityMultiplier);
  }
  context.putImageData(pixels, 0, 0);
}

function createInitialState(width: number, height: number): EditorState {
  return {
    width,
    height,
    rotation: 0,
    flipX: false,
    flipY: false,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    adjustments: { ...DEFAULT_ADJUSTMENTS },
  };
}

function stateEquals(first: EditorState, second: EditorState): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

function SliderControl({ label, value, min, max, suffix = '', step = 1, onChange, onCommit }: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  step?: number;
  onChange: (value: number) => void;
  onCommit: () => void;
}) {
  return (
    <Slider
      minValue={min}
      maxValue={max}
      step={step}
      value={value}
      onChange={(next) => onChange(Number(next))}
      onChangeEnd={onCommit}
    >
      <Label>{label}</Label>
      <Slider.Output>{({ state }) => `${Math.round(state.values[0] * 10) / 10}${suffix}`}</Slider.Output>
      <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
    </Slider>
  );
}

function ToolButton({ label, isDisabled = false, onPress, children }: {
  label: string;
  isDisabled?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip delay={350}>
      <Button isIconOnly size="sm" variant="ghost" aria-label={label} isDisabled={isDisabled} onPress={onPress}>
        {children}
      </Button>
      <Tooltip.Content><p>{label}</p></Tooltip.Content>
    </Tooltip>
  );
}

export default function ImageEditor() {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const cropInteractionRef = useRef<CropInteraction | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const initialSizeRef = useRef({ width: 1920, height: 1080 });
  const [session, setSession] = useState<ImageEditorSession | null>(() => getImageEditorSession());
  const [imageObjectUrl, setImageObjectUrl] = useState('');
  const [editorState, setEditorState] = useState<EditorState>(() => createInitialState(1920, 1080));
  const [history, setHistory] = useState<EditorState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [loading, setLoading] = useState(Boolean(session));
  const [loadError, setLoadError] = useState('');
  const [activePreset, setActivePreset] = useState('original');
  const [lockAspect, setLockAspect] = useState(true);
  const [showOriginal, setShowOriginal] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [previewSize, setPreviewSize] = useState({ width: 1, height: 1 });
  const [stageSize, setStageSize] = useState({ width: 1, height: 1 });
  const [contextMenu, setContextMenu] = useState<EditorContextMenu | null>(null);
  const [isCropping, setIsCropping] = useState(false);
  const [cropDraft, setCropDraft] = useState<CropRect>({ x: 0, y: 0, width: 1, height: 1 });
  const [cropAspect, setCropAspect] = useState<CropAspect>('free');
  const [exportFormat, setExportFormat] = useState<'png' | 'jpeg' | 'webp'>('png');
  const [exportQuality, setExportQuality] = useState(92);
  const [exporting, setExporting] = useState(false);

  const currentSource = session
    ? (session.local_path ? localFileUrl(session.local_path) : session.src || session.preview_url || session.source_url || '')
    : '';

  useEffect(() => {
    if (!currentSource) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    let objectUrl = '';
    setLoading(true);
    setLoadError('');
    (async () => {
      try {
        const blob = await fetchEditableImage(currentSource, session?.source_page_url);
        objectUrl = URL.createObjectURL(blob);
        const image = new Image();
        image.src = objectUrl;
        await image.decode();
        if (cancelled) return;
        imageRef.current = image;
        setImageObjectUrl(objectUrl);
        const initial = createInitialState(image.naturalWidth, image.naturalHeight);
        initialSizeRef.current = { width: image.naturalWidth, height: image.naturalHeight };
        setEditorState(initial);
        setHistory([initial]);
        setHistoryIndex(0);
        setActivePreset('original');
        setZoom(100);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : '图片读取失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [currentSource, session?.source_page_url]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const maxPreviewDimension = 1600;
      const previewScale = Math.min(1, maxPreviewDimension / Math.max(editorState.width, editorState.height));
      renderImage(
        canvas,
        image,
        editorState,
        Math.max(1, Math.round(editorState.width * previewScale)),
        Math.max(1, Math.round(editorState.height * previewScale)),
        showOriginal,
      );
      setPreviewSize({ width: canvas.width, height: canvas.height });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editorState, imageObjectUrl, showOriginal]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const update = () => setStageSize({ width: stage.clientWidth, height: stage.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const reposition = () => {
      const menu = contextMenuRef.current;
      if (!menu) return;
      const bounds = menu.getBoundingClientRect();
      const x = Math.max(
        CONTEXT_MENU_MARGIN,
        Math.min(contextMenu.x, window.innerWidth - bounds.width - CONTEXT_MENU_MARGIN),
      );
      const y = Math.max(
        CONTEXT_MENU_MARGIN,
        Math.min(contextMenu.y, window.innerHeight - bounds.height - CONTEXT_MENU_MARGIN),
      );
      if (x !== contextMenu.x || y !== contextMenu.y) setContextMenu({ x, y });
    };
    const frame = window.requestAnimationFrame(reposition);
    const close = () => setContextMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    window.addEventListener('resize', reposition);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', reposition);
    };
  }, [contextMenu]);

  const pushHistory = (next: EditorState) => {
    const base = history.slice(0, historyIndex + 1);
    if (base.length && stateEquals(base[base.length - 1], next)) return;
    const updated = [...base, structuredClone(next)].slice(-50);
    setHistory(updated);
    setHistoryIndex(updated.length - 1);
  };

  const commitSnapshot = (next = editorState) => {
    pushHistory(next);
  };

  const commitState = (updater: (current: EditorState) => EditorState) => {
    const next = updater(editorState);
    setEditorState(next);
    pushHistory(next);
  };

  const undo = () => {
    if (historyIndex <= 0) return;
    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    setEditorState(structuredClone(history[nextIndex]));
  };

  const redo = () => {
    if (historyIndex >= history.length - 1) return;
    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    setEditorState(structuredClone(history[nextIndex]));
  };

  const updateAdjustment = (key: keyof ImageAdjustments, value: number) => {
    setActivePreset('custom');
    setEditorState((current) => ({ ...current, adjustments: { ...current.adjustments, [key]: value } }));
  };

  const applyPreset = (preset: FilterPreset) => {
    const next = { ...editorState, adjustments: { ...DEFAULT_ADJUSTMENTS, ...preset.adjustments } };
    setActivePreset(preset.id);
    setEditorState(next);
    commitSnapshot(next);
  };

  const updateDimension = (axis: 'width' | 'height', rawValue: number | undefined) => {
    if (!rawValue || !Number.isFinite(rawValue)) return;
    const value = Math.round(Math.max(1, Math.min(MAX_EXPORT_DIMENSION, rawValue)));
    commitState((current) => {
      if (!lockAspect) return { ...current, [axis]: value };
      const ratio = current.width / current.height;
      return axis === 'width'
        ? { ...current, width: value, height: Math.max(1, Math.round(value / ratio)) }
        : { ...current, width: Math.max(1, Math.round(value * ratio)), height: value };
    });
  };

  const rotate = (direction: -1 | 1) => {
    commitState((current) => rotateEditorState(current, direction));
  };

  const startCrop = () => {
    setCropDraft({ x: 0, y: 0, width: 1, height: 1 });
    setCropAspect('free');
    setIsCropping(true);
    setContextMenu(null);
  };

  const cancelCrop = () => {
    cropInteractionRef.current = null;
    setIsCropping(false);
    setCropDraft({ x: 0, y: 0, width: 1, height: 1 });
  };

  const applyCrop = () => {
    const draft = clampCrop(cropDraft);
    const isFull = draft.x < 0.0001 && draft.y < 0.0001 && draft.width > 0.9999 && draft.height > 0.9999;
    if (!isFull) {
      commitState((current) => ({
        ...current,
        width: Math.max(1, Math.round(current.width * draft.width)),
        height: Math.max(1, Math.round(current.height * draft.height)),
        crop: clampCrop({
          x: current.crop.x + draft.x * current.crop.width,
          y: current.crop.y + draft.y * current.crop.height,
          width: current.crop.width * draft.width,
          height: current.crop.height * draft.height,
        }),
      }));
    }
    cancelCrop();
  };

  const selectCropAspect = (aspect: CropAspect) => {
    setCropAspect(aspect);
    const selected = CROP_ASPECTS.find((item) => item.id === aspect);
    if (!selected || selected.ratio === null) return;
    if (selected.ratio === 0) {
      setCropDraft({ x: 0, y: 0, width: 1, height: 1 });
      return;
    }
    const normalizedRatio = selected.ratio / (editorState.width / editorState.height);
    let width = 0.9;
    let height = width / normalizedRatio;
    if (height > 0.9) {
      height = 0.9;
      width = height * normalizedRatio;
    }
    setCropDraft({ x: (1 - width) / 2, y: (1 - height) / 2, width, height });
  };

  const cropRatio = () => {
    const selected = CROP_ASPECTS.find((item) => item.id === cropAspect);
    if (!selected || selected.ratio === null) return null;
    const physicalRatio = selected.ratio === 0 ? editorState.width / editorState.height : selected.ratio;
    return physicalRatio / (editorState.width / editorState.height);
  };

  const beginCropInteraction = (event: React.PointerEvent, handle: CropHandle) => {
    event.preventDefault();
    event.stopPropagation();
    cropInteractionRef.current = {
      pointerId: event.pointerId,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      original: { ...cropDraft },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateCropInteraction = (event: React.PointerEvent) => {
    const interaction = cropInteractionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const dx = (event.clientX - interaction.startX) / Math.max(1, displayWidth);
    const dy = (event.clientY - interaction.startY) / Math.max(1, displayHeight);
    const original = interaction.original;
    if (interaction.handle === 'move') {
      setCropDraft(clampCrop({ ...original, x: original.x + dx, y: original.y + dy }));
      return;
    }
    let left = original.x;
    let top = original.y;
    let right = original.x + original.width;
    let bottom = original.y + original.height;
    if (interaction.handle.includes('w')) left += dx;
    if (interaction.handle.includes('e')) right += dx;
    if (interaction.handle.includes('n')) top += dy;
    if (interaction.handle.includes('s')) bottom += dy;
    const ratio = cropRatio();
    const minWidth = Math.min(0.25, 40 / Math.max(1, displayWidth));
    const minHeight = Math.min(0.25, 40 / Math.max(1, displayHeight));
    if (ratio) {
      const horizontal = interaction.handle.includes('e') || interaction.handle.includes('w') || interaction.handle === 'e' || interaction.handle === 'w';
      if (horizontal) {
        const width = Math.max(minWidth, right - left);
        const height = Math.max(minHeight, width / ratio);
        if (interaction.handle.includes('n')) top = bottom - height;
        else if (interaction.handle.includes('s')) bottom = top + height;
        else {
          const center = (top + bottom) / 2;
          top = center - height / 2;
          bottom = center + height / 2;
        }
      } else {
        const height = Math.max(minHeight, bottom - top);
        const width = Math.max(minWidth, height * ratio);
        const center = (left + right) / 2;
        left = center - width / 2;
        right = center + width / 2;
      }
    }
    if (right - left < minWidth) {
      if (interaction.handle.includes('w') || interaction.handle === 'w') left = right - minWidth;
      else right = left + minWidth;
    }
    if (bottom - top < minHeight) {
      if (interaction.handle.includes('n') || interaction.handle === 'n') top = bottom - minHeight;
      else bottom = top + minHeight;
    }
    setCropDraft(clampCrop({ x: left, y: top, width: right - left, height: bottom - top }));
  };

  const resetAll = () => {
    const next = createInitialState(initialSizeRef.current.width, initialSizeRef.current.height);
    setEditorState(next);
    setActivePreset('original');
    commitSnapshot(next);
  };

  const chooseImage = async () => {
    const path = await selectLocalImage();
    if (!path) return;
    const title = path.split(/[\\/]/).pop() || '图片';
    setSession({ src: localFileUrl(path), local_path: path, title, returnPath: session?.returnPath || '/' });
  };

  const applySizePreset = (key: string | null) => {
    if (!key) return;
    if (key === 'original') {
      commitState((current) => ({ ...current, ...initialSizeRef.current }));
      return;
    }
    const [width, height] = key.split('x').map(Number);
    commitState((current) => ({ ...current, width, height }));
  };

  const createExportBlob = async (): Promise<Blob> => {
    const image = imageRef.current;
    if (!image) throw new Error('没有可导出的图片');
    if (editorState.width * editorState.height > MAX_EXPORT_PIXELS) throw new Error('输出像素过大，请降低图片尺寸');
    const canvas = document.createElement('canvas');
    renderImage(canvas, image, editorState, editorState.width, editorState.height);
    const mimeType = `image/${exportFormat}`;
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('图片编码失败')), mimeType, exportQuality / 100);
    });
  };

  const exportImage = async (toDownloads: boolean) => {
    setExporting(true);
    try {
      const blob = await createExportBlob();
      const baseName = safeNameForFile(session?.title || 'edited-image', 'edited-image').replace(/\.[^.]+$/, '');
      const filename = `${baseName}-edited.${exportFormat === 'jpeg' ? 'jpg' : exportFormat}`;
      const path = toDownloads
        ? await saveBlobToDownloads(blob, filename)
        : await saveBlobAs(blob, filename);
      if (path) toast.success(toDownloads ? '已保存到下载目录' : '图片已导出', { description: path, timeout: 4000 });
    } catch (error) {
      toast.danger('导出失败', { description: error instanceof Error ? error.message : '请稍后重试', timeout: 0 });
    } finally {
      setExporting(false);
    }
  };

  const goBack = () => navigate(session?.returnPath || '/');
  const canEdit = Boolean(imageRef.current) && !loading && !loadError;
  const changeZoom = (delta: number) => setZoom((value) => Math.max(25, Math.min(400, value + delta)));
  const fitZoom = () => setZoom(100);
  const fitScale = Math.min(
    1,
    Math.max(0.05, (stageSize.width - 80) / previewSize.width),
    Math.max(0.05, (stageSize.height - 80) / previewSize.height),
  );
  const displayWidth = Math.max(1, Math.round(previewSize.width * fitScale * zoom / 100));
  const displayHeight = Math.max(1, Math.round(previewSize.height * fitScale * zoom / 100));

  const openContextMenu = (event: React.MouseEvent) => {
    if (!canEdit || isCropping) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: Math.max(CONTEXT_MENU_MARGIN, Math.min(event.clientX, window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_MARGIN)),
      y: Math.max(CONTEXT_MENU_MARGIN, event.clientY),
    });
  };

  const runContextMenuAction = (key: React.Key) => {
    const action = String(key);
    setContextMenu(null);
    if (action === 'undo') undo();
    else if (action === 'redo') redo();
    else if (action === 'zoom-in') changeZoom(25);
    else if (action === 'zoom-out') changeZoom(-25);
    else if (action === 'fit') fitZoom();
    else if (action === 'crop') startCrop();
    else if (action === 'rotate-left') rotate(-1);
    else if (action === 'rotate-right') rotate(1);
    else if (action === 'flip-horizontal') commitState((current) => flipEditorState(current, 'x'));
    else if (action === 'flip-vertical') commitState((current) => flipEditorState(current, 'y'));
    else if (action === 'compare') setShowOriginal((value) => !value);
    else if (action === 'reset') resetAll();
    else if (action === 'export') void exportImage(false);
  };

  useEffect(() => {
    const isEditingField = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return Boolean(element?.closest('input, textarea, select, [contenteditable="true"]'));
    };
    const keydown = (event: KeyboardEvent) => {
      if (isEditingField(event.target)) return;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (isCropping && event.key === 'Enter') {
        event.preventDefault();
        applyCrop();
        return;
      }
      if (isCropping && event.key === 'Escape') {
        event.preventDefault();
        cancelCrop();
        return;
      }
      if (isCropping) return;
      if (modifier && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (modifier && key === 'y') {
        event.preventDefault();
        redo();
      } else if (modifier && key === 'o') {
        event.preventDefault();
        void chooseImage();
      } else if (modifier && key === 's') {
        event.preventDefault();
        if (canEdit && !exporting) void exportImage(false);
      } else if (canEdit && (event.key === '+' || event.key === '=')) {
        event.preventDefault();
        changeZoom(25);
      } else if (canEdit && event.key === '-') {
        event.preventDefault();
        changeZoom(-25);
      } else if (canEdit && event.key === '0') {
        event.preventDefault();
        fitZoom();
      } else if (canEdit && key === 'c') {
        event.preventDefault();
        startCrop();
      } else if (canEdit && key === 'r') {
        event.preventDefault();
        rotate(event.shiftKey ? -1 : 1);
      } else if (canEdit && key === 'h') {
        event.preventDefault();
        commitState((current) => flipEditorState(current, 'x'));
      } else if (canEdit && key === 'v') {
        event.preventDefault();
        commitState((current) => flipEditorState(current, 'y'));
      } else if (canEdit && event.code === 'Space' && !event.repeat) {
        event.preventDefault();
        setShowOriginal(true);
      } else if (event.key === 'Escape' && contextMenu) {
        event.preventDefault();
        setContextMenu(null);
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !isEditingField(event.target)) setShowOriginal(false);
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
    };
  }, [canEdit, contextMenu, cropAspect, cropDraft, editorState, exportFormat, exportQuality, exporting, history, historyIndex, isCropping, session, zoom]);

  return (
    <div className="image-editor-shell flex size-full min-h-0 flex-col overflow-auto bg-background lg:overflow-hidden">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-3 py-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button isIconOnly size="sm" variant="ghost" aria-label="返回" onPress={goBack}><ArrowLeft size={18} /></Button>
          <Separator orientation="vertical" className="h-5" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">图片编辑</div>
            <div className="truncate text-xs text-muted">{session?.title || '选择一张图片开始'}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <ToolButton label="撤销" isDisabled={historyIndex <= 0} onPress={undo}><Undo2 size={16} /></ToolButton>
          <ToolButton label="重做" isDisabled={historyIndex >= history.length - 1} onPress={redo}><Redo2 size={16} /></ToolButton>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <Button size="sm" variant="secondary" onPress={chooseImage}><FolderOpen size={15} />打开图片</Button>
          <Button size="sm" onPress={() => void exportImage(false)} isPending={exporting} isDisabled={!canEdit}>
            {({ isPending }) => <>{isPending ? <Spinner size="sm" color="current" /> : <Download size={15} />}{isPending ? '导出中...' : '导出'}</>}
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[210px_minmax(0,1fr)_310px]">
        <aside className="order-2 border-t border-border bg-surface lg:order-none lg:min-h-0 lg:overflow-y-auto lg:border-r lg:border-t-0">
          <div className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div><div className="text-sm font-semibold">风格滤镜</div><div className="text-xs text-muted">一键建立画面基调</div></div>
              {activePreset === 'custom' && <span className="text-xs text-accent">自定义</span>}
            </div>
            <div className="grid grid-cols-4 gap-2 lg:grid-cols-2">
              {FILTER_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`group min-w-0 rounded-xl border p-1.5 text-left transition-[border-color,background-color,transform] duration-150 active:scale-[0.97] ${activePreset === preset.id ? 'border-accent bg-accent-soft' : 'border-transparent bg-surface-secondary hover:border-border'}`}
                  onClick={() => applyPreset(preset)}
                >
                  <div className="aspect-[4/3] overflow-hidden rounded-lg bg-default">
                    {imageObjectUrl ? <img src={imageObjectUrl} alt="" className="size-full object-cover" style={{ filter: presetPreviewFilter(preset) }} /> : null}
                  </div>
                  <div className="mt-1.5 truncate text-xs font-medium">{preset.name}</div>
                  <div className="hidden truncate text-[10px] text-muted lg:block">{preset.description}</div>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className="order-1 flex min-h-[420px] min-w-0 flex-col bg-[#151618] lg:order-none lg:min-h-0">
          <div className="flex h-11 shrink-0 items-center justify-center gap-1 border-b border-white/8 px-3 text-white/70">
            {isCropping ? (
              <>
                <Select aria-label="裁剪比例" className="w-36" value={cropAspect} onChange={(key) => key && selectCropAspect(String(key) as CropAspect)} variant="secondary">
                  <Select.Trigger className="h-8"><Select.Value /><Select.Indicator /></Select.Trigger>
                  <Select.Popover><ListBox>{CROP_ASPECTS.map((aspect) => <ListBox.Item key={aspect.id} id={aspect.id} textValue={aspect.label}>{aspect.label}<ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></Select.Popover>
                </Select>
                <Separator orientation="vertical" className="mx-2 h-5 bg-white/12" />
                <Button size="sm" variant="ghost" className="text-white/70" onPress={cancelCrop}><X size={15} />取消</Button>
                <Button size="sm" onPress={applyCrop}><Check size={15} />应用裁剪</Button>
              </>
            ) : (
              <>
                <ToolButton label="裁剪 (C)" isDisabled={!canEdit} onPress={startCrop}><Crop size={16} /></ToolButton>
                <ToolButton label="向左旋转" isDisabled={!canEdit} onPress={() => rotate(-1)}><RotateCcw size={16} /></ToolButton>
                <ToolButton label="向右旋转" isDisabled={!canEdit} onPress={() => rotate(1)}><RotateCw size={16} /></ToolButton>
                <ToolButton label="水平翻转" isDisabled={!canEdit} onPress={() => commitState((current) => flipEditorState(current, 'x'))}><FlipHorizontal2 size={16} /></ToolButton>
                <ToolButton label="垂直翻转" isDisabled={!canEdit} onPress={() => commitState((current) => flipEditorState(current, 'y'))}><FlipVertical2 size={16} /></ToolButton>
                <Separator orientation="vertical" className="mx-2 h-5 bg-white/12" />
                <Button size="sm" variant="ghost" className="text-white/70" onPress={() => setShowOriginal((value) => !value)} isDisabled={!canEdit}>
                  {showOriginal ? <EyeOff size={15} /> : <Eye size={15} />}{showOriginal ? '查看效果' : '对比原图'}
                </Button>
              </>
            )}
          </div>

          <div
            ref={stageRef}
            className="image-editor-stage relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-6 sm:p-10"
            onContextMenu={openContextMenu}
            onWheel={(event) => {
              if (!canEdit || (!event.ctrlKey && !event.metaKey)) return;
              event.preventDefault();
              changeZoom(event.deltaY < 0 ? 10 : -10);
            }}
          >
            {!session && !loading && (
              <Card className="max-w-sm items-center gap-4 p-8 text-center">
                <div className="flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent-soft-foreground"><ImagePlus size={26} /></div>
                <Card.Header className="items-center"><Card.Title>打开图片开始编辑</Card.Title><Card.Description>支持本地图片，也可以从全屏图片浏览器进入。</Card.Description></Card.Header>
                <Button onPress={chooseImage}><FolderOpen size={16} />选择图片</Button>
              </Card>
            )}
            {loading && <div className="flex flex-col items-center gap-3 text-white/70"><Spinner size="lg" color="current" /><span className="text-sm">正在准备高质量画布</span></div>}
            {loadError && !loading && (
              <Card className="max-w-sm items-center gap-3 p-6 text-center"><Card.Title>图片无法读取</Card.Title><Card.Description>{loadError}</Card.Description><Button variant="secondary" onPress={chooseImage}><FolderOpen size={15} />打开其他图片</Button></Card>
            )}
            {canEdit && (
              <div
                className={`relative flex shrink-0 items-center justify-center ${isCropping ? 'overflow-hidden' : ''}`}
                style={{ width: displayWidth, height: displayHeight }}
                onPointerMove={updateCropInteraction}
                onPointerUp={(event) => {
                  if (cropInteractionRef.current?.pointerId === event.pointerId) cropInteractionRef.current = null;
                }}
                onPointerCancel={() => { cropInteractionRef.current = null; }}
              >
                <canvas
                  ref={canvasRef}
                  className="block size-full bg-black shadow-2xl shadow-black/50"
                  aria-label="图片编辑预览"
                />
                {showOriginal && <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-medium text-white">原图</div>}
                {isCropping && (
                  <div
                    className="absolute border border-white shadow-[0_0_0_9999px_rgb(0_0_0/0.62)] cursor-move touch-none"
                    style={{
                      left: `${cropDraft.x * 100}%`,
                      top: `${cropDraft.y * 100}%`,
                      width: `${cropDraft.width * 100}%`,
                      height: `${cropDraft.height * 100}%`,
                    }}
                    onPointerDown={(event) => beginCropInteraction(event, 'move')}
                  >
                    <div className="pointer-events-none absolute left-1/3 top-0 h-full border-l border-white/45" />
                    <div className="pointer-events-none absolute left-2/3 top-0 h-full border-l border-white/45" />
                    <div className="pointer-events-none absolute left-0 top-1/3 w-full border-t border-white/45" />
                    <div className="pointer-events-none absolute left-0 top-2/3 w-full border-t border-white/45" />
                    <button type="button" aria-label="调整左上角" className="absolute left-0 top-0 size-4 cursor-nwse-resize border-l-3 border-t-3 border-white" onPointerDown={(event) => beginCropInteraction(event, 'nw')} />
                    <button type="button" aria-label="调整右上角" className="absolute right-0 top-0 size-4 cursor-nesw-resize border-r-3 border-t-3 border-white" onPointerDown={(event) => beginCropInteraction(event, 'ne')} />
                    <button type="button" aria-label="调整左下角" className="absolute bottom-0 left-0 size-4 cursor-nesw-resize border-b-3 border-l-3 border-white" onPointerDown={(event) => beginCropInteraction(event, 'sw')} />
                    <button type="button" aria-label="调整右下角" className="absolute bottom-0 right-0 size-4 cursor-nwse-resize border-b-3 border-r-3 border-white" onPointerDown={(event) => beginCropInteraction(event, 'se')} />
                    <button type="button" aria-label="调整上边缘" className="absolute left-1/2 top-0 h-3 w-8 -translate-x-1/2 cursor-ns-resize border-t-3 border-white" onPointerDown={(event) => beginCropInteraction(event, 'n')} />
                    <button type="button" aria-label="调整下边缘" className="absolute bottom-0 left-1/2 h-3 w-8 -translate-x-1/2 cursor-ns-resize border-b-3 border-white" onPointerDown={(event) => beginCropInteraction(event, 's')} />
                    <button type="button" aria-label="调整左边缘" className="absolute left-0 top-1/2 h-8 w-3 -translate-y-1/2 cursor-ew-resize border-l-3 border-white" onPointerDown={(event) => beginCropInteraction(event, 'w')} />
                    <button type="button" aria-label="调整右边缘" className="absolute right-0 top-1/2 h-8 w-3 -translate-y-1/2 cursor-ew-resize border-r-3 border-white" onPointerDown={(event) => beginCropInteraction(event, 'e')} />
                    <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/65 px-2 py-1 text-[10px] font-medium text-white">
                      {Math.max(1, Math.round(editorState.width * cropDraft.width))} × {Math.max(1, Math.round(editorState.height * cropDraft.height))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex h-10 shrink-0 items-center justify-between border-t border-white/8 px-3 text-xs text-white/55">
            <span>{canEdit ? `${editorState.width} × ${editorState.height} px` : '未打开图片'}</span>
            <div className="flex items-center gap-1">
              <Button isIconOnly size="sm" variant="ghost" className="text-white/60" aria-label="缩小" onPress={() => changeZoom(-25)}><ZoomOut size={14} /></Button>
              <button type="button" className="w-12 rounded px-1 py-1 text-center tabular-nums hover:bg-white/8" onClick={fitZoom} title="适应窗口 (0)">{zoom}%</button>
              <Button isIconOnly size="sm" variant="ghost" className="text-white/60" aria-label="放大" onPress={() => changeZoom(25)}><ZoomIn size={14} /></Button>
              <ToolButton label="适应窗口 (0)" onPress={fitZoom}><Focus size={14} /></ToolButton>
            </div>
          </div>
        </main>

        <aside className="order-3 border-t border-border bg-surface lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
          <Tabs defaultSelectedKey="adjust" className="flex min-h-0 flex-col">
            <Tabs.ListContainer className="sticky top-0 z-10 border-b border-border bg-surface px-2">
              <Tabs.List aria-label="编辑设置" className="w-full *:min-w-0 *:flex-1">
                <Tabs.Tab id="adjust"><SlidersHorizontal size={14} />调整<Tabs.Indicator /></Tabs.Tab>
                <Tabs.Tab id="size">尺寸<Tabs.Indicator /></Tabs.Tab>
                <Tabs.Tab id="export">输出<Tabs.Indicator /></Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>

            <Tabs.Panel id="adjust" className="space-y-5 p-4">
              <div className="text-xs font-semibold tracking-wide text-muted">光线</div>
              <SliderControl label="曝光" value={editorState.adjustments.exposure} min={-100} max={100} onChange={(value) => updateAdjustment('exposure', value)} onCommit={() => commitSnapshot()} />
              <SliderControl label="亮度" value={editorState.adjustments.brightness} min={0} max={200} suffix="%" onChange={(value) => updateAdjustment('brightness', value)} onCommit={() => commitSnapshot()} />
              <SliderControl label="对比度" value={editorState.adjustments.contrast} min={0} max={200} suffix="%" onChange={(value) => updateAdjustment('contrast', value)} onCommit={() => commitSnapshot()} />
              <SliderControl label="高光" value={editorState.adjustments.highlights} min={-100} max={100} onChange={(value) => updateAdjustment('highlights', value)} onCommit={() => commitSnapshot()} />
              <SliderControl label="阴影" value={editorState.adjustments.shadows} min={-100} max={100} onChange={(value) => updateAdjustment('shadows', value)} onCommit={() => commitSnapshot()} />
              <SliderControl label="白色色阶" value={editorState.adjustments.whites} min={-100} max={100} onChange={(value) => updateAdjustment('whites', value)} onCommit={() => commitSnapshot()} />
              <SliderControl label="黑色色阶" value={editorState.adjustments.blacks} min={-100} max={100} onChange={(value) => updateAdjustment('blacks', value)} onCommit={() => commitSnapshot()} />
              <SliderControl label="伽马" value={editorState.adjustments.gamma} min={50} max={150} onChange={(value) => updateAdjustment('gamma', value)} onCommit={() => commitSnapshot()} />
              <SliderControl label="饱和度" value={editorState.adjustments.saturation} min={0} max={200} suffix="%" onChange={(value) => updateAdjustment('saturation', value)} onCommit={() => commitSnapshot()} />
              <Separator />
              <div className="text-xs font-semibold tracking-wide text-muted">色彩</div>
              <SliderControl label="色温" value={editorState.adjustments.temperature} min={-100} max={100} onChange={(value) => updateAdjustment('temperature', value)} onCommit={() => commitSnapshot()} />
              <SliderControl label="色调" value={editorState.adjustments.tint} min={-100} max={100} onChange={(value) => updateAdjustment('tint', value)} onCommit={() => commitSnapshot()} />
              <SliderControl label="色相" value={editorState.adjustments.hue} min={-180} max={180} suffix="°" onChange={(value) => updateAdjustment('hue', value)} onCommit={() => commitSnapshot()} />
              <SliderControl label="红色通道" value={editorState.adjustments.red} min={-100} max={100} onChange={(value) => updateAdjustment('red', value)} onCommit={() => commitSnapshot()} />
              <SliderControl label="绿色通道" value={editorState.adjustments.green} min={-100} max={100} onChange={(value) => updateAdjustment('green', value)} onCommit={() => commitSnapshot()} />
              <SliderControl label="蓝色通道" value={editorState.adjustments.blue} min={-100} max={100} onChange={(value) => updateAdjustment('blue', value)} onCommit={() => commitSnapshot()} />
              <SliderControl label="复古褐色" value={editorState.adjustments.sepia} min={0} max={100} suffix="%" onChange={(value) => updateAdjustment('sepia', value)} onCommit={() => commitSnapshot()} />
              <SliderControl label="灰度" value={editorState.adjustments.grayscale} min={0} max={100} suffix="%" onChange={(value) => updateAdjustment('grayscale', value)} onCommit={() => commitSnapshot()} />
              <Separator />
              <div className="text-xs font-semibold tracking-wide text-muted">效果</div>
              <SliderControl label="褪色" value={editorState.adjustments.fade} min={0} max={100} suffix="%" onChange={(value) => updateAdjustment('fade', value)} onCommit={() => commitSnapshot()} />
              <SliderControl label="去雾" value={editorState.adjustments.dehaze} min={-100} max={100} onChange={(value) => updateAdjustment('dehaze', value)} onCommit={() => commitSnapshot()} />
              <SliderControl label="高斯模糊" value={editorState.adjustments.blur} min={0} max={30} suffix=" px" step={0.5} onChange={(value) => updateAdjustment('blur', value)} onCommit={() => commitSnapshot()} />
              <SliderControl label="暗角" value={editorState.adjustments.vignette} min={0} max={100} suffix="%" onChange={(value) => updateAdjustment('vignette', value)} onCommit={() => commitSnapshot()} />
              <SliderControl label="胶片颗粒" value={editorState.adjustments.grain} min={0} max={100} suffix="%" onChange={(value) => updateAdjustment('grain', value)} onCommit={() => commitSnapshot()} />
              <SliderControl label="不透明度" value={editorState.adjustments.opacity} min={0} max={100} suffix="%" onChange={(value) => updateAdjustment('opacity', value)} onCommit={() => commitSnapshot()} />
              <Button fullWidth variant="secondary" onPress={resetAll}><RefreshCcw size={15} />重置全部调整</Button>
            </Tabs.Panel>

            <Tabs.Panel id="size" className="space-y-5 p-4">
              <Select placeholder="选择常用尺寸" onSelectionChange={(key) => applySizePreset(key ? String(key) : null)}>
                <Label>尺寸预设</Label>
                <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                <Select.Popover><ListBox>{SIZE_PRESETS.map((size) => <ListBox.Item key={size.id} id={size.id} textValue={size.label}>{size.label}<ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></Select.Popover>
              </Select>
              <div className="space-y-4">
                <NumberField fullWidth value={editorState.width} minValue={1} maxValue={MAX_EXPORT_DIMENSION} onChange={(value) => updateDimension('width', value)} variant="secondary">
                  <Label>宽度（像素）</Label><NumberField.Group className="h-11"><NumberField.DecrementButton /><NumberField.Input className="min-w-0 flex-1 text-center text-base" /><NumberField.IncrementButton /></NumberField.Group>
                </NumberField>
                <NumberField fullWidth value={editorState.height} minValue={1} maxValue={MAX_EXPORT_DIMENSION} onChange={(value) => updateDimension('height', value)} variant="secondary">
                  <Label>高度（像素）</Label><NumberField.Group className="h-11"><NumberField.DecrementButton /><NumberField.Input className="min-w-0 flex-1 text-center text-base" /><NumberField.IncrementButton /></NumberField.Group>
                </NumberField>
              </div>
              <Switch isSelected={lockAspect} onChange={setLockAspect}>
                <Switch.Content><span className="flex items-center gap-2 text-sm">{lockAspect ? <Lock size={14} /> : <Unlock size={14} />}锁定纵横比</span></Switch.Content>
                <Switch.Control><Switch.Thumb /></Switch.Control>
              </Switch>
              <Card variant="secondary" className="gap-1 p-3"><div className="text-xs font-medium">原始图片</div><div className="text-xs text-muted">{initialSizeRef.current.width} × {initialSizeRef.current.height} px</div></Card>
              <Button fullWidth onPress={startCrop}><Crop size={16} />可视化裁剪</Button>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onPress={() => rotate(-1)}><RotateCcw size={15} />左转 90°</Button>
                <Button variant="secondary" onPress={() => rotate(1)}><RotateCw size={15} />右转 90°</Button>
                <Button variant="secondary" onPress={() => commitState((current) => flipEditorState(current, 'x'))}><FlipHorizontal2 size={15} />水平翻转</Button>
                <Button variant="secondary" onPress={() => commitState((current) => flipEditorState(current, 'y'))}><FlipVertical2 size={15} />垂直翻转</Button>
              </div>
            </Tabs.Panel>

            <Tabs.Panel id="export" className="space-y-5 p-4">
              <Select selectedKey={exportFormat} onSelectionChange={(key) => key && setExportFormat(String(key) as typeof exportFormat)}>
                <Label>图片格式</Label>
                <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                <Select.Popover><ListBox>
                  <ListBox.Item id="png" textValue="PNG 无损图片">PNG 无损图片<ListBox.ItemIndicator /></ListBox.Item>
                  <ListBox.Item id="jpeg" textValue="JPEG 图片">JPEG 图片<ListBox.ItemIndicator /></ListBox.Item>
                  <ListBox.Item id="webp" textValue="WebP 图片">WebP 图片<ListBox.ItemIndicator /></ListBox.Item>
                </ListBox></Select.Popover>
              </Select>
              {exportFormat !== 'png' && <SliderControl label="输出质量" value={exportQuality} min={40} max={100} suffix="%" onChange={setExportQuality} onCommit={() => undefined} />}
              <Card variant="secondary" className="gap-1 p-3"><div className="text-xs font-medium">输出信息</div><div className="text-xs text-muted">{editorState.width} × {editorState.height} px · {exportFormat.toUpperCase()}</div></Card>
              <Button fullWidth onPress={() => void exportImage(false)} isPending={exporting} isDisabled={!canEdit}><Save size={16} />另存为</Button>
              <Button fullWidth variant="secondary" onPress={() => void exportImage(true)} isPending={exporting} isDisabled={!canEdit}><Download size={16} />保存到下载目录</Button>
            </Tabs.Panel>
          </Tabs>
        </aside>
      </div>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu-enter fixed z-[80] max-h-[calc(100vh-1rem)] w-[260px] overflow-y-auto rounded-xl border border-border bg-background/98 p-1.5 text-foreground shadow-xl backdrop-blur"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <ListBox aria-label="图片编辑操作" selectionMode="none" onAction={runContextMenuAction}>
            <ListBox.Section>
              <ListBox.Item id="undo" textValue="撤销" isDisabled={historyIndex <= 0}><Undo2 size={16} className="text-muted" /><Label>撤销</Label><Kbd className="ms-auto" variant="light"><Kbd.Abbr keyValue="ctrl" /><Kbd.Content>Z</Kbd.Content></Kbd></ListBox.Item>
              <ListBox.Item id="redo" textValue="重做" isDisabled={historyIndex >= history.length - 1}><Redo2 size={16} className="text-muted" /><Label>重做</Label><Kbd className="ms-auto" variant="light"><Kbd.Abbr keyValue="ctrl" /><Kbd.Content>Y</Kbd.Content></Kbd></ListBox.Item>
            </ListBox.Section>
            <Separator />
            <ListBox.Section>
              <ListBox.Item id="zoom-in" textValue="放大"><ZoomIn size={16} className="text-muted" /><Label>放大</Label><Kbd className="ms-auto" variant="light"><Kbd.Content>+</Kbd.Content></Kbd></ListBox.Item>
              <ListBox.Item id="zoom-out" textValue="缩小"><ZoomOut size={16} className="text-muted" /><Label>缩小</Label><Kbd className="ms-auto" variant="light"><Kbd.Content>-</Kbd.Content></Kbd></ListBox.Item>
              <ListBox.Item id="fit" textValue="适应窗口"><Focus size={16} className="text-muted" /><Label>适应窗口</Label><Kbd className="ms-auto" variant="light"><Kbd.Content>0</Kbd.Content></Kbd></ListBox.Item>
            </ListBox.Section>
            <Separator />
            <ListBox.Section>
              <ListBox.Item id="crop" textValue="裁剪图片"><Crop size={16} className="text-muted" /><Label>裁剪图片</Label><Kbd className="ms-auto" variant="light"><Kbd.Content>C</Kbd.Content></Kbd></ListBox.Item>
              <ListBox.Item id="rotate-left" textValue="向左旋转"><RotateCcw size={16} className="text-muted" /><Label>向左旋转</Label><Kbd className="ms-auto" variant="light"><Kbd.Abbr keyValue="shift" /><Kbd.Content>R</Kbd.Content></Kbd></ListBox.Item>
              <ListBox.Item id="rotate-right" textValue="向右旋转"><RotateCw size={16} className="text-muted" /><Label>向右旋转</Label><Kbd className="ms-auto" variant="light"><Kbd.Content>R</Kbd.Content></Kbd></ListBox.Item>
              <ListBox.Item id="flip-horizontal" textValue="水平翻转"><FlipHorizontal2 size={16} className="text-muted" /><Label>水平翻转</Label><Kbd className="ms-auto" variant="light"><Kbd.Content>H</Kbd.Content></Kbd></ListBox.Item>
              <ListBox.Item id="flip-vertical" textValue="垂直翻转"><FlipVertical2 size={16} className="text-muted" /><Label>垂直翻转</Label><Kbd className="ms-auto" variant="light"><Kbd.Content>V</Kbd.Content></Kbd></ListBox.Item>
            </ListBox.Section>
            <Separator />
            <ListBox.Section>
              <ListBox.Item id="compare" textValue={showOriginal ? '查看效果' : '对比原图'}><Eye size={16} className="text-muted" /><Label>{showOriginal ? '查看效果' : '对比原图'}</Label><Kbd className="ms-auto" variant="light"><Kbd.Abbr keyValue="space" /></Kbd></ListBox.Item>
              <ListBox.Item id="reset" textValue="重置全部调整"><RefreshCcw size={16} className="text-muted" /><Label>重置全部调整</Label></ListBox.Item>
              <ListBox.Item id="export" textValue="导出图片"><Download size={16} className="text-muted" /><Label>导出图片</Label><Kbd className="ms-auto" variant="light"><Kbd.Abbr keyValue="ctrl" /><Kbd.Content>S</Kbd.Content></Kbd></ListBox.Item>
            </ListBox.Section>
          </ListBox>
        </div>
      )}
    </div>
  );
}
