import { useEffect, useRef, useState } from 'react';
import type {
  ChangeEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  WheelEvent as ReactWheelEvent,
} from 'react';
import {
  Button,
  ColorArea,
  ColorField,
  ColorPicker,
  ColorSlider,
  ColorSwatch,
  Description,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  Slider,
  Spinner,
  Switch,
  Tabs,
  TextArea,
  Tooltip,
  parseColor,
  toast,
} from '@heroui/react';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Brush,
  Box,
  Bold,
  ChevronDown,
  ChevronUp,
  Circle,
  Copy,
  CopyPlus,
  Crop,
  Download,
  Eye,
  EyeOff,
  FileArchive,
  FlipHorizontal2,
  FlipVertical2,
  Flower2,
  FolderOpen,
  Frame,
  Grid3X3,
  Hand,
  Heart,
  Hexagon,
  Image as ImageIcon,
  ImagePlus,
  Italic,
  Layers3,
  Leaf,
  Lock,
  Magnet,
  Maximize2,
  MousePointer2,
  Orbit,
  Palette,
  PanelLeft,
  PanelRight,
  Plus,
  Rainbow,
  Redo2,
  RotateCcw,
  Save,
  Shapes,
  SlidersHorizontal,
  Smile,
  Sparkles,
  Square,
  Star,
  StickyNote,
  Trash2,
  Triangle,
  Type,
  Underline,
  Undo2,
  Unlock,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  copyImageToClipboard,
  getDisplayResolutions,
  saveBlobAs,
  saveBlobToDownloads,
  setWallpaper,
} from '@/api/backend';
import type { DisplayResolution } from '@/api/backend';
import EditorCanvas from '@/components/WallpaperEditor/EditorCanvas';
import type { EditorCanvasHandle } from '@/components/WallpaperEditor/EditorCanvas';
import {
  cloneDocument,
  createLayerId,
  DEFAULT_DOCUMENT,
  DEFAULT_IMAGE_ADJUSTMENTS,
  DEFAULT_LAYER_EFFECTS,
} from '@/components/WallpaperEditor/types';
import { decodeWallpaperProject, encodeWallpaperProject } from '@/components/WallpaperEditor/projectFormat';
import { BEFORE_NAVIGATE_EVENT } from '@/lib/navigationGuard';
import type { NavigationRequestDetail } from '@/lib/navigationGuard';
import type {
  BorderStyle,
  BrushKind,
  BrushPoint,
  BrushSettings,
  BrushTexture,
  CropMaskShape,
  DecorationKind,
  EditorLayer,
  GradientType,
  ImageFit,
  ImageAdjustments,
  LayerBlendMode,
  LayerEffects,
  ShapeKind,
  StampOrientation,
  TextCharacterStyle,
  TextureType,
  WallpaperDocument,
} from '@/components/WallpaperEditor/types';

type ToolTab = 'background' | 'add' | 'brush';
type MobilePanel = 'tools' | 'layers' | null;
type CanvasTool = 'move' | 'hand' | 'brush';

const MIN_ZOOM = 5;
const MAX_ZOOM = 800;
const QUICK_EDITOR_SETTING_KEY = 'ltw:create:quick-editor-enabled';

const SIZE_PRESETS = [
  { id: '1920x1080', label: '桌面 1920 × 1080', width: 1920, height: 1080 },
  { id: '2560x1440', label: '高清 2560 × 1440', width: 2560, height: 1440 },
  { id: '3840x2160', label: '4K 3840 × 2160', width: 3840, height: 2160 },
  { id: '1080x1920', label: '手机 1080 × 1920', width: 1080, height: 1920 },
  { id: '1080x1080', label: '方形 1080 × 1080', width: 1080, height: 1080 },
];

const GRADIENT_PRESETS = [
  { name: '暮色山野', colors: ['#17233B', '#446A66', '#D8B67A'], angle: 128 },
  { name: '清晨薄雾', colors: ['#E9E4DA', '#B7CFCA', '#6F8F8B'], angle: 145 },
  { name: '柑橘海岸', colors: ['#194B60', '#D37C5A', '#F2D49B'], angle: 42 },
  { name: '莓果汽水', colors: ['#5D315C', '#C35C73', '#E9B872'], angle: 115 },
  { name: '青柠胶片', colors: ['#23352D', '#7D9B65', '#D8C992'], angle: 25 },
  { name: '蓝调时刻', colors: ['#10243D', '#356082', '#C2A878'], angle: 155 },
  { name: '纸上日光', colors: ['#F3EFE5', '#D8CDAE', '#A7B8A4'], angle: 90 },
  { name: '霓虹海报', colors: ['#172A46', '#D54B66', '#F0B94B'], angle: 30 },
];

const SOLID_COLORS = ['#F4F1EA', '#E7DCC8', '#A9C1B5', '#547A76', '#1C2938', '#111827', '#C85250', '#D9A441', '#6D5378', '#F8F8F6'];
const TEXTURES: Array<{ id: TextureType; label: string }> = [
  { id: 'none', label: '无' },
  { id: 'grain', label: '颗粒' },
  { id: 'paper', label: '纸张' },
  { id: 'dots', label: '圆点' },
  { id: 'grid', label: '网格' },
  { id: 'diagonal', label: '斜线' },
  { id: 'waves', label: '波纹' },
];

const SHAPES: Array<{ id: ShapeKind; label: string; icon: ReactNode }> = [
  { id: 'rectangle', label: '矩形', icon: <Square size={20} /> },
  { id: 'circle', label: '圆形', icon: <Circle size={20} /> },
  { id: 'triangle', label: '三角', icon: <Triangle size={20} /> },
  { id: 'star', label: '星形', icon: <Star size={20} /> },
  { id: 'hexagon', label: '六边形', icon: <Hexagon size={20} /> },
  { id: 'heart', label: '爱心', icon: <Heart size={20} /> },
];

const DECORATIONS: Array<{ id: DecorationKind; label: string; icon: ReactNode }> = [
  { id: 'sparkle', label: '闪光', icon: <Sparkles size={20} /> },
  { id: 'flower', label: '花朵', icon: <Flower2 size={20} /> },
  { id: 'leaf', label: '叶片', icon: <Leaf size={20} /> },
  { id: 'orbit', label: '轨道', icon: <Orbit size={20} /> },
  { id: 'rainbow', label: '拱形', icon: <Rainbow size={20} /> },
  { id: 'tape', label: '胶带', icon: <StickyNote size={20} /> },
];

const BORDER_STYLES: Array<{ id: BorderStyle; label: string }> = [
  { id: 'none', label: '无' },
  { id: 'solid', label: '实线' },
  { id: 'double', label: '双线' },
  { id: 'dashed', label: '虚线' },
  { id: 'film', label: '胶片' },
  { id: 'corners', label: '角标' },
];

const FONT_OPTIONS = [
  { id: 'sans-serif', label: '现代黑体' },
  { id: 'serif', label: '典雅宋体' },
  { id: 'KaiTi, serif', label: '楷体' },
  { id: 'FangSong, serif', label: '仿宋' },
  { id: 'monospace', label: '等宽体' },
];

const IMAGE_BLEND_OPTIONS: Array<{ id: LayerBlendMode; label: string }> = [
  { id: 'source-over', label: '正常' },
  { id: 'multiply', label: '正片叠底' },
  { id: 'screen', label: '滤色' },
  { id: 'overlay', label: '叠加' },
  { id: 'soft-light', label: '柔光' },
  { id: 'hard-light', label: '强光' },
  { id: 'darken', label: '变暗' },
  { id: 'lighten', label: '变亮' },
  { id: 'color-dodge', label: '颜色减淡' },
  { id: 'color-burn', label: '颜色加深' },
  { id: 'difference', label: '差值' },
  { id: 'exclusion', label: '排除' },
  { id: 'hue', label: '色相' },
  { id: 'saturation', label: '饱和度' },
  { id: 'color', label: '颜色' },
  { id: 'luminosity', label: '明度' },
];

const DEFAULT_BRUSH_SETTINGS: BrushSettings = {
  kind: 'solid',
  texture: 'smooth',
  size: 48,
  opacity: 100,
  color: '#F7F4ED',
  gradientColors: ['#D0524F', '#E2AA42'],
  spacing: 45,
  emoji: '✨',
  stampOrientation: 'follow',
  stampRotation: 0,
  distortWithDirection: false,
};

const IMAGE_FILTER_PRESETS: Array<{ id: string; label: string; adjustments: Partial<ImageAdjustments> }> = [
  { id: 'original', label: '原图', adjustments: { ...DEFAULT_IMAGE_ADJUSTMENTS } },
  { id: 'vivid', label: '鲜明', adjustments: { contrast: 112, saturation: 118, vibrance: 32 } },
  { id: 'warm', label: '暖阳', adjustments: { brightness: 106, warmth: 38, sepia: 12 } },
  { id: 'mono', label: '黑白', adjustments: { grayscale: 100, contrast: 118, saturation: 0 } },
  { id: 'film', label: '胶片', adjustments: { contrast: 108, saturation: 86, warmth: 18, grain: 24 } },
];

function SelectControl({
  label,
  value,
  options,
  onChange,
  className = '',
}: {
  label: string;
  value: string;
  options: Array<{ id: string; label: string }>;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <Select className={className} selectedKey={value} onSelectionChange={(key) => key && onChange(String(key))}>
      <Label>{label}</Label>
      <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
              {option.label}<ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function SliderControl({ label, value, min, max, step = 1, suffix = '', onChange, isDisabled = false }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
  isDisabled?: boolean;
}) {
  return (
    <Slider minValue={min} maxValue={max} step={step} value={value} onChange={(next) => onChange(Number(next))} isDisabled={isDisabled}>
      <Label>{label}</Label>
      <Slider.Output>{({ state }) => `${state.values[0]}${suffix}`}</Slider.Output>
      <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
    </Slider>
  );
}

function CropRangeControl({ label, start, end, onChange }: {
  label: string;
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
}) {
  return (
    <Slider
      minValue={0}
      maxValue={100}
      step={1}
      value={[Math.round(start), Math.round(end)]}
      onChange={(value) => {
        if (Array.isArray(value) && value.length >= 2) onChange(Number(value[0]), Number(value[1]));
      }}
    >
      <Label>{label}</Label>
      <Slider.Output>{({ state }) => `${Math.round(state.values[0])}% - ${Math.round(state.values[1])}%`}</Slider.Output>
      <Slider.Track>{({ state }) => <><Slider.Fill />{state.values.map((_, index) => <Slider.Thumb key={index} index={index} />)}</>}</Slider.Track>
    </Slider>
  );
}

function ColorControl({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  let color;
  try {
    color = parseColor(value);
  } catch {
    color = parseColor('#000000');
  }
  return (
    <ColorPicker value={color} onChange={(next) => onChange(next.toString('hex').toUpperCase())} className="min-w-0 flex-1">
      <ColorPicker.Trigger className="w-full justify-start gap-2">
        <ColorSwatch size="sm" />
        <Label className="min-w-0 flex-1 truncate text-left text-xs">{label}</Label>
      </ColorPicker.Trigger>
      <ColorPicker.Popover className="w-60 gap-3 p-3">
        <ColorArea aria-label={`${label}颜色区域`} className="h-36 w-full" colorSpace="hsb" xChannel="saturation" yChannel="brightness">
          <ColorArea.Thumb />
        </ColorArea>
        <ColorSlider aria-label={`${label}色相`} channel="hue" colorSpace="hsb">
          <ColorSlider.Track><ColorSlider.Thumb /></ColorSlider.Track>
        </ColorSlider>
        <ColorField aria-label={`${label}颜色值`}>
          <ColorField.Group variant="secondary">
            <ColorField.Prefix><ColorSwatch size="xs" /></ColorField.Prefix>
            <ColorField.Input />
          </ColorField.Group>
        </ColorField>
      </ColorPicker.Popover>
    </ColorPicker>
  );
}

function QuickColorAction({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  let color;
  try { color = parseColor(value); } catch { color = parseColor('#000000'); }
  return (
    <ColorPicker value={color} onChange={(next) => onChange(next.toString('hex').toUpperCase())}>
      <ColorPicker.Trigger className="h-8 w-8 min-w-8 p-1" aria-label={label}><ColorSwatch size="xs" /></ColorPicker.Trigger>
      <ColorPicker.Popover className="w-60 gap-3 p-3">
        <ColorArea aria-label={`${label}颜色区域`} className="h-36 w-full" colorSpace="hsb" xChannel="saturation" yChannel="brightness"><ColorArea.Thumb /></ColorArea>
        <ColorSlider aria-label={`${label}色相`} channel="hue" colorSpace="hsb"><ColorSlider.Track><ColorSlider.Thumb /></ColorSlider.Track></ColorSlider>
        <ColorField aria-label={`${label}颜色值`}><ColorField.Group variant="secondary"><ColorField.Prefix><ColorSwatch size="xs" /></ColorField.Prefix><ColorField.Input /></ColorField.Group></ColorField>
      </ColorPicker.Popover>
    </ColorPicker>
  );
}

function TransformField({ label, value, disabled, onChange }: {
  label: string;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted">{label}</Label>
      <Input
        type="number"
        value={String(Math.round(value))}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
        aria-label={label}
        disabled={disabled}
      />
    </div>
  );
}

function IconAction({ label, children, onPress, isDisabled = false, isActive = false }: {
  label: string;
  children: ReactNode;
  onPress: () => void;
  isDisabled?: boolean;
  isActive?: boolean;
}) {
  return (
    <Tooltip delay={0}>
      <Button isIconOnly size="sm" variant={isActive ? 'secondary' : 'ghost'} aria-label={label} onPress={onPress} isDisabled={isDisabled}>{children}</Button>
      <Tooltip.Content><p>{label}</p></Tooltip.Content>
    </Tooltip>
  );
}

function PanelSection({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-border px-4 py-4 last:border-b-0">
      <div className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</div>
      {children}
    </section>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function getImageDimensions(src: string): Promise<{ width: number; height: number; dominantColor: string }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = window.document.createElement('canvas');
      canvas.width = 24;
      canvas.height = 24;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      let dominantColor = '#596273';
      if (context) {
        context.drawImage(image, 0, 0, 24, 24);
        const pixels = context.getImageData(0, 0, 24, 24).data;
        const counts = new Map<string, number>();
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index + 3] < 100) continue;
          const color = `#${[pixels[index], pixels[index + 1], pixels[index + 2]].map((channel) => Math.round(channel / 24) * 24).map((channel) => Math.min(255, channel).toString(16).padStart(2, '0')).join('')}`;
          counts.set(color, (counts.get(color) || 0) + 1);
        }
        dominantColor = [...counts.entries()].sort((first, second) => second[1] - first[1])[0]?.[0] || dominantColor;
      }
      resolve({ width: image.naturalWidth, height: image.naturalHeight, dominantColor });
    };
    image.onerror = () => reject(new Error('无法读取图片尺寸'));
    image.src = src;
  });
}

function layerIcon(layer: EditorLayer) {
  if (layer.type === 'text') return <Type size={15} />;
  if (layer.type === 'image') return <ImageIcon size={15} />;
  if (layer.type === 'paint') return <Brush size={15} />;
  if (layer.type === 'decoration') return <Sparkles size={15} />;
  return <Shapes size={15} />;
}

export default function Create() {
  const [document, setDocument] = useState<WallpaperDocument>(() => cloneDocument(DEFAULT_DOCUMENT));
  const documentRef = useRef(document);
  const pastRef = useRef<WallpaperDocument[]>([]);
  const futureRef = useRef<WallpaperDocument[]>([]);
  const historyGroupRef = useRef<{ key: string; updatedAt: number } | null>(null);
  const documentRevisionRef = useRef(0);
  const dirtyRef = useRef(false);
  const pendingNavigationRef = useRef<(() => void) | null>(null);
  const zoomRef = useRef(30);
  const spacePressedRef = useRef(false);
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toolTab, setToolTab] = useState<ToolTab>('background');
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('tools');
  const [panelsHidden, setPanelsHidden] = useState(false);
  const [zoom, setZoom] = useState(30);
  const [canvasTool, setCanvasTool] = useState<CanvasTool>('move');
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [snapToGuides, setSnapToGuides] = useState(true);
  const [displayResolutions, setDisplayResolutions] = useState<DisplayResolution[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [navigationPromptOpen, setNavigationPromptOpen] = useState(false);
  const [navigationSaving, setNavigationSaving] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'png' | 'jpeg'>('png');
  const [exportQuality, setExportQuality] = useState(92);
  const [exportName, setExportName] = useState('我的壁纸');
  const [exporting, setExporting] = useState(false);
  const [cropEditingId, setCropEditingId] = useState<string | null>(null);
  const [brushSettings, setBrushSettings] = useState<BrushSettings>(DEFAULT_BRUSH_SETTINGS);
  const [adjustmentTarget, setAdjustmentTarget] = useState<'background' | string | null>(null);
  const [quickEditorEnabled, setQuickEditorEnabled] = useState(() => localStorage.getItem(QUICK_EDITOR_SETTING_KEY) !== 'false');
  const [quickEditor, setQuickEditor] = useState<{ id: string; x: number; y: number } | null>(null);
  const [textSelection, setTextSelection] = useState({ start: 0, end: 0 });
  const canvasRef = useRef<EditorCanvasHandle>(null);
  const canvasViewportRef = useRef<HTMLDivElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const layerImageInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const brushImageInputRef = useRef<HTMLInputElement>(null);
  const selectedLayer = document.layers.find((layer) => layer.id === selectedId) || null;
  const selectedImageCrop = selectedLayer?.type === 'image'
    ? selectedLayer.crop || { x: 0, y: 0, width: 1, height: 1 }
    : null;
  const selectedEffects = selectedLayer?.effects || DEFAULT_LAYER_EFFECTS;
  const quickLayer = quickEditor ? document.layers.find((layer) => layer.id === quickEditor.id) || null : null;
  const adjustmentImageLayer = adjustmentTarget && adjustmentTarget !== 'background'
    ? document.layers.find((layer) => layer.id === adjustmentTarget && layer.type === 'image')
    : null;
  const activeAdjustments = adjustmentTarget === 'background'
    ? document.background.adjustments || DEFAULT_IMAGE_ADJUSTMENTS
    : adjustmentImageLayer?.type === 'image'
      ? adjustmentImageLayer.adjustments || DEFAULT_IMAGE_ADJUSTMENTS
      : DEFAULT_IMAGE_ADJUSTMENTS;
  const selectedTextHasMixedStyles = selectedLayer?.type === 'text'
    ? Boolean(selectedLayer.characterStyles?.some((style) => Object.keys(style).length > 0))
    : false;
  const selectedTextRange = selectedLayer?.type === 'text' ? {
    start: Array.from(selectedLayer.text.slice(0, textSelection.start)).length,
    end: Array.from(selectedLayer.text.slice(0, textSelection.end)).length,
  } : { start: 0, end: 0 };
  const selectedCharacterStyle = selectedLayer?.type === 'text' ? {
    color: selectedLayer.characterStyles?.[selectedTextRange.start]?.color || selectedLayer.color,
    backgroundColor: selectedLayer.characterStyles?.[selectedTextRange.start]?.backgroundColor || '#F4D35E',
    fontSize: selectedLayer.characterStyles?.[selectedTextRange.start]?.fontSize || selectedLayer.fontSize,
    fontFamily: selectedLayer.characterStyles?.[selectedTextRange.start]?.fontFamily || selectedLayer.fontFamily,
    fontWeight: selectedLayer.characterStyles?.[selectedTextRange.start]?.fontWeight || selectedLayer.fontWeight,
    fontStyle: selectedLayer.characterStyles?.[selectedTextRange.start]?.fontStyle || 'normal',
    underline: Boolean(selectedLayer.characterStyles?.[selectedTextRange.start]?.underline),
    letterSpacing: selectedLayer.characterStyles?.[selectedTextRange.start]?.letterSpacing ?? selectedLayer.letterSpacing,
  } : null;
  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;
  const currentSizeId = `${document.width}x${document.height}`;
  const detectedAndPresetSizes = [
    ...displayResolutions.map((display) => ({
      id: `${display.width}x${display.height}`,
      label: `${display.is_primary ? '主显示器' : display.name} ${display.width} × ${display.height}`,
      width: display.width,
      height: display.height,
    })),
    ...SIZE_PRESETS,
  ];
  const sizeOptions = [
    ...(detectedAndPresetSizes.some((option) => option.id === currentSizeId) ? [] : [{ id: currentSizeId, label: `自定义 ${document.width} × ${document.height}`, width: document.width, height: document.height }]),
    ...detectedAndPresetSizes,
  ].filter((option, index, options) => options.findIndex((item) => item.id === option.id) === index);
  void historyRevision;

  const setCurrentDocument = (next: WallpaperDocument) => {
    documentRevisionRef.current += 1;
    documentRef.current = next;
    setDocument(next);
  };

  const setProjectDirty = (dirty: boolean) => {
    dirtyRef.current = dirty;
    setIsDirty(dirty);
  };

  const pushPast = (snapshot: WallpaperDocument) => {
    pastRef.current = [...pastRef.current, cloneDocument(snapshot)].slice(-60);
    futureRef.current = [];
    setHistoryRevision((revision) => revision + 1);
    setProjectDirty(true);
  };

  const commitDocument = (updater: (current: WallpaperDocument) => WallpaperDocument, historyGroup?: string) => {
    const current = documentRef.current;
    const next = updater(cloneDocument(current));
    const now = Date.now();
    const continuesGroup = historyGroup
      && historyGroupRef.current?.key === historyGroup
      && now - historyGroupRef.current.updatedAt < 700;
    if (!continuesGroup) pushPast(current);
    historyGroupRef.current = historyGroup ? { key: historyGroup, updatedAt: now } : null;
    setCurrentDocument(next);
    setProjectDirty(true);
  };

  const patchDocument = (patch: Partial<WallpaperDocument>) => {
    commitDocument((current) => ({ ...current, ...patch }));
  };

  const patchSelected = (patch: Record<string, unknown>) => {
    if (!selectedId) return;
    const currentLayer = documentRef.current.layers.find((layer) => layer.id === selectedId);
    if (!currentLayer) return;
    const transformKeys = new Set(['x', 'y', 'width', 'height', 'rotation', 'flipX', 'flipY']);
    if (currentLayer.locked && Object.keys(patch).some((key) => transformKeys.has(key))) return;
    const historyGroup = `layer:${selectedId}:${Object.keys(patch).sort().join(',')}`;
    commitDocument((current) => ({
      ...current,
      layers: current.layers.map((layer) => layer.id === selectedId ? { ...layer, ...patch } as EditorLayer : layer),
    }), historyGroup);
  };

  const patchSelectedEffects = (patch: Partial<LayerEffects>) => {
    if (!selectedLayer) return;
    patchSelected({ effects: { ...DEFAULT_LAYER_EFFECTS, ...selectedLayer.effects, ...patch } });
  };

  const applySelectedTextStyle = (patch: Partial<TextCharacterStyle>) => {
    if (!selectedLayer || selectedLayer.type !== 'text' || selectedTextRange.end <= selectedTextRange.start) return;
    const glyphCount = Array.from(selectedLayer.text).length;
    const characterStyles = Array.from({ length: glyphCount }, (_, index) => ({ ...(selectedLayer.characterStyles?.[index] || {}) }));
    for (let index = selectedTextRange.start; index < selectedTextRange.end; index += 1) {
      characterStyles[index] = { ...characterStyles[index], ...patch };
    }
    patchSelected({ characterStyles });
  };

  const openLayerProperties = (id: string) => {
    const layer = documentRef.current.layers.find((item) => item.id === id);
    setSelectedId(id);
    setPanelsHidden(false);
    setMobilePanel('layers');
    setQuickEditor(null);
    if (layer?.type === 'text') {
      window.requestAnimationFrame(() => {
        const editor = window.document.querySelector<HTMLTextAreaElement>('textarea[aria-label="文字内容"]');
        editor?.focus();
        editor?.select();
        if (editor) setTextSelection({ start: 0, end: editor.value.length });
      });
    }
  };

  const patchImageAdjustments = (target: 'background' | string, patch: Partial<ImageAdjustments>) => {
    const key = Object.keys(patch).sort().join(',');
    if (target === 'background') {
      commitDocument((current) => ({
        ...current,
        background: {
          ...current.background,
          adjustments: { ...DEFAULT_IMAGE_ADJUSTMENTS, ...current.background.adjustments, ...patch },
        },
      }), `background:adjustments:${key}`);
      return;
    }
    commitDocument((current) => ({
      ...current,
      layers: current.layers.map((layer) => layer.id === target && layer.type === 'image'
        ? { ...layer, adjustments: { ...DEFAULT_IMAGE_ADJUSTMENTS, ...layer.adjustments, ...patch } }
        : layer),
    }), `image:${target}:adjustments:${key}`);
  };

  const applyImageFilterPreset = (target: 'background' | string, preset: Partial<ImageAdjustments>) => {
    patchImageAdjustments(target, { ...DEFAULT_IMAGE_ADJUSTMENTS, ...preset });
  };

  const replaceLayerLive = (nextLayer: EditorLayer) => {
    const next = {
      ...documentRef.current,
      layers: documentRef.current.layers.map((layer) => layer.id === nextLayer.id ? nextLayer : layer),
    };
    setCurrentDocument(next);
  };

  const replaceCropLive = (id: string, crop: { x: number; y: number; width: number; height: number }) => {
    setCurrentDocument({
      ...documentRef.current,
      layers: documentRef.current.layers.map((layer) => layer.id === id && layer.type === 'image' ? { ...layer, crop } : layer),
    });
  };

  const commitCrop = (id: string, originalCrop: { x: number; y: number; width: number; height: number }) => {
    const current = documentRef.current;
    const changed = current.layers.find((layer) => layer.id === id && layer.type === 'image');
    if (!changed || changed.type !== 'image') return;
    const crop = changed.crop || { x: 0, y: 0, width: 1, height: 1 };
    if (crop.x === originalCrop.x && crop.y === originalCrop.y && crop.width === originalCrop.width && crop.height === originalCrop.height) return;
    const before = cloneDocument(current);
    before.layers = before.layers.map((layer) => layer.id === id && layer.type === 'image' ? { ...layer, crop: originalCrop } : layer);
    pushPast(before);
  };

  const commitCanvasInteraction = (original: EditorLayer, duplicated = false) => {
    if (duplicated) return;
    const current = documentRef.current;
    const changed = current.layers.find((layer) => layer.id === original.id);
    if (!changed || (changed.x === original.x && changed.y === original.y
      && changed.width === original.width && changed.height === original.height
      && changed.rotation === original.rotation
      && (changed.type !== 'shape' || original.type !== 'shape' || changed.radius === original.radius))) return;
    const before = cloneDocument(current);
    before.layers = before.layers.map((layer) => layer.id === original.id ? original : layer);
    pushPast(before);
  };

  const undo = () => {
    const previous = pastRef.current.pop();
    if (!previous) return;
    futureRef.current.push(cloneDocument(documentRef.current));
    setCurrentDocument(previous);
    setHistoryRevision((revision) => revision + 1);
    historyGroupRef.current = null;
    setProjectDirty(true);
  };

  const redo = () => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(cloneDocument(documentRef.current));
    setCurrentDocument(next);
    setHistoryRevision((revision) => revision + 1);
    historyGroupRef.current = null;
    setProjectDirty(true);
  };

  const addLayer = (layer: EditorLayer) => {
    commitDocument((current) => ({ ...current, layers: [...current.layers, layer] }));
    setSelectedId(layer.id);
    setMobilePanel(null);
  };

  const addShape = (shape: ShapeKind) => {
    addLayer({
      id: createLayerId('shape'), type: 'shape', name: SHAPES.find((item) => item.id === shape)?.label || '形状',
      visible: true, locked: false, opacity: 100, x: document.width / 2, y: document.height / 2,
      width: 360, height: shape === 'rectangle' ? 240 : 320, rotation: 0, shape,
      fill: '#F4F1EA', stroke: '#FFFFFF', strokeWidth: 0, radius: 32,
      shadowColor: '#000000', shadowBlur: 0,
    });
  };

  const addDecoration = (decoration: DecorationKind) => {
    addLayer({
      id: createLayerId('decoration'), type: 'decoration', name: DECORATIONS.find((item) => item.id === decoration)?.label || '装饰',
      visible: true, locked: false, opacity: 100, x: document.width / 2, y: document.height / 2,
      width: decoration === 'tape' ? 280 : 220, height: decoration === 'tape' ? 82 : 220,
      rotation: decoration === 'tape' ? -8 : 0, decoration, color: '#F4F1EA', secondaryColor: '#D9A441', strokeWidth: 12,
    });
  };

  const addText = (preset: 'title' | 'subtitle' | 'label' | 'outline' = 'title') => {
    const presets = {
      title: { text: '写下此刻', fontSize: 138, fontWeight: 700, color: '#F7F4ED', strokeWidth: 0 },
      subtitle: { text: 'A MOMENT TO KEEP', fontSize: 48, fontWeight: 500, color: '#F7F4ED', strokeWidth: 0 },
      label: { text: 'VOL. 01  /  TODAY', fontSize: 34, fontWeight: 600, color: '#17233B', strokeWidth: 0 },
      outline: { text: 'OUTLINE', fontSize: 128, fontWeight: 800, color: '#000000', strokeWidth: 5 },
    }[preset];
    addLayer({
      id: createLayerId('text'), type: 'text', name: preset === 'title' ? '主标题' : preset === 'subtitle' ? '副标题' : '文字',
      visible: true, locked: false, opacity: 100, x: document.width / 2, y: document.height / 2,
      width: Math.min(1100, document.width * 0.72), height: preset === 'subtitle' || preset === 'label' ? 100 : 220,
      rotation: 0, ...presets, fontFamily: 'sans-serif', align: 'center', letterSpacing: preset === 'subtitle' ? 10 : 0,
      lineHeight: 1.15, stroke: '#F7F4ED', shadowColor: '#000000', shadowBlur: 0,
    });
  };

  const commitBrushStroke = (points: BrushPoint[], settings: BrushSettings) => {
    if (points.length === 0) return;
    const padding = Math.max(8, settings.size * 0.75);
    let rawMinX = points[0].x;
    let rawMaxX = points[0].x;
    let rawMinY = points[0].y;
    let rawMaxY = points[0].y;
    points.forEach((point) => {
      rawMinX = Math.min(rawMinX, point.x);
      rawMaxX = Math.max(rawMaxX, point.x);
      rawMinY = Math.min(rawMinY, point.y);
      rawMaxY = Math.max(rawMaxY, point.y);
    });
    const minX = rawMinX - padding;
    const maxX = rawMaxX + padding;
    const minY = rawMinY - padding;
    const maxY = rawMaxY + padding;
    const x = (minX + maxX) / 2;
    const y = (minY + maxY) / 2;
    const sourceWidth = Math.max(24, maxX - minX);
    const sourceHeight = Math.max(24, maxY - minY);
    const layer: EditorLayer = {
      id: createLayerId('paint'),
      type: 'paint',
      name: settings.kind === 'image' ? '图片画笔' : settings.kind === 'emoji' ? 'Emoji 画笔' : '画笔笔触',
      visible: true,
      locked: false,
      x,
      y,
      width: sourceWidth,
      height: sourceHeight,
      rotation: 0,
      ...structuredClone(settings),
      gradientColors: [...settings.gradientColors],
      sourceWidth,
      sourceHeight,
      points: points.map((point) => ({ x: point.x - x, y: point.y - y, angle: point.angle })),
    };
    commitDocument((current) => ({ ...current, layers: [...current.layers, layer] }));
    setSelectedId(layer.id);
  };

  const patchBrushSettings = (patch: Partial<BrushSettings>) => {
    setBrushSettings((current) => ({ ...current, ...patch }));
  };

  const removeLayer = (id: string) => {
    commitDocument((current) => ({ ...current, layers: current.layers.filter((layer) => layer.id !== id) }));
    if (selectedId === id) setSelectedId(null);
    if (quickEditor?.id === id) setQuickEditor(null);
  };

  const duplicateLayer = (id: string) => {
    const source = documentRef.current.layers.find((layer) => layer.id === id);
    if (!source) return;
    addLayer({ ...structuredClone(source), id: createLayerId(source.type), name: `${source.name} 副本`, x: source.x + 36, y: source.y + 36 });
  };

  const duplicateLayerForDrag = (source: EditorLayer): EditorLayer => {
    const duplicate = {
      ...structuredClone(source),
      id: createLayerId(source.type),
      name: `${source.name} 副本`,
    };
    commitDocument((current) => ({ ...current, layers: [...current.layers, duplicate] }));
    setSelectedId(duplicate.id);
    return duplicate;
  };

  const moveLayer = (id: string, direction: -1 | 1) => {
    const currentIndex = documentRef.current.layers.findIndex((layer) => layer.id === id);
    if (currentIndex < 0 || currentIndex + direction < 0 || currentIndex + direction >= documentRef.current.layers.length) return;
    commitDocument((current) => {
      const index = current.layers.findIndex((layer) => layer.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.layers.length) return current;
      const layers = [...current.layers];
      [layers[index], layers[target]] = [layers[target], layers[index]];
      return { ...current, layers };
    });
  };

  const moveLayerToEdge = (id: string, edge: 'front' | 'back') => {
    const currentIndex = documentRef.current.layers.findIndex((layer) => layer.id === id);
    const targetIndex = edge === 'front' ? documentRef.current.layers.length - 1 : 0;
    if (currentIndex < 0 || currentIndex === targetIndex) return;
    commitDocument((current) => {
      const layers = current.layers.filter((layer) => layer.id !== id);
      const layer = current.layers[currentIndex];
      if (edge === 'front') layers.push(layer); else layers.unshift(layer);
      return { ...current, layers };
    });
  };

  const alignSelected = (alignment: 'left' | 'horizontal' | 'right' | 'top' | 'vertical' | 'bottom') => {
    if (!selectedLayer || selectedLayer.locked) return;
    if (alignment === 'left') patchSelected({ x: selectedLayer.width / 2 });
    else if (alignment === 'horizontal') patchSelected({ x: document.width / 2 });
    else if (alignment === 'right') patchSelected({ x: document.width - selectedLayer.width / 2 });
    else if (alignment === 'top') patchSelected({ y: selectedLayer.height / 2 });
    else if (alignment === 'vertical') patchSelected({ y: document.height / 2 });
    else patchSelected({ y: document.height - selectedLayer.height / 2 });
  };

  const updateSelectedSize = (dimension: 'width' | 'height', value: number) => {
    if (!selectedLayer) return;
    const size = Math.max(24, value || 24);
    if (selectedLayer.type === 'image' && selectedLayer.aspectRatioLocked) {
      const ratio = selectedLayer.sourceAspectRatio || selectedLayer.width / selectedLayer.height;
      if (dimension === 'width') patchSelected({ width: size, height: Math.max(24, size / ratio) });
      else patchSelected({ height: size, width: Math.max(24, size * ratio) });
      return;
    }
    patchSelected({ [dimension]: size });
  };

  const setZoomLevel = (value: number, focalPoint?: { clientX: number; clientY: number }) => {
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value)));
    const viewport = canvasViewportRef.current;
    const canvas = viewport?.querySelector('canvas');
    const previousBounds = canvas?.getBoundingClientRect();
    const canvasX = focalPoint && previousBounds ? (focalPoint.clientX - previousBounds.left) / previousBounds.width : null;
    const canvasY = focalPoint && previousBounds ? (focalPoint.clientY - previousBounds.top) / previousBounds.height : null;
    zoomRef.current = nextZoom;
    setZoom(nextZoom);

    if (!viewport || !focalPoint || canvasX === null || canvasY === null) return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const nextBounds = canvas?.getBoundingClientRect();
        if (!nextBounds) return;
        const nextClientX = nextBounds.left + nextBounds.width * canvasX;
        const nextClientY = nextBounds.top + nextBounds.height * canvasY;
        viewport.scrollLeft += nextClientX - focalPoint.clientX;
        viewport.scrollTop += nextClientY - focalPoint.clientY;
      });
    });
  };

  const changeZoom = (direction: -1 | 1, focalPoint?: { clientX: number; clientY: number }) => {
    const current = zoomRef.current;
    const step = current < 50 ? 5 : current < 200 ? 10 : current < 400 ? 25 : 50;
    setZoomLevel(current + direction * step, focalPoint);
  };

  const handleViewportWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey && !event.altKey) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    setZoomLevel(zoomRef.current * factor, { clientX: event.clientX, clientY: event.clientY });
  };

  const handleViewportPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const shouldPan = event.button === 1 || (event.button === 0 && (spacePressedRef.current || canvasTool === 'hand'));
    if (!shouldPan) return;
    event.preventDefault();
    event.stopPropagation();
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: event.currentTarget.scrollLeft,
      scrollTop: event.currentTarget.scrollTop,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanning(true);
  };

  const handleViewportPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.currentTarget.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
    event.currentTarget.scrollTop = pan.scrollTop - (event.clientY - pan.startY);
  };

  const handleViewportPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    panRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setIsPanning(false);
  };

  const handleLayerQuickEdit = (id: string | null, bounds: { left: number; top: number; right: number; bottom: number } | null) => {
    if (!id || !quickEditorEnabled || canvasTool !== 'move' || cropEditingId) {
      setQuickEditor(null);
      return;
    }
    if (!bounds) return;
    const panelWidth = 380;
    const panelHeight = 44;
    if (quickEditor?.id === id) return;
    const x = Math.max(8, Math.min(window.innerWidth - panelWidth - 8, (bounds.left + bounds.right - panelWidth) / 2));
    const y = bounds.top >= panelHeight + 12
      ? bounds.top - panelHeight - 8
      : Math.min(window.innerHeight - panelHeight - 8, bounds.bottom + 8);
    setQuickEditor({
      id,
      x,
      y,
    });
  };

  const fitCanvas = () => {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;
    const availableWidth = Math.max(180, viewport.clientWidth - 72);
    const availableHeight = Math.max(180, viewport.clientHeight - 72);
    const next = Math.min(100, Math.max(MIN_ZOOM, Math.floor(Math.min(availableWidth / document.width, availableHeight / document.height) * 100)));
    setZoomLevel(next);
  };

  useEffect(() => {
    const frame = window.requestAnimationFrame(fitCanvas);
    return () => window.cancelAnimationFrame(frame);
  }, [document.width, document.height]);

  useEffect(() => {
    let active = true;
    void getDisplayResolutions()
      .then((resolutions) => {
        if (active) setDisplayResolutions(resolutions.filter((item) => item.width > 0 && item.height > 0));
      })
      .catch(() => {
        if (!active || typeof window === 'undefined') return;
        const width = Math.round(window.screen.width * (window.devicePixelRatio || 1));
        const height = Math.round(window.screen.height * (window.devicePixelRatio || 1));
        if (width > 0 && height > 0) {
          setDisplayResolutions([{ id: 'browser', name: '当前显示器', width, height, is_primary: true }]);
        }
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const handleQuickEditorSetting = (event: Event) => {
      const enabled = (event as CustomEvent<boolean>).detail;
      setQuickEditorEnabled(enabled);
      if (!enabled) setQuickEditor(null);
    };
    window.addEventListener('ltw:quick-editor-setting', handleQuickEditorSetting);
    return () => window.removeEventListener('ltw:quick-editor-setting', handleQuickEditorSetting);
  }, []);

  useEffect(() => {
    if (cropEditingId && cropEditingId !== selectedId) setCropEditingId(null);
  }, [cropEditingId, selectedId]);

  useEffect(() => {
    const handleNavigationRequest = (event: Event) => {
      if (!dirtyRef.current) return;
      const request = event as CustomEvent<NavigationRequestDetail>;
      event.preventDefault();
      pendingNavigationRef.current = request.detail.proceed;
      setNavigationPromptOpen(true);
    };
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener(BEFORE_NAVIGATE_EVENT, handleNavigationRequest);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener(BEFORE_NAVIGATE_EVENT, handleNavigationRequest);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditable = Boolean(target?.closest('button, input, textarea, select, [role="slider"], [role="option"], [role="combobox"], [contenteditable="true"]'));
      const command = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (event.code === 'Space' && !isEditable) {
        event.preventDefault();
        if (!spacePressedRef.current) {
          spacePressedRef.current = true;
          setIsSpacePressed(true);
        }
        return;
      }

      if (command && key === 's') {
        event.preventDefault();
        if (event.altKey) setExportOpen(true);
        else void saveProject();
        return;
      }
      if (command && (key === '+' || key === '=')) {
        event.preventDefault(); changeZoom(1); return;
      }
      if (command && (key === '-' || key === '_')) {
        event.preventDefault(); changeZoom(-1); return;
      }
      if (command && key === '0') {
        event.preventDefault(); fitCanvas(); return;
      }
      if (command && key === '1') {
        event.preventDefault(); setZoomLevel(100); return;
      }
      if (isEditable) return;
      if (command && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if (command && key === 'y') {
        event.preventDefault(); redo();
      } else if (command && (key === 'd' || key === 'j') && selectedId) {
        event.preventDefault(); duplicateLayer(selectedId);
      } else if (command && (event.code === 'BracketLeft' || event.code === 'BracketRight') && selectedId) {
        event.preventDefault();
        const moveForward = event.code === 'BracketRight';
        if (event.shiftKey) moveLayerToEdge(selectedId, moveForward ? 'front' : 'back');
        else moveLayer(selectedId, moveForward ? 1 : -1);
      } else if (command && key === "'") {
        event.preventDefault(); setShowGrid((value) => !value);
      } else if (command && key === ';') {
        event.preventDefault(); setSnapToGuides((value) => !value);
      } else if (key === 'tab') {
        event.preventDefault(); setPanelsHidden((value) => !value);
      } else if (key === 'h') {
        event.preventDefault(); setCanvasTool('hand'); setQuickEditor(null);
      } else if (key === 'v') {
        event.preventDefault(); setCanvasTool('move');
      } else if (key === 'b') {
        event.preventDefault(); setCanvasTool('brush'); setToolTab('brush'); setQuickEditor(null);
      } else if (key === '/') {
        event.preventDefault();
        if (selectedLayer) patchSelected({ locked: !selectedLayer.locked });
      } else if (key === 'escape') {
        setSelectedId(null);
        setMobilePanel(null);
        setCropEditingId(null);
        setQuickEditor(null);
      } else if (key === '+' || key === '=') {
        event.preventDefault(); changeZoom(1);
      } else if (key === '-' || key === '_') {
        event.preventDefault(); changeZoom(-1);
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault(); removeLayer(selectedId);
      } else if (selectedId && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        patchSelected({
          x: selectedLayer ? selectedLayer.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0) : 0,
          y: selectedLayer ? selectedLayer.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) : 0,
        });
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      spacePressedRef.current = false;
      setIsSpacePressed(false);
    };
    const handleBlur = () => {
      spacePressedRef.current = false;
      setIsSpacePressed(false);
      setIsPanning(false);
      panRef.current = null;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  });

  const handleBackgroundFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const imageSrc = await readFileAsDataUrl(file);
      commitDocument((current) => ({ ...current, background: { ...current.background, mode: 'image', imageSrc } }));
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : '读取底图失败', { timeout: 0 });
    }
  };

  const handleLayerImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const src = await readFileAsDataUrl(file);
      const dimensions = await getImageDimensions(src);
      const scale = Math.min(
        document.width * 0.72 / dimensions.width,
        document.height * 0.72 / dimensions.height,
        1,
      );
      const width = Math.max(24, Math.round(dimensions.width * scale));
      const height = Math.max(24, Math.round(dimensions.height * scale));
      addLayer({
        id: createLayerId('image'), type: 'image', name: file.name.replace(/\.[^.]+$/, ''),
        visible: true, locked: false, opacity: 100, x: document.width / 2, y: document.height / 2,
        width, height, rotation: 0,
        src, fit: 'stretch', radius: 16, stroke: '#FFFFFF', strokeWidth: 0, shadowColor: '#000000', shadowBlur: 18,
        sourceAspectRatio: dimensions.width / dimensions.height,
        aspectRatioLocked: false,
        blendMode: 'source-over',
        adjustments: { ...DEFAULT_IMAGE_ADJUSTMENTS },
        effects: { ...DEFAULT_LAYER_EFFECTS },
        cropShape: 'rectangle',
        dominantColor: dimensions.dominantColor,
        crop: { x: 0, y: 0, width: 1, height: 1 },
      });
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : '读取图片失败', { timeout: 0 });
    }
  };

  const handleBrushImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const imageSrc = await readFileAsDataUrl(file);
      await getImageDimensions(imageSrc);
      patchBrushSettings({ kind: 'image', imageSrc });
      setCanvasTool('brush');
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : '读取画笔图片失败', { timeout: 0 });
    }
  };

  const saveProject = async (): Promise<boolean> => {
    try {
      const savedRevision = documentRevisionRef.current;
      const blob = encodeWallpaperProject(documentRef.current);
      const path = await saveBlobAs(blob, `${exportName.trim() || '壁纸项目'}.ltwp`);
      if (!path) {
        toast.warning('项目未保存', { description: '已取消保存或写入失败。', timeout: 3000 });
        return false;
      }
      const isCurrentRevision = documentRevisionRef.current === savedRevision;
      if (isCurrentRevision) setProjectDirty(false);
      toast.success(isCurrentRevision ? '项目已保存' : '已保存操作前的版本', {
        description: isCurrentRevision ? path : '保存期间产生了新修改，请再次保存。',
        timeout: 3500,
      });
      return isCurrentRevision;
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : '保存项目失败', { timeout: 0 });
      return false;
    }
  };

  const loadProject = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = await decodeWallpaperProject(file);
      pushPast(documentRef.current);
      setCurrentDocument(parsed);
      setSelectedId(null);
      setQuickEditor(null);
      setProjectDirty(false);
      toast.success('项目已打开', { timeout: 2500 });
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : '打开项目失败', { timeout: 0 });
    }
  };

  const createExportBlob = async () => {
    const type = exportFormat === 'png' ? 'image/png' : 'image/jpeg';
    return canvasRef.current?.exportBlob(type, exportQuality / 100);
  };

  const handleExport = async (applyAsWallpaper = false) => {
    setExporting(true);
    try {
      const blob = await createExportBlob();
      if (!blob) throw new Error('画布尚未准备完成');
      const extension = exportFormat === 'png' ? 'png' : 'jpg';
      const filename = `${exportName.trim() || '我的壁纸'}.${extension}`;
      if (applyAsWallpaper) {
        const path = await saveBlobToDownloads(blob, filename);
        if (!path) throw new Error('保存图片失败');
        const result = await setWallpaper(path);
        if (!result.success) throw new Error(result.error || '设置壁纸失败');
        toast.success('已设为壁纸', { description: path, timeout: 3500 });
      } else {
        const path = await saveBlobAs(blob, filename);
        if (path) toast.success('导出成功', { description: path, timeout: 3500 });
      }
      setExportOpen(false);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : '导出失败', { timeout: 0 });
    } finally {
      setExporting(false);
    }
  };

  const handleCopy = async () => {
    try {
      const blob = await canvasRef.current?.exportBlob('image/png');
      if (!blob) throw new Error('画布尚未准备完成');
      const copied = await copyImageToClipboard(blob);
      if (!copied) throw new Error('复制图片失败');
      toast.success('已复制图片', { timeout: 2500 });
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : '复制图片失败', { timeout: 0 });
    }
  };

  const resetDocument = () => {
    pushPast(documentRef.current);
    setCurrentDocument(cloneDocument(DEFAULT_DOCUMENT));
    setSelectedId(null);
    setQuickEditor(null);
  };

  const continuePendingNavigation = () => {
    const proceed = pendingNavigationRef.current;
    pendingNavigationRef.current = null;
    setNavigationPromptOpen(false);
    proceed?.();
  };

  const handleSaveAndNavigate = async () => {
    setNavigationSaving(true);
    try {
      if (await saveProject()) continuePendingNavigation();
    } finally {
      setNavigationSaving(false);
    }
  };

  const handleDiscardAndNavigate = () => {
    setProjectDirty(false);
    continuePendingNavigation();
  };

  const applyTemplate = (template: 'editorial' | 'botanical' | 'poster' | 'mono' | 'sunset' | 'bauhaus' | 'collage' | 'whitespace' | 'night') => {
    const current = cloneDocument(DEFAULT_DOCUMENT);
    current.width = document.width;
    current.height = document.height;
    if (template === 'editorial') {
      current.background.gradientColors = ['#17233B', '#446A66', '#D8B67A'];
      current.border = { ...current.border, style: 'corners', color: '#F7F4ED', width: 12, inset: 54 };
      current.layers = [
        { id: createLayerId('text'), type: 'text', name: '主标题', visible: true, locked: false, opacity: 100, x: current.width * 0.5, y: current.height * 0.48, width: current.width * 0.72, height: 200, rotation: 0, text: '山野有风', color: '#F7F4ED', fontSize: 142, fontFamily: 'serif', fontWeight: 700, align: 'center', letterSpacing: 8, lineHeight: 1.1, stroke: '#F7F4ED', strokeWidth: 0, shadowColor: '#000000', shadowBlur: 0 },
        { id: createLayerId('text'), type: 'text', name: '副标题', visible: true, locked: false, opacity: 85, x: current.width * 0.5, y: current.height * 0.64, width: current.width * 0.6, height: 80, rotation: 0, text: 'WANDER INTO THE QUIET', color: '#F7F4ED', fontSize: 34, fontFamily: 'sans-serif', fontWeight: 500, align: 'center', letterSpacing: 12, lineHeight: 1.1, stroke: '#F7F4ED', strokeWidth: 0, shadowColor: '#000000', shadowBlur: 0 },
      ];
    } else if (template === 'botanical') {
      current.background.mode = 'solid'; current.background.color = '#EDE7D8'; current.background.texture = 'paper'; current.background.textureColor = '#547A76';
      current.layers = [
        { id: createLayerId('shape'), type: 'shape', name: '色块', visible: true, locked: false, opacity: 100, x: current.width * 0.72, y: current.height * 0.52, width: current.width * 0.38, height: current.height * 0.7, rotation: 0, shape: 'rectangle', fill: '#315E59', stroke: '#315E59', strokeWidth: 0, radius: 8, shadowColor: '#000000', shadowBlur: 0 },
        { id: createLayerId('decoration'), type: 'decoration', name: '叶片', visible: true, locked: false, opacity: 100, x: current.width * 0.72, y: current.height * 0.5, width: 300, height: 460, rotation: 22, decoration: 'leaf', color: '#D8B67A', secondaryColor: '#F4F1EA', strokeWidth: 14 },
        { id: createLayerId('text'), type: 'text', name: '主标题', visible: true, locked: false, opacity: 100, x: current.width * 0.29, y: current.height * 0.47, width: current.width * 0.42, height: 260, rotation: 0, text: '慢慢生活\n好好感受', color: '#263B38', fontSize: 104, fontFamily: 'serif', fontWeight: 700, align: 'center', letterSpacing: 2, lineHeight: 1.35, stroke: '#263B38', strokeWidth: 0, shadowColor: '#000000', shadowBlur: 0 },
      ];
    } else if (template === 'poster') {
      current.background.gradientColors = ['#14324A', '#D0524F', '#E2AA42']; current.background.gradientAngle = 35; current.background.texture = 'dots'; current.background.textureOpacity = 13;
      current.layers = [
        { id: createLayerId('shape'), type: 'shape', name: '圆形', visible: true, locked: false, opacity: 92, x: current.width * 0.68, y: current.height * 0.5, width: 480, height: 480, rotation: 0, shape: 'circle', fill: '#F0DCA7', stroke: '#14324A', strokeWidth: 18, radius: 0, shadowColor: '#14324A', shadowBlur: 0 },
        { id: createLayerId('text'), type: 'text', name: '海报标题', visible: true, locked: false, opacity: 100, x: current.width * 0.38, y: current.height * 0.5, width: current.width * 0.62, height: 240, rotation: -7, text: 'MAKE\nSOMETHING', color: '#F7F4ED', fontSize: 126, fontFamily: 'sans-serif', fontWeight: 800, align: 'center', letterSpacing: 2, lineHeight: 0.92, stroke: '#14324A', strokeWidth: 9, shadowColor: '#14324A', shadowBlur: 0 },
      ];
    } else if (template === 'mono') {
      current.background.mode = 'solid'; current.background.color = '#F4F1EA'; current.background.texture = 'paper'; current.background.textureColor = '#17233B'; current.background.textureOpacity = 5;
      current.border = { ...current.border, style: 'solid', color: '#17233B', width: 8, inset: 42 };
      current.layers = [
        { id: createLayerId('shape'), type: 'shape', name: '分隔线', visible: true, locked: false, opacity: 100, x: current.width * 0.5, y: current.height * 0.68, width: current.width * 0.46, height: 10, rotation: 0, shape: 'rectangle', fill: '#17233B', stroke: '#17233B', strokeWidth: 0, radius: 0, shadowColor: '#000000', shadowBlur: 0 },
        { id: createLayerId('text'), type: 'text', name: '极简标题', visible: true, locked: false, opacity: 100, x: current.width * 0.5, y: current.height * 0.46, width: current.width * 0.78, height: 280, rotation: 0, text: 'LESS\nBUT BETTER', color: '#17233B', fontSize: 118, fontFamily: 'sans-serif', fontWeight: 800, align: 'center', letterSpacing: 5, lineHeight: 0.98, stroke: '#17233B', strokeWidth: 0, shadowColor: '#000000', shadowBlur: 0 },
        { id: createLayerId('text'), type: 'text', name: '日期标签', visible: true, locked: false, opacity: 100, x: current.width * 0.5, y: current.height * 0.76, width: current.width * 0.5, height: 60, rotation: 0, text: 'DESIGN STUDY / 2026', color: '#17233B', fontSize: 30, fontFamily: 'monospace', fontWeight: 500, align: 'center', letterSpacing: 8, lineHeight: 1, stroke: '#17233B', strokeWidth: 0, shadowColor: '#000000', shadowBlur: 0 },
      ];
    } else if (template === 'sunset') {
      current.background.gradientColors = ['#162B46', '#C65F57', '#E5AF61']; current.background.gradientAngle = 132; current.background.texture = 'grain'; current.background.textureOpacity = 9;
      current.layers = [
        { id: createLayerId('shape'), type: 'shape', name: '落日', visible: true, locked: false, opacity: 92, x: current.width * 0.72, y: current.height * 0.48, width: 430, height: 430, rotation: 0, shape: 'circle', fill: '#F2D8A0', stroke: '#F2D8A0', strokeWidth: 0, radius: 0, shadowColor: '#000000', shadowBlur: 0 },
        { id: createLayerId('text'), type: 'text', name: '日落标题', visible: true, locked: false, opacity: 100, x: current.width * 0.34, y: current.height * 0.48, width: current.width * 0.5, height: 220, rotation: 0, text: '日落\n之后', color: '#FFF6E7', fontSize: 126, fontFamily: 'serif', fontWeight: 700, align: 'center', letterSpacing: 10, lineHeight: 1.02, stroke: '#6C3742', strokeWidth: 3, shadowColor: '#000000', shadowBlur: 0 },
        { id: createLayerId('decoration'), type: 'decoration', name: '光芒', visible: true, locked: false, opacity: 85, x: current.width * 0.72, y: current.height * 0.48, width: 560, height: 560, rotation: 0, decoration: 'orbit', color: '#FFF6E7', secondaryColor: '#C65F57', strokeWidth: 8 },
      ];
    } else if (template === 'bauhaus') {
      current.background.mode = 'solid'; current.background.color = '#EEE6D3'; current.background.texture = 'none';
      current.layers = [
        { id: createLayerId('shape'), type: 'shape', name: '蓝色圆形', visible: true, locked: false, opacity: 100, x: current.width * 0.27, y: current.height * 0.34, width: 360, height: 360, rotation: 0, shape: 'circle', fill: '#275B78', stroke: '#17233B', strokeWidth: 8, radius: 0, shadowColor: '#000000', shadowBlur: 0 },
        { id: createLayerId('shape'), type: 'shape', name: '红色矩形', visible: true, locked: false, opacity: 100, x: current.width * 0.65, y: current.height * 0.42, width: 520, height: 250, rotation: -12, shape: 'rectangle', fill: '#C85250', stroke: '#17233B', strokeWidth: 8, radius: 0, shadowColor: '#000000', shadowBlur: 0 },
        { id: createLayerId('shape'), type: 'shape', name: '黄色三角', visible: true, locked: false, opacity: 100, x: current.width * 0.44, y: current.height * 0.72, width: 300, height: 260, rotation: 8, shape: 'triangle', fill: '#D9A441', stroke: '#17233B', strokeWidth: 8, radius: 0, shadowColor: '#000000', shadowBlur: 0 },
        { id: createLayerId('text'), type: 'text', name: '几何标题', visible: true, locked: false, opacity: 100, x: current.width * 0.74, y: current.height * 0.75, width: current.width * 0.35, height: 150, rotation: 0, text: 'FORM\nFOLLOWS', color: '#17233B', fontSize: 70, fontFamily: 'sans-serif', fontWeight: 800, align: 'center', letterSpacing: 3, lineHeight: 0.95, stroke: '#17233B', strokeWidth: 0, shadowColor: '#000000', shadowBlur: 0 },
      ];
    } else if (template === 'collage') {
      current.background.mode = 'solid'; current.background.color = '#DCE3DD'; current.background.texture = 'paper'; current.background.textureColor = '#2F4B46'; current.background.textureOpacity = 7;
      current.layers = [
        { id: createLayerId('shape'), type: 'shape', name: '深绿色纸片', visible: true, locked: false, opacity: 100, x: current.width * 0.31, y: current.height * 0.48, width: 520, height: 640, rotation: -8, shape: 'rectangle', fill: '#315E59', stroke: '#F4F1EA', strokeWidth: 12, radius: 4, shadowColor: '#000000', shadowBlur: 0, effects: { ...DEFAULT_LAYER_EFFECTS, shadowEnabled: true, shadowType: 'outer', shadowColor: '#17233B', shadowOpacity: 24, shadowBlur: 22, shadowDistance: 18, shadowAngle: 55 } },
        { id: createLayerId('shape'), type: 'shape', name: '珊瑚色纸片', visible: true, locked: false, opacity: 100, x: current.width * 0.66, y: current.height * 0.48, width: 520, height: 640, rotation: 7, shape: 'rectangle', fill: '#C95D56', stroke: '#F4F1EA', strokeWidth: 12, radius: 4, shadowColor: '#000000', shadowBlur: 0, effects: { ...DEFAULT_LAYER_EFFECTS, shadowEnabled: true, shadowType: 'outer', shadowColor: '#17233B', shadowOpacity: 24, shadowBlur: 22, shadowDistance: 18, shadowAngle: 55 } },
        { id: createLayerId('decoration'), type: 'decoration', name: '胶带', visible: true, locked: false, opacity: 78, x: current.width * 0.5, y: current.height * 0.2, width: 300, height: 90, rotation: -2, decoration: 'tape', color: '#E4C876', secondaryColor: '#FFF8DA', strokeWidth: 8 },
        { id: createLayerId('text'), type: 'text', name: '拼贴标题', visible: true, locked: false, opacity: 100, x: current.width * 0.5, y: current.height * 0.52, width: current.width * 0.58, height: 180, rotation: -2, text: 'COLLECT\nMOMENTS', color: '#FFF8EA', fontSize: 92, fontFamily: 'sans-serif', fontWeight: 800, align: 'center', letterSpacing: 5, lineHeight: 0.96, stroke: '#273B39', strokeWidth: 7, shadowColor: '#000000', shadowBlur: 0 },
      ];
    } else if (template === 'whitespace') {
      current.background.mode = 'solid'; current.background.color = '#FAFAF7'; current.background.texture = 'none';
      current.layers = [
        { id: createLayerId('shape'), type: 'shape', name: '留白圆形', visible: true, locked: false, opacity: 100, x: current.width * 0.72, y: current.height * 0.42, width: 400, height: 400, rotation: 0, shape: 'circle', fill: '#A8C0B5', stroke: '#203A39', strokeWidth: 5, radius: 0, shadowColor: '#000000', shadowBlur: 0 },
        { id: createLayerId('decoration'), type: 'decoration', name: '留白叶片', visible: true, locked: false, opacity: 100, x: current.width * 0.72, y: current.height * 0.42, width: 170, height: 250, rotation: 25, decoration: 'leaf', color: '#203A39', secondaryColor: '#FAFAF7', strokeWidth: 7 },
        { id: createLayerId('text'), type: 'text', name: '留白标题', visible: true, locked: false, opacity: 100, x: current.width * 0.3, y: current.height * 0.55, width: current.width * 0.38, height: 220, rotation: 0, text: '保持\n呼吸感', color: '#203A39', fontSize: 98, fontFamily: 'serif', fontWeight: 700, align: 'center', letterSpacing: 7, lineHeight: 1.15, stroke: '#203A39', strokeWidth: 0, shadowColor: '#000000', shadowBlur: 0 },
        { id: createLayerId('text'), type: 'text', name: '留白副标题', visible: true, locked: false, opacity: 65, x: current.width * 0.3, y: current.height * 0.73, width: current.width * 0.35, height: 50, rotation: 0, text: 'SPACE TO BREATHE', color: '#203A39', fontSize: 27, fontFamily: 'sans-serif', fontWeight: 500, align: 'center', letterSpacing: 7, lineHeight: 1, stroke: '#203A39', strokeWidth: 0, shadowColor: '#000000', shadowBlur: 0 },
      ];
    } else {
      current.background.gradientColors = ['#071622', '#16404A', '#B38B50']; current.background.gradientAngle = 155; current.background.texture = 'grain'; current.background.textureOpacity = 10;
      current.border = { ...current.border, style: 'double', color: '#E8D9B7', width: 10, inset: 48, opacity: 75 };
      current.layers = [
        { id: createLayerId('decoration'), type: 'decoration', name: '星光一', visible: true, locked: false, opacity: 90, x: current.width * 0.2, y: current.height * 0.25, width: 120, height: 120, rotation: 0, decoration: 'sparkle', color: '#E8D9B7', secondaryColor: '#B38B50', strokeWidth: 8 },
        { id: createLayerId('decoration'), type: 'decoration', name: '星光二', visible: true, locked: false, opacity: 70, x: current.width * 0.78, y: current.height * 0.32, width: 86, height: 86, rotation: 18, decoration: 'sparkle', color: '#E8D9B7', secondaryColor: '#B38B50', strokeWidth: 6 },
        { id: createLayerId('text'), type: 'text', name: '夜幕标题', visible: true, locked: false, opacity: 100, x: current.width * 0.5, y: current.height * 0.52, width: current.width * 0.66, height: 200, rotation: 0, text: '夜幕有星', color: '#F0E5CD', fontSize: 138, fontFamily: 'serif', fontWeight: 700, align: 'center', letterSpacing: 14, lineHeight: 1, stroke: '#0A2028', strokeWidth: 3, shadowColor: '#000000', shadowBlur: 0 },
        { id: createLayerId('text'), type: 'text', name: '夜幕副标题', visible: true, locked: false, opacity: 75, x: current.width * 0.5, y: current.height * 0.67, width: current.width * 0.55, height: 70, rotation: 0, text: 'THE NIGHT IS OURS', color: '#F0E5CD', fontSize: 32, fontFamily: 'sans-serif', fontWeight: 500, align: 'center', letterSpacing: 10, lineHeight: 1, stroke: '#F0E5CD', strokeWidth: 0, shadowColor: '#000000', shadowBlur: 0 },
      ];
    }
    pushPast(documentRef.current);
    setCurrentDocument(current);
    setSelectedId(null);
  };

  const leftPanel = (
    <aside className={`absolute inset-y-0 left-0 z-30 min-h-0 w-full max-w-[286px] flex-col overflow-hidden border-r border-border bg-background shadow-xl xl:relative xl:z-auto xl:w-[286px] xl:shadow-none ${panelsHidden ? 'hidden' : mobilePanel === 'tools' ? 'flex xl:flex' : 'hidden xl:flex'}`}>
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4 xl:hidden">
        <span className="font-semibold">素材与样式</span>
        <Button isIconOnly size="sm" variant="ghost" onPress={() => setMobilePanel(null)} aria-label="关闭工具面板"><X size={17} /></Button>
      </div>
      <Tabs selectedKey={toolTab} onSelectionChange={(key) => { const next = String(key) as ToolTab; setToolTab(next); if (next === 'brush') setCanvasTool('brush'); }} className="flex min-h-0 flex-1 flex-col">
        <Tabs.ListContainer className="shrink-0 border-b border-border px-2">
          <Tabs.List aria-label="制作工具" className="w-full *:min-w-0 *:flex-1 *:px-2">
            <Tabs.Tab id="background"><Palette size={15} /><span className="text-xs">背景</span><Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="add"><Plus size={15} /><span className="text-xs">添加</span><Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="brush"><Brush size={15} /><span className="text-xs">画笔</span><Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel id="background" className="min-h-0 flex-1 overflow-y-auto p-0">
          <PanelSection title="快速模板" icon={<Sparkles size={15} />}>
            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => applyTemplate('editorial')} className="group space-y-1 text-left text-xs">
                <span className="block aspect-[4/3] rounded-md border border-border bg-[linear-gradient(135deg,#17233b,#446a66_55%,#d8b67a)] transition-transform group-hover:-translate-y-0.5" />杂志
              </button>
              <button onClick={() => applyTemplate('botanical')} className="group space-y-1 text-left text-xs">
                <span className="block aspect-[4/3] rounded-md border border-border bg-[linear-gradient(90deg,#ede7d8_60%,#315e59_60%)] transition-transform group-hover:-translate-y-0.5" />植感
              </button>
              <button onClick={() => applyTemplate('poster')} className="group space-y-1 text-left text-xs">
                <span className="block aspect-[4/3] rounded-md border border-border bg-[linear-gradient(135deg,#14324a,#d0524f_55%,#e2aa42)] transition-transform group-hover:-translate-y-0.5" />海报
              </button>
              <button onClick={() => applyTemplate('mono')} className="group space-y-1 text-left text-xs">
                <span className="block aspect-[4/3] rounded-md border border-border bg-[linear-gradient(90deg,#f4f1ea_48%,#17233b_48%,#17233b_52%,#f4f1ea_52%)] transition-transform group-hover:-translate-y-0.5" />极简
              </button>
              <button onClick={() => applyTemplate('sunset')} className="group space-y-1 text-left text-xs">
                <span className="block aspect-[4/3] rounded-md border border-border bg-[radial-gradient(circle_at_72%_48%,#f2d8a0_0_19%,transparent_20%),linear-gradient(135deg,#162b46,#c65f57,#e5af61)] transition-transform group-hover:-translate-y-0.5" />落日
              </button>
              <button onClick={() => applyTemplate('bauhaus')} className="group space-y-1 text-left text-xs">
                <span className="block aspect-[4/3] rounded-md border border-border bg-[radial-gradient(circle_at_28%_34%,#275b78_0_18%,transparent_19%),linear-gradient(145deg,transparent_45%,#c85250_46%_66%,transparent_67%),#eee6d3] transition-transform group-hover:-translate-y-0.5" />几何
              </button>
              <button onClick={() => applyTemplate('collage')} className="group space-y-1 text-left text-xs">
                <span className="block aspect-[4/3] rounded-md border border-border bg-[linear-gradient(82deg,transparent_12%,#315e59_13%_45%,transparent_46%),linear-gradient(98deg,transparent_51%,#c95d56_52%_84%,transparent_85%),#dce3dd] transition-transform group-hover:-translate-y-0.5" />拼贴
              </button>
              <button onClick={() => applyTemplate('whitespace')} className="group space-y-1 text-left text-xs">
                <span className="block aspect-[4/3] rounded-md border border-border bg-[radial-gradient(circle_at_72%_42%,#a8c0b5_0_20%,transparent_21%),#fafaf7] transition-transform group-hover:-translate-y-0.5" />留白
              </button>
              <button onClick={() => applyTemplate('night')} className="group space-y-1 text-left text-xs">
                <span className="block aspect-[4/3] rounded-md border border-border bg-[linear-gradient(145deg,#071622,#16404a_70%,#b38b50)] transition-transform group-hover:-translate-y-0.5" />夜幕
              </button>
            </div>
          </PanelSection>
          <PanelSection title="底图" icon={<Palette size={15} />}>
            <div className="grid grid-cols-3 gap-2">
              {(['solid', 'gradient', 'image'] as const).map((mode) => (
                <Button key={mode} size="sm" variant={document.background.mode === mode ? 'secondary' : 'ghost'} onPress={() => commitDocument((current) => ({ ...current, background: { ...current.background, mode } }))}>
                  {mode === 'solid' ? '纯色' : mode === 'gradient' ? '渐变' : '图片'}
                </Button>
              ))}
            </div>
            {document.background.mode === 'solid' && (
              <>
                <div className="grid grid-cols-5 gap-2">
                  {SOLID_COLORS.map((color) => <Button key={color} isIconOnly size="sm" variant="ghost" aria-label={`选择颜色 ${color}`} onPress={() => commitDocument((current) => ({ ...current, background: { ...current.background, color } }))} className={document.background.color === color ? 'ring-2 ring-primary/40' : ''}><ColorSwatch color={color} size="sm" shape="square" /></Button>)}
                </div>
                <ColorControl label="自定义颜色" value={document.background.color} onChange={(color) => commitDocument((current) => ({ ...current, background: { ...current.background, color } }), 'background:color')} />
              </>
            )}
            {document.background.mode === 'gradient' && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {GRADIENT_PRESETS.map((preset) => <button key={preset.name} onClick={() => commitDocument((current) => ({ ...current, background: { ...current.background, gradientColors: preset.colors, gradientAngle: preset.angle } }))} className="group space-y-1 text-left text-xs"><span className="block h-12 rounded-md border border-border transition-transform group-hover:-translate-y-0.5" style={{ background: `linear-gradient(${preset.angle}deg, ${preset.colors.join(', ')})` }} />{preset.name}</button>)}
                </div>
                <SelectControl label="渐变类型" value={document.background.gradientType} options={[{ id: 'linear', label: '线性渐变' }, { id: 'radial', label: '径向渐变' }, { id: 'conic', label: '锥形渐变' }]} onChange={(value) => commitDocument((current) => ({ ...current, background: { ...current.background, gradientType: value as GradientType } }))} />
                <div className="grid grid-cols-2 gap-2">{document.background.gradientColors.map((color, index) => <ColorControl key={index} label={`颜色 ${index + 1}`} value={color} onChange={(value) => commitDocument((current) => { current.background.gradientColors[index] = value; return current; }, `background:gradientColor:${index}`)} />)}</div>
                <div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" onPress={() => commitDocument((current) => ({ ...current, background: { ...current.background, gradientColors: [...current.background.gradientColors].reverse() } }))}><ArrowLeftRight size={15} />反转色序</Button><Button size="sm" variant="ghost" isDisabled={document.background.gradientColors.length >= 4} onPress={() => commitDocument((current) => ({ ...current, background: { ...current.background, gradientColors: [...current.background.gradientColors, current.background.gradientColors[current.background.gradientColors.length - 1] || '#FFFFFF'] } }))}>添加色标</Button><Button size="sm" variant="ghost" isDisabled={document.background.gradientColors.length <= 2} onPress={() => commitDocument((current) => ({ ...current, background: { ...current.background, gradientColors: current.background.gradientColors.slice(0, -1) } }))}>移除色标</Button></div>
                <SliderControl label="渐变角度" value={document.background.gradientAngle} min={0} max={360} suffix="°" onChange={(gradientAngle) => commitDocument((current) => ({ ...current, background: { ...current.background, gradientAngle } }), 'background:gradientAngle')} />
              </>
            )}
            {document.background.mode === 'image' && (
              <>
                <Button fullWidth variant="secondary" onPress={() => backgroundInputRef.current?.click()}><ImagePlus size={16} />{document.background.imageSrc ? '更换底图' : '选择底图'}</Button>
                <SelectControl label="填充方式" value={document.background.imageFit} options={[{ id: 'cover', label: '覆盖画布' }, { id: 'contain', label: '完整显示' }, { id: 'stretch', label: '拉伸填充' }]} onChange={(value) => commitDocument((current) => ({ ...current, background: { ...current.background, imageFit: value as ImageFit } }))} />
                <SliderControl label="模糊" value={document.background.imageBlur} min={0} max={40} suffix=" px" onChange={(imageBlur) => commitDocument((current) => ({ ...current, background: { ...current.background, imageBlur } }), 'background:imageBlur')} />
                <SliderControl label="亮度" value={document.background.imageBrightness} min={20} max={160} suffix="%" onChange={(imageBrightness) => commitDocument((current) => ({ ...current, background: { ...current.background, imageBrightness } }), 'background:imageBrightness')} />
                <div className="grid grid-cols-3 gap-2">{IMAGE_FILTER_PRESETS.map((preset) => <Button key={preset.id} size="sm" variant="ghost" onPress={() => applyImageFilterPreset('background', preset.adjustments)}>{preset.label}</Button>)}</div>
                <Button fullWidth variant="secondary" onPress={() => setAdjustmentTarget('background')}><SlidersHorizontal size={16} />画面调整</Button>
              </>
            )}
          </PanelSection>
          <PanelSection title="底纹" icon={<Grid3X3 size={15} />}>
            <div className="grid grid-cols-4 gap-2">{TEXTURES.map((texture) => <Button key={texture.id} size="sm" variant={document.background.texture === texture.id ? 'secondary' : 'ghost'} onPress={() => commitDocument((current) => ({ ...current, background: { ...current.background, texture: texture.id } }))}>{texture.label}</Button>)}</div>
            {document.background.texture !== 'none' && <><div className="flex gap-2"><ColorControl label="纹理颜色" value={document.background.textureColor} onChange={(textureColor) => commitDocument((current) => ({ ...current, background: { ...current.background, textureColor } }), 'background:textureColor')} /></div><SliderControl label="纹理强度" value={document.background.textureOpacity} min={1} max={60} suffix="%" onChange={(textureOpacity) => commitDocument((current) => ({ ...current, background: { ...current.background, textureOpacity } }), 'background:textureOpacity')} /><SliderControl label="纹理尺度" value={document.background.textureScale} min={16} max={120} suffix=" px" onChange={(textureScale) => commitDocument((current) => ({ ...current, background: { ...current.background, textureScale } }), 'background:textureScale')} /></>}
          </PanelSection>
          <PanelSection title="画框" icon={<Frame size={15} />}>
            <div className="grid grid-cols-3 gap-2">{BORDER_STYLES.map((border) => <Button key={border.id} size="sm" variant={document.border.style === border.id ? 'secondary' : 'ghost'} onPress={() => commitDocument((current) => ({ ...current, border: { ...current.border, style: border.id } }))}>{border.label}</Button>)}</div>
            {document.border.style !== 'none' && <><ColorControl label="边框颜色" value={document.border.color} onChange={(color) => commitDocument((current) => ({ ...current, border: { ...current.border, color } }), 'border:color')} /><SliderControl label="粗细" value={document.border.width} min={2} max={80} suffix=" px" onChange={(width) => commitDocument((current) => ({ ...current, border: { ...current.border, width } }), 'border:width')} /><SliderControl label="内边距" value={document.border.inset} min={0} max={180} suffix=" px" onChange={(inset) => commitDocument((current) => ({ ...current, border: { ...current.border, inset } }), 'border:inset')} /></>}
          </PanelSection>
        </Tabs.Panel>

        <Tabs.Panel id="add" className="min-h-0 flex-1 overflow-y-auto p-0">
          <PanelSection title="基础形状" icon={<Shapes size={15} />}><div className="grid grid-cols-3 gap-2">{SHAPES.map((shape) => <Button key={shape.id} variant="secondary" className="h-16 flex-col gap-1" onPress={() => addShape(shape.id)}>{shape.icon}<span className="text-xs">{shape.label}</span></Button>)}</div></PanelSection>
          <PanelSection title="小装饰" icon={<Sparkles size={15} />}><div className="grid grid-cols-3 gap-2">{DECORATIONS.map((decoration) => <Button key={decoration.id} variant="secondary" className="h-16 flex-col gap-1" onPress={() => addDecoration(decoration.id)}>{decoration.icon}<span className="text-xs">{decoration.label}</span></Button>)}</div></PanelSection>
          <PanelSection title="文字样式" icon={<Type size={15} />}>
            <button onClick={() => addText('title')} className="w-full rounded-lg border border-border bg-surface-secondary p-3 text-left transition-colors hover:bg-surface-tertiary"><span className="block text-xl font-bold">写下此刻</span><span className="text-xs text-muted">主标题</span></button>
            <button onClick={() => addText('subtitle')} className="w-full rounded-lg border border-border bg-surface-secondary p-3 text-left transition-colors hover:bg-surface-tertiary"><span className="block text-sm tracking-widest">A MOMENT TO KEEP</span><span className="text-xs text-muted">英文副标题</span></button>
            <button onClick={() => addText('label')} className="w-full rounded-lg border border-border bg-surface-secondary p-3 text-left transition-colors hover:bg-surface-tertiary"><span className="block font-mono text-sm font-semibold">VOL. 01 / TODAY</span><span className="text-xs text-muted">信息标签</span></button>
            <button onClick={() => addText('outline')} className="w-full rounded-lg border border-border bg-surface-secondary p-3 text-left transition-colors hover:bg-surface-tertiary"><span className="block text-lg font-black text-muted">OUTLINE</span><span className="text-xs text-muted">描边标题</span></button>
          </PanelSection>
          <PanelSection title="添加图片" icon={<ImagePlus size={15} />}>
            <Button fullWidth onPress={() => layerImageInputRef.current?.click()}><ImagePlus size={17} />选择本地图片</Button>
            <Description>图片会作为独立图层添加，可自由缩放、旋转、裁切并设置圆角和描边。</Description>
          </PanelSection>
          <PanelSection title="组合建议" icon={<Layers3 size={15} />}>
            <div className="space-y-2 text-xs leading-5 text-muted"><p>将主体图片置于文字下方，并用形状作为局部色块。</p><p>照片过亮时可在背景工具中降低亮度并增加底纹。</p><p>复制同一图片图层并错位排列，可快速制作拼贴效果。</p></div>
          </PanelSection>
        </Tabs.Panel>

        <Tabs.Panel id="brush" className="min-h-0 flex-1 overflow-y-auto p-0">
          <PanelSection title="画笔类型" icon={<Brush size={15} />}>
            <div className="grid grid-cols-2 gap-2">
              {([
                { id: 'solid', label: '纯色画笔', icon: <Brush size={16} /> },
                { id: 'gradient', label: '渐变画笔', icon: <Palette size={16} /> },
                { id: 'image', label: '图片画笔', icon: <ImageIcon size={16} /> },
                { id: 'emoji', label: 'Emoji 画笔', icon: <Smile size={16} /> },
              ] as Array<{ id: BrushKind; label: string; icon: ReactNode }>).map((item) => (
                <Button key={item.id} size="sm" variant={brushSettings.kind === item.id ? 'secondary' : 'ghost'} onPress={() => patchBrushSettings({ kind: item.id })}>{item.icon}{item.label}</Button>
              ))}
            </div>
            <SliderControl label="画笔粗细" value={brushSettings.size} min={2} max={400} suffix=" px" onChange={(size) => patchBrushSettings({ size })} />
            <SliderControl label="画笔不透明度" value={brushSettings.opacity} min={1} max={100} suffix="%" onChange={(opacity) => patchBrushSettings({ opacity })} />
            {(brushSettings.kind === 'solid' || brushSettings.kind === 'gradient') && (
              <>
                {brushSettings.kind === 'solid' ? <ColorControl label="画笔颜色" value={brushSettings.color} onChange={(color) => patchBrushSettings({ color })} /> : <div className="grid grid-cols-2 gap-2">{brushSettings.gradientColors.map((color, index) => <ColorControl key={index} label={`渐变色 ${index + 1}`} value={color} onChange={(next) => { const gradientColors = [...brushSettings.gradientColors]; gradientColors[index] = next; patchBrushSettings({ gradientColors }); }} />)}</div>}
                <SelectControl label="笔刷质感" value={brushSettings.texture} options={[{ id: 'smooth', label: '平滑圆笔' }, { id: 'marker', label: '马克笔' }, { id: 'chalk', label: '粉笔' }, { id: 'spray', label: '喷枪' }]} onChange={(texture) => patchBrushSettings({ texture: texture as BrushTexture })} />
              </>
            )}
            {brushSettings.kind === 'image' && (
              <>
                {brushSettings.imageSrc && <div className="h-24 rounded-lg border border-border bg-[length:contain] bg-center bg-no-repeat" style={{ backgroundImage: `url(${brushSettings.imageSrc})` }} />}
                <Button fullWidth variant="secondary" onPress={() => brushImageInputRef.current?.click()}><ImagePlus size={16} />{brushSettings.imageSrc ? '更换画笔图片' : '选择画笔图片'}</Button>
              </>
            )}
            {brushSettings.kind === 'emoji' && <Input value={brushSettings.emoji} maxLength={16} onChange={(event) => patchBrushSettings({ emoji: event.target.value })} aria-label="Emoji 内容" placeholder="输入 Emoji" />}
            {(brushSettings.kind === 'image' || brushSettings.kind === 'emoji') && (
              <>
                <SliderControl label="图章间距" value={brushSettings.spacing} min={8} max={200} suffix="%" onChange={(spacing) => patchBrushSettings({ spacing })} />
                <SelectControl label="图片方向" value={brushSettings.stampOrientation} options={[{ id: 'fixed', label: '保持默认方向' }, { id: 'follow', label: '跟随笔画方向' }]} onChange={(stampOrientation) => patchBrushSettings({ stampOrientation: stampOrientation as StampOrientation })} />
                <SliderControl label="默认旋转" value={brushSettings.stampRotation} min={-180} max={180} suffix="°" onChange={(stampRotation) => patchBrushSettings({ stampRotation })} />
                <div className="flex items-center justify-between gap-3"><span className="text-sm">根据笔画方向扭曲</span><Switch aria-label="根据笔画方向扭曲" isSelected={brushSettings.distortWithDirection} onChange={(distortWithDirection) => patchBrushSettings({ distortWithDirection })}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></div>
              </>
            )}
            <Button fullWidth onPress={() => setCanvasTool('brush')}><Brush size={16} />{canvasTool === 'brush' ? '画笔已启用' : '开始绘制'}</Button>
          </PanelSection>
        </Tabs.Panel>
      </Tabs>
    </aside>
  );

  const rightPanel = (
    <aside className={`absolute inset-y-0 right-0 z-30 min-h-0 w-full max-w-[276px] flex-col overflow-hidden border-l border-border bg-background shadow-xl xl:relative xl:z-auto xl:w-[276px] xl:shadow-none ${panelsHidden ? 'hidden' : mobilePanel === 'layers' ? 'flex xl:flex' : 'hidden xl:flex'}`}>
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2 font-semibold"><Layers3 size={16} />图层 <span className="text-xs font-normal text-muted">{document.layers.length}</span></div>
        <div className="flex items-center gap-1">
          <IconAction label="添加文字" onPress={() => addText()}><Type size={15} /></IconAction>
          <IconAction label="添加形状" onPress={() => addShape('rectangle')}><Shapes size={15} /></IconAction>
          <Button isIconOnly size="sm" variant="ghost" onPress={() => setMobilePanel(null)} aria-label="关闭图层面板" className="xl:hidden"><X size={17} /></Button>
        </div>
      </div>
      <div className="max-h-[42%] min-h-[132px] overflow-y-auto border-b border-border p-2">
        {document.layers.length === 0 ? (
          <div className="flex h-28 flex-col items-center justify-center gap-2 text-center text-xs text-muted"><Layers3 size={24} strokeWidth={1.5} /><span>从左侧添加文字、形状或图片</span></div>
        ) : [...document.layers].reverse().map((layer) => (
          <div key={layer.id} className={`group mb-1 flex h-10 items-center gap-1 rounded-md px-1 transition-colors ${selectedId === layer.id ? 'bg-primary/12 text-primary' : 'hover:bg-surface-secondary'}`}>
            <IconAction label={layer.visible ? '隐藏图层' : '显示图层'} onPress={() => commitDocument((current) => ({ ...current, layers: current.layers.map((item) => item.id === layer.id ? { ...item, visible: !item.visible } : item) }))}>{layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}</IconAction>
            <Button size="sm" variant="ghost" className="min-w-0 flex-1 justify-start gap-2 px-1" onPress={() => setSelectedId(layer.id)}><span className="text-muted">{layerIcon(layer)}</span><span className="min-w-0 truncate text-xs">{layer.name}</span></Button>
            <Button isIconOnly size="sm" variant="ghost" aria-label={layer.locked ? '解锁图层' : '锁定图层'} onPress={() => commitDocument((current) => ({ ...current, layers: current.layers.map((item) => item.id === layer.id ? { ...item, locked: !item.locked } : item) }))}>{layer.locked ? <Lock size={13} /> : <Unlock size={13} />}</Button>
          </div>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {selectedLayer ? (
          <div className="divide-y divide-border">
            <PanelSection title="图层属性">
              <Input value={selectedLayer.name} onChange={(event) => patchSelected({ name: event.target.value })} aria-label="图层名称" />
              <div className="flex flex-wrap gap-1">
                <IconAction label="置于顶层" onPress={() => moveLayerToEdge(selectedLayer.id, 'front')} isDisabled={document.layers[document.layers.length - 1]?.id === selectedLayer.id}><ArrowUpToLine size={16} /></IconAction>
                <IconAction label="上移一层" onPress={() => moveLayer(selectedLayer.id, 1)} isDisabled={document.layers[document.layers.length - 1]?.id === selectedLayer.id}><ChevronUp size={16} /></IconAction>
                <IconAction label="下移一层" onPress={() => moveLayer(selectedLayer.id, -1)} isDisabled={document.layers[0]?.id === selectedLayer.id}><ChevronDown size={16} /></IconAction>
                <IconAction label="置于底层" onPress={() => moveLayerToEdge(selectedLayer.id, 'back')} isDisabled={document.layers[0]?.id === selectedLayer.id}><ArrowDownToLine size={16} /></IconAction>
                <IconAction label="复制图层" onPress={() => duplicateLayer(selectedLayer.id)}><CopyPlus size={16} /></IconAction>
                <span className="flex-1" />
                <IconAction label="删除图层" onPress={() => removeLayer(selectedLayer.id)}><Trash2 size={16} className="text-danger" /></IconAction>
              </div>
              <SliderControl label="不透明度" value={selectedLayer.opacity} min={0} max={100} suffix="%" onChange={(opacity) => patchSelected({ opacity })} />
            </PanelSection>
            <PanelSection title="变换">
              {selectedLayer.locked && <Description>图层已锁定，解锁后可调整位置、大小、旋转与翻转。</Description>}
              <div className="space-y-3">
                <TransformField label="水平位置 X（像素）" value={selectedLayer.x} onChange={(x) => patchSelected({ x })} disabled={selectedLayer.locked} />
                <TransformField label="垂直位置 Y（像素）" value={selectedLayer.y} onChange={(y) => patchSelected({ y })} disabled={selectedLayer.locked} />
                <TransformField label="图层宽度（像素）" value={selectedLayer.width} onChange={(width) => updateSelectedSize('width', width)} disabled={selectedLayer.locked} />
                <TransformField label="图层高度（像素）" value={selectedLayer.height} onChange={(height) => updateSelectedSize('height', height)} disabled={selectedLayer.locked} />
              </div>
              <SliderControl label="旋转" value={selectedLayer.rotation} min={-180} max={180} suffix="°" onChange={(rotation) => patchSelected({ rotation })} isDisabled={selectedLayer.locked} />
              <div className="flex flex-wrap gap-1">
                <IconAction label="左对齐画布" onPress={() => alignSelected('left')} isDisabled={selectedLayer.locked}><ArrowLeftToLine size={16} /></IconAction>
                <IconAction label="水平居中" onPress={() => alignSelected('horizontal')} isDisabled={selectedLayer.locked}><ArrowLeftRight size={16} /></IconAction>
                <IconAction label="右对齐画布" onPress={() => alignSelected('right')} isDisabled={selectedLayer.locked}><ArrowRightToLine size={16} /></IconAction>
                <IconAction label="顶部对齐画布" onPress={() => alignSelected('top')} isDisabled={selectedLayer.locked}><ArrowUpToLine size={16} /></IconAction>
                <IconAction label="垂直居中" onPress={() => alignSelected('vertical')} isDisabled={selectedLayer.locked}><Maximize2 size={16} /></IconAction>
                <IconAction label="底部对齐画布" onPress={() => alignSelected('bottom')} isDisabled={selectedLayer.locked}><ArrowDownToLine size={16} /></IconAction>
                <IconAction label="水平翻转" onPress={() => patchSelected({ flipX: !selectedLayer.flipX })} isDisabled={selectedLayer.locked}><FlipHorizontal2 size={16} /></IconAction>
                <IconAction label="垂直翻转" onPress={() => patchSelected({ flipY: !selectedLayer.flipY })} isDisabled={selectedLayer.locked}><FlipVertical2 size={16} /></IconAction>
              </div>
            </PanelSection>
            {selectedLayer.type === 'shape' && <PanelSection title="形状样式"><div className="flex gap-2"><ColorControl label="填充" value={selectedLayer.fill} onChange={(fill) => patchSelected({ fill })} /><ColorControl label="描边" value={selectedLayer.stroke} onChange={(stroke) => patchSelected({ stroke })} /></div><SliderControl label="描边粗细" value={selectedLayer.strokeWidth} min={0} max={60} suffix=" px" onChange={(strokeWidth) => patchSelected({ strokeWidth })} />{selectedLayer.shape === 'rectangle' && <SliderControl label="圆角" value={selectedLayer.radius} min={0} max={160} suffix=" px" onChange={(radius) => patchSelected({ radius })} />}</PanelSection>}
            {selectedLayer.type === 'text' && (
              <PanelSection title="文字样式">
                <TextArea
                  value={selectedLayer.text}
                  onChange={(event) => {
                    const text = event.target.value;
                    const glyphCount = Array.from(text).length;
                    const characterStyles = Array.from({ length: glyphCount }, (_, index) => ({ ...(selectedLayer.characterStyles?.[index] || {}) }));
                    patchSelected({ text, characterStyles });
                  }}
                  onSelect={(event) => setTextSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })}
                  aria-label="文字内容"
                />
                {selectedTextRange.end > selectedTextRange.start && selectedCharacterStyle && (
                  <div className="space-y-3 rounded-lg bg-surface-secondary p-3">
                    <div className="flex items-center justify-between"><span className="text-xs font-medium">已选择 {selectedTextRange.end - selectedTextRange.start} 个字符</span><div className="flex gap-1"><IconAction label="粗体" onPress={() => applySelectedTextStyle({ fontWeight: selectedCharacterStyle.fontWeight >= 700 ? 400 : 700 })} isActive={selectedCharacterStyle.fontWeight >= 700}><Bold size={15} /></IconAction><IconAction label="斜体" onPress={() => applySelectedTextStyle({ fontStyle: selectedCharacterStyle.fontStyle === 'italic' ? 'normal' : 'italic' })} isActive={selectedCharacterStyle.fontStyle === 'italic'}><Italic size={15} /></IconAction><IconAction label="下划线" onPress={() => applySelectedTextStyle({ underline: !selectedCharacterStyle.underline })} isActive={selectedCharacterStyle.underline}><Underline size={15} /></IconAction></div></div>
                    <SelectControl label="所选字体" value={selectedCharacterStyle.fontFamily} options={FONT_OPTIONS} onChange={(fontFamily) => applySelectedTextStyle({ fontFamily })} />
                    <div className="grid grid-cols-2 gap-2"><ColorControl label="所选文字颜色" value={selectedCharacterStyle.color} onChange={(color) => applySelectedTextStyle({ color })} /><ColorControl label="所选高亮颜色" value={selectedCharacterStyle.backgroundColor} onChange={(backgroundColor) => applySelectedTextStyle({ backgroundColor })} /></div>
                    <SliderControl label="所选字号" value={selectedCharacterStyle.fontSize} min={12} max={360} suffix=" px" onChange={(fontSize) => applySelectedTextStyle({ fontSize })} />
                    <SliderControl label="所选字距" value={selectedCharacterStyle.letterSpacing} min={-4} max={60} suffix=" px" onChange={(letterSpacing) => applySelectedTextStyle({ letterSpacing })} />
                  </div>
                )}
                {selectedTextHasMixedStyles ? (
                  <div className="space-y-2"><Label className="text-xs text-muted">统一字体、颜色与大小</Label><Input value="多个值" disabled aria-label="统一文字样式为多个值" /><Button fullWidth size="sm" variant="ghost" onPress={() => patchSelected({ characterStyles: undefined })}>清除局部格式</Button></div>
                ) : (
                  <>
                    <SelectControl label="统一字体" value={selectedLayer.fontFamily} options={FONT_OPTIONS} onChange={(fontFamily) => patchSelected({ fontFamily })} />
                    <div className="flex gap-2"><ColorControl label="统一文字颜色" value={selectedLayer.color} onChange={(color) => patchSelected({ color })} /><ColorControl label="描边颜色" value={selectedLayer.stroke} onChange={(stroke) => patchSelected({ stroke })} /></div>
                    <SliderControl label="统一字号" value={selectedLayer.fontSize} min={12} max={360} suffix=" px" onChange={(fontSize) => patchSelected({ fontSize })} />
                    <SliderControl label="统一字距" value={selectedLayer.letterSpacing} min={-4} max={60} suffix=" px" onChange={(letterSpacing) => patchSelected({ letterSpacing })} />
                  </>
                )}
                <SliderControl label="统一描边" value={selectedLayer.strokeWidth} min={0} max={30} suffix=" px" onChange={(strokeWidth) => patchSelected({ strokeWidth })} />
                <div className="grid grid-cols-3 gap-2">{(['left', 'center', 'right'] as const).map((align) => <Button key={align} size="sm" variant={selectedLayer.align === align ? 'secondary' : 'ghost'} onPress={() => patchSelected({ align })}>{align === 'left' ? '左对齐' : align === 'center' ? '居中' : '右对齐'}</Button>)}</div>
              </PanelSection>
            )}
            {selectedLayer.type === 'image' && selectedImageCrop && (
              <PanelSection title="图片样式">
                <div className="flex items-center justify-between gap-3">
                  <div><p className="text-sm">锁定原图纵横比</p><Description>开启后缩放与尺寸输入会保持原图比例。</Description></div>
                  <Switch aria-label="锁定原图纵横比" isSelected={Boolean(selectedLayer.aspectRatioLocked)} onChange={(aspectRatioLocked) => patchSelected({ aspectRatioLocked })}><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
                </div>
                <Button fullWidth variant={cropEditingId === selectedLayer.id ? 'secondary' : 'ghost'} onPress={() => { const opening = cropEditingId !== selectedLayer.id; setCropEditingId(opening ? selectedLayer.id : null); if (opening) setCanvasTool('move'); }}><Crop size={16} />{cropEditingId === selectedLayer.id ? '完成裁剪' : '可视化裁剪'}</Button>
                {cropEditingId === selectedLayer.id && (
                  <div className="space-y-4 rounded-lg bg-surface-secondary p-3">
                    <SelectControl label="裁剪形状" value={selectedLayer.cropShape || 'rectangle'} options={[{ id: 'rectangle', label: '默认矩形' }, { id: 'circle', label: '圆形' }, { id: 'ellipse', label: '椭圆' }, { id: 'triangle', label: '等腰三角' }, { id: 'parallelogram', label: '平行四边形' }, { id: 'diamond', label: '菱形' }]} onChange={(cropShape) => patchSelected({ cropShape: cropShape as CropMaskShape })} />
                    <CropRangeControl label="水平裁剪范围" start={selectedImageCrop.x * 100} end={(selectedImageCrop.x + selectedImageCrop.width) * 100} onChange={(start, end) => patchSelected({ crop: { ...selectedImageCrop, x: start / 100, width: Math.max(0.01, (end - start) / 100) } })} />
                    <CropRangeControl label="垂直裁剪范围" start={selectedImageCrop.y * 100} end={(selectedImageCrop.y + selectedImageCrop.height) * 100} onChange={(start, end) => patchSelected({ crop: { ...selectedImageCrop, y: start / 100, height: Math.max(0.01, (end - start) / 100) } })} />
                    <Button fullWidth size="sm" variant="ghost" onPress={() => patchSelected({ crop: { x: 0, y: 0, width: 1, height: 1 } })}>重置裁剪</Button>
                    <Description>保留范围会拉伸填满当前图片图层。</Description>
                  </div>
                )}
                <SelectControl label="叠放模式" value={selectedLayer.blendMode || 'source-over'} options={IMAGE_BLEND_OPTIONS} onChange={(blendMode) => patchSelected({ blendMode: blendMode as LayerBlendMode })} />
                <div className="grid grid-cols-3 gap-2">{IMAGE_FILTER_PRESETS.map((preset) => <Button key={preset.id} size="sm" variant="ghost" onPress={() => applyImageFilterPreset(selectedLayer.id, preset.adjustments)}>{preset.label}</Button>)}</div>
                <SliderControl label="高斯模糊" value={(selectedLayer.adjustments || DEFAULT_IMAGE_ADJUSTMENTS).blur} min={0} max={40} suffix=" px" onChange={(blur) => patchImageAdjustments(selectedLayer.id, { blur })} />
                <SliderControl label="胶片颗粒" value={(selectedLayer.adjustments || DEFAULT_IMAGE_ADJUSTMENTS).grain} min={0} max={100} suffix="%" onChange={(grain) => patchImageAdjustments(selectedLayer.id, { grain })} />
                <Button fullWidth variant="secondary" onPress={() => setAdjustmentTarget(selectedLayer.id)}><SlidersHorizontal size={16} />画面调整</Button>
                <ColorControl label="描边颜色" value={selectedLayer.stroke} onChange={(stroke) => patchSelected({ stroke })} />
                <SliderControl label="圆角" value={selectedLayer.radius} min={0} max={200} suffix=" px" onChange={(radius) => patchSelected({ radius })} />
                <SliderControl label="描边" value={selectedLayer.strokeWidth} min={0} max={50} suffix=" px" onChange={(strokeWidth) => patchSelected({ strokeWidth })} />
              </PanelSection>
            )}
            {selectedLayer.type === 'decoration' && <PanelSection title="装饰样式"><div className="flex gap-2"><ColorControl label="主色" value={selectedLayer.color} onChange={(color) => patchSelected({ color })} /><ColorControl label="辅色" value={selectedLayer.secondaryColor} onChange={(secondaryColor) => patchSelected({ secondaryColor })} /></div><SliderControl label="线条粗细" value={selectedLayer.strokeWidth} min={2} max={60} suffix=" px" onChange={(strokeWidth) => patchSelected({ strokeWidth })} /></PanelSection>}
            {selectedLayer.type === 'paint' && (
              <PanelSection title="笔触样式">
                <SliderControl label="画笔粗细" value={selectedLayer.size} min={2} max={400} suffix=" px" onChange={(size) => patchSelected({ size })} />
                {(selectedLayer.kind === 'solid' || selectedLayer.kind === 'gradient') && <SelectControl label="笔刷质感" value={selectedLayer.texture} options={[{ id: 'smooth', label: '平滑圆笔' }, { id: 'marker', label: '马克笔' }, { id: 'chalk', label: '粉笔' }, { id: 'spray', label: '喷枪' }]} onChange={(texture) => patchSelected({ texture: texture as BrushTexture })} />}
                {selectedLayer.kind === 'solid' && <ColorControl label="笔触颜色" value={selectedLayer.color} onChange={(color) => patchSelected({ color })} />}
                {(selectedLayer.kind === 'image' || selectedLayer.kind === 'emoji') && <SliderControl label="图章间距" value={selectedLayer.spacing} min={8} max={200} suffix="%" onChange={(spacing) => patchSelected({ spacing })} />}
              </PanelSection>
            )}
            <PanelSection title="效果" icon={<Box size={15} />}>
              <div className="space-y-2"><Label className="text-xs text-muted">3D 旋转预设</Label><div className="grid grid-cols-3 gap-2">
                <Button size="sm" variant={selectedEffects.rotateX === 0 && selectedEffects.rotateY === 0 ? 'secondary' : 'ghost'} onPress={() => patchSelectedEffects({ rotateX: 0, rotateY: 0 })}>无</Button>
                <Button size="sm" variant="ghost" onPress={() => patchSelectedEffects({ rotateX: 0, rotateY: -32, perspective: 45 })}>左透视</Button>
                <Button size="sm" variant="ghost" onPress={() => patchSelectedEffects({ rotateX: 0, rotateY: 32, perspective: 45 })}>右透视</Button>
                <Button size="sm" variant="ghost" onPress={() => patchSelectedEffects({ rotateX: -28, rotateY: 0, perspective: 45 })}>上仰</Button>
                <Button size="sm" variant="ghost" onPress={() => patchSelectedEffects({ rotateX: 28, rotateY: 0, perspective: 45 })}>俯视</Button>
                <Button size="sm" variant="ghost" onPress={() => patchSelectedEffects({ rotateX: -24, rotateY: 28, perspective: 55 })}>等距</Button>
              </div></div>
              <SliderControl label="X 轴旋转" value={selectedEffects.rotateX} min={-75} max={75} suffix="°" onChange={(rotateX) => patchSelectedEffects({ rotateX })} />
              <SliderControl label="Y 轴旋转" value={selectedEffects.rotateY} min={-75} max={75} suffix="°" onChange={(rotateY) => patchSelectedEffects({ rotateY })} />
              <SliderControl label="透视强度" value={selectedEffects.perspective} min={0} max={100} suffix="%" onChange={(perspective) => patchSelectedEffects({ perspective })} />
              <SliderControl label="3D 厚度" value={selectedEffects.thickness} min={0} max={120} suffix=" px" onChange={(thickness) => patchSelectedEffects({ thickness })} />
              {selectedEffects.thickness > 0 && <><SelectControl label="侧面颜色" value={selectedEffects.thicknessColorMode} options={[{ id: 'auto', label: '自动提取边缘色' }, { id: 'solid', label: '自定义纯色' }, { id: 'gradient', label: '自定义渐变' }]} onChange={(thicknessColorMode) => patchSelectedEffects({ thicknessColorMode: thicknessColorMode as LayerEffects['thicknessColorMode'] })} />{selectedEffects.thicknessColorMode === 'solid' && <ColorControl label="侧面颜色" value={selectedEffects.thicknessColor} onChange={(thicknessColor) => patchSelectedEffects({ thicknessColor })} />}{selectedEffects.thicknessColorMode === 'gradient' && <div className="grid grid-cols-2 gap-2">{selectedEffects.thicknessGradientColors.map((color, index) => <ColorControl key={index} label={`侧面渐变 ${index + 1}`} value={color} onChange={(next) => { const thicknessGradientColors = [...selectedEffects.thicknessGradientColors]; thicknessGradientColors[index] = next; patchSelectedEffects({ thicknessGradientColors }); }} />)}</div>}</>}

              <div className="space-y-2"><Label className="text-xs text-muted">边缘柔化</Label><div className="grid grid-cols-4 gap-2">{[{ label: '无', value: 0 }, { label: '轻柔', value: 3 }, { label: '柔和', value: 8 }, { label: '朦胧', value: 18 }].map((preset) => <Button key={preset.label} size="sm" variant={selectedEffects.edgeSoftness === preset.value ? 'secondary' : 'ghost'} onPress={() => patchSelectedEffects({ edgeSoftness: preset.value })}>{preset.label}</Button>)}</div></div>
              <SliderControl label="自定义柔化" value={selectedEffects.edgeSoftness} min={0} max={40} suffix=" px" onChange={(edgeSoftness) => patchSelectedEffects({ edgeSoftness })} />

              <div className="space-y-2"><Label className="text-xs text-muted">阴影预设</Label><div className="grid grid-cols-4 gap-2">
                <Button size="sm" variant={!selectedEffects.shadowEnabled ? 'secondary' : 'ghost'} onPress={() => patchSelectedEffects({ shadowEnabled: false })}>无</Button>
                <Button size="sm" variant="ghost" onPress={() => patchSelectedEffects({ shadowEnabled: true, shadowType: 'outer', shadowAngle: 45, shadowDistance: 16, shadowBlur: 20 })}>外阴影</Button>
                <Button size="sm" variant="ghost" onPress={() => patchSelectedEffects({ shadowEnabled: true, shadowType: 'inner', shadowAngle: 45, shadowDistance: 8, shadowBlur: 14 })}>内阴影</Button>
                <Button size="sm" variant="ghost" onPress={() => patchSelectedEffects({ shadowEnabled: true, shadowType: 'outer', shadowAngle: -90 })}>上</Button>
                <Button size="sm" variant="ghost" onPress={() => patchSelectedEffects({ shadowEnabled: true, shadowType: 'outer', shadowAngle: 90 })}>下</Button>
                <Button size="sm" variant="ghost" onPress={() => patchSelectedEffects({ shadowEnabled: true, shadowType: 'outer', shadowAngle: 180 })}>左</Button>
                <Button size="sm" variant="ghost" onPress={() => patchSelectedEffects({ shadowEnabled: true, shadowType: 'outer', shadowAngle: 0 })}>右</Button>
              </div></div>
              {selectedEffects.shadowEnabled && <><SelectControl label="阴影类型" value={selectedEffects.shadowType} options={[{ id: 'outer', label: '外阴影' }, { id: 'inner', label: '内阴影' }]} onChange={(shadowType) => patchSelectedEffects({ shadowType: shadowType as LayerEffects['shadowType'] })} /><ColorControl label="阴影颜色" value={selectedEffects.shadowColor} onChange={(shadowColor) => patchSelectedEffects({ shadowColor })} /><SliderControl label="阴影透明度" value={selectedEffects.shadowOpacity} min={0} max={100} suffix="%" onChange={(shadowOpacity) => patchSelectedEffects({ shadowOpacity })} /><SliderControl label="阴影模糊" value={selectedEffects.shadowBlur} min={0} max={100} suffix=" px" onChange={(shadowBlur) => patchSelectedEffects({ shadowBlur })} /><SliderControl label="阴影距离" value={selectedEffects.shadowDistance} min={0} max={200} suffix=" px" onChange={(shadowDistance) => patchSelectedEffects({ shadowDistance })} /><SliderControl label="阴影方向" value={selectedEffects.shadowAngle} min={-180} max={180} suffix="°" onChange={(shadowAngle) => patchSelectedEffects({ shadowAngle })} /></>}

              <div className="space-y-2"><Label className="text-xs text-muted">倒影预设</Label><div className="grid grid-cols-4 gap-2">
                <Button size="sm" variant={!selectedEffects.reflectionEnabled ? 'secondary' : 'ghost'} onPress={() => patchSelectedEffects({ reflectionEnabled: false })}>无</Button>
                <Button size="sm" variant="ghost" onPress={() => patchSelectedEffects({ reflectionEnabled: true, reflectionOpacity: 45, reflectionDistance: 4, reflectionBlur: 1 })}>紧密</Button>
                <Button size="sm" variant="ghost" onPress={() => patchSelectedEffects({ reflectionEnabled: true, reflectionOpacity: 28, reflectionDistance: 14, reflectionBlur: 4 })}>柔和</Button>
                <Button size="sm" variant="ghost" onPress={() => patchSelectedEffects({ reflectionEnabled: true, reflectionOpacity: 55, reflectionDistance: 0, reflectionBlur: 0 })}>清晰</Button>
              </div></div>
              {selectedEffects.reflectionEnabled && <><SliderControl label="倒影透明度" value={selectedEffects.reflectionOpacity} min={0} max={100} suffix="%" onChange={(reflectionOpacity) => patchSelectedEffects({ reflectionOpacity })} /><SliderControl label="倒影距离" value={selectedEffects.reflectionDistance} min={0} max={200} suffix=" px" onChange={(reflectionDistance) => patchSelectedEffects({ reflectionDistance })} /><SliderControl label="倒影模糊" value={selectedEffects.reflectionBlur} min={0} max={40} suffix=" px" onChange={(reflectionBlur) => patchSelectedEffects({ reflectionBlur })} /></>}
            </PanelSection>
          </div>
        ) : <div className="flex h-40 flex-col items-center justify-center gap-2 text-center text-xs text-muted"><Maximize2 size={24} strokeWidth={1.5} /><span>选择一个图层后编辑属性</span></div>}
      </div>
    </aside>
  );

  return (
    <div className="flex h-[calc(100vh-3rem)] min-h-[560px] flex-col overflow-clip rounded-lg border border-border bg-surface-secondary">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-1 border-b border-border bg-background px-2 py-1.5 sm:px-3">
        <div className="mr-1 flex items-center gap-2 px-1"><div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground"><Frame size={16} /></div><div className="hidden lg:block"><div className="text-sm font-semibold leading-4">壁纸制作</div><div className="text-[10px] text-muted">创意画布</div></div></div>
        <Button isIconOnly size="sm" variant="ghost" className="xl:hidden" onPress={() => { setPanelsHidden(false); setMobilePanel(mobilePanel === 'tools' ? null : 'tools'); }} aria-label="打开素材面板"><PanelLeft size={17} /></Button>
        <Button isIconOnly size="sm" variant="ghost" className="xl:hidden" onPress={() => { setPanelsHidden(false); setMobilePanel(mobilePanel === 'layers' ? null : 'layers'); }} aria-label="打开图层面板"><PanelRight size={17} /></Button>
        <div className="mx-1 h-5 w-px bg-border" />
        <IconAction label="撤销 (Ctrl+Z)" onPress={undo} isDisabled={!canUndo}><Undo2 size={17} /></IconAction><IconAction label="重做 (Ctrl+Shift+Z)" onPress={redo} isDisabled={!canRedo}><Redo2 size={17} /></IconAction>
        <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
        <Select className="hidden w-56 md:block" selectedKey={currentSizeId} onSelectionChange={(key) => { const preset = sizeOptions.find((item) => item.id === String(key)); if (preset) patchDocument({ width: preset.width, height: preset.height }); }} aria-label="画布尺寸"><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger><Select.Popover><ListBox>{sizeOptions.map((preset) => <ListBox.Item key={preset.id} id={preset.id} textValue={preset.label}>{preset.label}<ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></Select.Popover></Select>
        <span className="hidden text-xs tabular-nums text-muted lg:inline">{document.width} × {document.height}</span>{isDirty && <span className="hidden rounded-full bg-warning/15 px-2 py-1 text-[11px] text-warning sm:inline">未保存</span>}
        <div className="ml-auto flex items-center gap-1">
          <IconAction label="打开项目" onPress={() => projectInputRef.current?.click()}><FolderOpen size={17} /></IconAction><IconAction label="保存项目 (Ctrl+S)" onPress={() => void saveProject()}><FileArchive size={17} /></IconAction><IconAction label="复制图片" onPress={() => void handleCopy()}><Copy size={17} /></IconAction><IconAction label="重置画布" onPress={resetDocument}><RotateCcw size={17} /></IconAction>
          <Button size="sm" aria-label="导出壁纸" onPress={() => setExportOpen(true)}><Download size={16} /><span className="hidden sm:inline">导出</span></Button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 overflow-clip">
        {leftPanel}
        <main className="relative flex min-w-0 flex-1 flex-col bg-surface-tertiary/50">
          <div
            ref={canvasViewportRef}
            className={`min-h-0 flex-1 overflow-auto ${isPanning ? 'cursor-grabbing' : canvasTool === 'hand' || isSpacePressed ? 'cursor-grab' : ''}`}
            onWheel={handleViewportWheel}
            onPointerDownCapture={handleViewportPointerDown}
            onPointerMoveCapture={handleViewportPointerMove}
            onPointerUpCapture={handleViewportPointerUp}
            onPointerCancelCapture={handleViewportPointerUp}
          >
            <div className="flex min-h-full min-w-full items-center justify-center p-9">
              <div className="overflow-hidden bg-white" style={{ borderRadius: `${Math.min(12, document.border.radius * zoom / 100)}px` }}>
                <EditorCanvas ref={canvasRef} document={document} selectedId={selectedId} zoom={zoom} showGrid={showGrid} snapToGuides={snapToGuides} isPanningMode={canvasTool === 'hand' || isSpacePressed} canvasTool={canvasTool} brushSettings={brushSettings} cropEditingId={cropEditingId} onSelect={setSelectedId} onLayerClick={handleLayerQuickEdit} onLayerInteractionStart={() => setQuickEditor(null)} onOpenProperties={openLayerProperties} onDuplicateForDrag={duplicateLayerForDrag} onCommitBrushStroke={commitBrushStroke} onLiveCropChange={replaceCropLive} onCommitCrop={commitCrop} onLiveLayerChange={replaceLayerLive} onCommitInteraction={commitCanvasInteraction} />
              </div>
            </div>
          </div>
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border bg-background/95 p-1 shadow-md backdrop-blur">
            <div className="hidden items-center gap-1 sm:flex"><IconAction label="移动工具 (V)" onPress={() => setCanvasTool('move')} isActive={canvasTool === 'move'}><MousePointer2 size={16} /></IconAction><IconAction label="抓手工具 (H / 空格)" onPress={() => setCanvasTool('hand')} isActive={canvasTool === 'hand'}><Hand size={16} /></IconAction><IconAction label="画笔工具 (B)" onPress={() => { setCanvasTool('brush'); setToolTab('brush'); }} isActive={canvasTool === 'brush'}><Brush size={16} /></IconAction><div className="mx-1 h-5 w-px bg-border" /></div><IconAction label="缩小 (- / Ctrl+-)" onPress={() => changeZoom(-1)} isDisabled={zoom <= MIN_ZOOM}><ZoomOut size={16} /></IconAction><Button size="sm" variant="ghost" className="w-14 px-1 text-xs tabular-nums" aria-label="恢复 100% 缩放" onPress={() => setZoomLevel(100)}>{zoom}%</Button><IconAction label="放大 (+ / Ctrl++)" onPress={() => changeZoom(1)} isDisabled={zoom >= MAX_ZOOM}><ZoomIn size={16} /></IconAction><div className="mx-1 h-5 w-px bg-border" /><IconAction label="适应窗口 (Ctrl+0)" onPress={fitCanvas}><Maximize2 size={16} /></IconAction><IconAction label={showGrid ? "隐藏网格 (Ctrl+')" : "显示网格 (Ctrl+')"} onPress={() => setShowGrid((value) => !value)} isActive={showGrid}><Grid3X3 size={16} /></IconAction><IconAction label={snapToGuides ? '关闭智能吸附 (Ctrl+;)' : '开启智能吸附 (Ctrl+;)'} onPress={() => setSnapToGuides((value) => !value)} isActive={snapToGuides}><Magnet size={16} /></IconAction>
          </div>
        </main>
        {rightPanel}
      </div>

      {quickEditorEnabled && quickEditor && quickLayer && (
        <div className="fixed z-50 flex h-11 items-center gap-0.5 rounded-lg border border-border bg-background/98 p-1 shadow-xl backdrop-blur" style={{ left: quickEditor.x, top: quickEditor.y }}>
          {quickLayer.type === 'shape' && <QuickColorAction label="填充颜色" value={quickLayer.fill} onChange={(fill) => patchSelected({ fill })} />}
          {quickLayer.type === 'text' && <QuickColorAction label="文字颜色" value={quickLayer.color} onChange={(color) => patchSelected({ color })} />}
          {quickLayer.type === 'decoration' && <QuickColorAction label="装饰颜色" value={quickLayer.color} onChange={(color) => patchSelected({ color })} />}
          {quickLayer.type === 'paint' && (quickLayer.kind === 'solid' || quickLayer.kind === 'gradient') && <QuickColorAction label="笔触颜色" value={quickLayer.color} onChange={(color) => patchSelected({ color })} />}
          <IconAction label="置于顶层" onPress={() => moveLayerToEdge(quickLayer.id, 'front')} isDisabled={document.layers[document.layers.length - 1]?.id === quickLayer.id}><ArrowUpToLine size={15} /></IconAction>
          <IconAction label="上移一层" onPress={() => moveLayer(quickLayer.id, 1)} isDisabled={document.layers[document.layers.length - 1]?.id === quickLayer.id}><ChevronUp size={15} /></IconAction>
          <IconAction label="下移一层" onPress={() => moveLayer(quickLayer.id, -1)} isDisabled={document.layers[0]?.id === quickLayer.id}><ChevronDown size={15} /></IconAction>
          <IconAction label="置于底层" onPress={() => moveLayerToEdge(quickLayer.id, 'back')} isDisabled={document.layers[0]?.id === quickLayer.id}><ArrowDownToLine size={15} /></IconAction>
          <IconAction label="复制" onPress={() => duplicateLayer(quickLayer.id)}><CopyPlus size={15} /></IconAction>
          <IconAction label={quickLayer.locked ? '解锁' : '锁定'} onPress={() => patchSelected({ locked: !quickLayer.locked })} isActive={quickLayer.locked}>{quickLayer.locked ? <Lock size={15} /> : <Unlock size={15} />}</IconAction>
          {quickLayer.type === 'image' && <IconAction label="可视化裁剪" onPress={() => { setCropEditingId(quickLayer.id); setCanvasTool('move'); setQuickEditor(null); }}><Crop size={15} /></IconAction>}
          <IconAction label="更多设置" onPress={() => { setSelectedId(quickLayer.id); setPanelsHidden(false); setMobilePanel('layers'); setQuickEditor(null); }}><SlidersHorizontal size={15} /></IconAction>
          <IconAction label="删除" onPress={() => removeLayer(quickLayer.id)}><Trash2 size={15} className="text-danger" /></IconAction>
          <IconAction label="关闭" onPress={() => setQuickEditor(null)}><X size={15} /></IconAction>
        </div>
      )}

      <input ref={backgroundInputRef} type="file" accept="image/*" className="hidden" onChange={handleBackgroundFile} />
      <input ref={layerImageInputRef} type="file" accept="image/*" className="hidden" onChange={handleLayerImage} />
      <input ref={projectInputRef} type="file" accept=".ltwp,application/x-little-tree-wallpaper-project" className="hidden" onChange={loadProject} />
      <input ref={brushImageInputRef} type="file" accept="image/*" className="hidden" onChange={handleBrushImage} />

      <Modal.Backdrop isOpen={Boolean(adjustmentTarget)} onOpenChange={(open) => !open && setAdjustmentTarget(null)}>
        <Modal.Container size="md"><Modal.Dialog><Modal.CloseTrigger /><Modal.Header><Modal.Icon className="bg-accent-soft text-accent-soft-foreground"><SlidersHorizontal size={20} /></Modal.Icon><Modal.Heading>画面调整</Modal.Heading><p className="text-sm text-muted">{adjustmentTarget === 'background' ? '调整背景图片' : '调整所选图片图层'}</p></Modal.Header><Modal.Body><div className="grid gap-5 sm:grid-cols-2">
          <SliderControl label="亮度" value={activeAdjustments.brightness} min={0} max={200} suffix="%" onChange={(brightness) => adjustmentTarget && patchImageAdjustments(adjustmentTarget, { brightness })} />
          <SliderControl label="对比度" value={activeAdjustments.contrast} min={0} max={200} suffix="%" onChange={(contrast) => adjustmentTarget && patchImageAdjustments(adjustmentTarget, { contrast })} />
          <SliderControl label="饱和度" value={activeAdjustments.saturation} min={0} max={200} suffix="%" onChange={(saturation) => adjustmentTarget && patchImageAdjustments(adjustmentTarget, { saturation })} />
          <SliderControl label="鲜明度" value={activeAdjustments.vibrance} min={-100} max={100} onChange={(vibrance) => adjustmentTarget && patchImageAdjustments(adjustmentTarget, { vibrance })} />
          <SliderControl label="色温" value={activeAdjustments.warmth} min={-100} max={100} onChange={(warmth) => adjustmentTarget && patchImageAdjustments(adjustmentTarget, { warmth })} />
          <SliderControl label="色相" value={activeAdjustments.hue} min={-180} max={180} suffix="°" onChange={(hue) => adjustmentTarget && patchImageAdjustments(adjustmentTarget, { hue })} />
          <SliderControl label="灰度" value={activeAdjustments.grayscale} min={0} max={100} suffix="%" onChange={(grayscale) => adjustmentTarget && patchImageAdjustments(adjustmentTarget, { grayscale })} />
          <SliderControl label="复古褐色" value={activeAdjustments.sepia} min={0} max={100} suffix="%" onChange={(sepia) => adjustmentTarget && patchImageAdjustments(adjustmentTarget, { sepia })} />
          <SliderControl label="高斯模糊" value={activeAdjustments.blur} min={0} max={40} suffix=" px" onChange={(blur) => adjustmentTarget && patchImageAdjustments(adjustmentTarget, { blur })} />
          <SliderControl label="胶片颗粒" value={activeAdjustments.grain} min={0} max={100} suffix="%" onChange={(grain) => adjustmentTarget && patchImageAdjustments(adjustmentTarget, { grain })} />
        </div></Modal.Body><Modal.Footer><Button variant="ghost" onPress={() => adjustmentTarget && applyImageFilterPreset(adjustmentTarget, DEFAULT_IMAGE_ADJUSTMENTS)}>全部重置</Button><Button onPress={() => setAdjustmentTarget(null)}>完成</Button></Modal.Footer></Modal.Dialog></Modal.Container>
      </Modal.Backdrop>

      <Modal.Backdrop isOpen={exportOpen} onOpenChange={(open) => !exporting && setExportOpen(open)}>
        <Modal.Container size="sm"><Modal.Dialog><Modal.CloseTrigger /><Modal.Header><Modal.Icon className="bg-accent-soft text-accent-soft-foreground"><Download size={20} /></Modal.Icon><Modal.Heading>导出壁纸</Modal.Heading><p className="text-sm text-muted">以完整画布尺寸输出当前设计。</p></Modal.Header><Modal.Body><div className="space-y-5"><Input value={exportName} onChange={(event) => setExportName(event.target.value)} aria-label="文件名" placeholder="文件名" /><SelectControl label="图片格式" value={exportFormat} options={[{ id: 'png', label: 'PNG 无损图片' }, { id: 'jpeg', label: 'JPEG 图片' }]} onChange={(value) => setExportFormat(value as 'png' | 'jpeg')} />{exportFormat === 'jpeg' && <SliderControl label="图片质量" value={exportQuality} min={40} max={100} suffix="%" onChange={setExportQuality} />}<div className="rounded-lg bg-surface-secondary px-3 py-2 text-xs text-muted">输出尺寸 {document.width} × {document.height}，辅助网格和选中框不会出现在成品中。</div></div></Modal.Body><Modal.Footer><Button variant="ghost" onPress={() => setExportOpen(false)} isDisabled={exporting}>取消</Button><Button variant="secondary" onPress={() => void handleExport(true)} isDisabled={exporting}><ImageIcon size={16} />设为壁纸</Button><Button onPress={() => void handleExport(false)} isPending={exporting}>{({ isPending }) => <>{isPending ? <Spinner color="current" size="sm" /> : <Save size={16} />}{isPending ? '导出中...' : '另存为'}</>}</Button></Modal.Footer></Modal.Dialog></Modal.Container>
      </Modal.Backdrop>

      <Modal.Backdrop isOpen={navigationPromptOpen} onOpenChange={(open) => { if (!open && !navigationSaving) { setNavigationPromptOpen(false); pendingNavigationRef.current = null; } }}>
        <Modal.Container size="sm"><Modal.Dialog><Modal.CloseTrigger /><Modal.Header><Modal.Icon className="bg-warning-soft text-warning-soft-foreground"><Save size={20} /></Modal.Icon><Modal.Heading>保存当前制作？</Modal.Heading><p className="text-sm text-muted">当前壁纸包含未保存的修改。切换页面前可以保存为 LTWP 项目。</p></Modal.Header><Modal.Body><div className="rounded-lg bg-surface-secondary px-3 py-2 text-sm"><span className="font-medium">{exportName.trim() || '壁纸项目'}.ltwp</span><p className="mt-1 text-xs text-muted">保存后可继续编辑全部图层和样式。</p></div></Modal.Body><Modal.Footer><Button variant="ghost" onPress={() => { setNavigationPromptOpen(false); pendingNavigationRef.current = null; }} isDisabled={navigationSaving}>取消</Button><Button variant="secondary" onPress={handleDiscardAndNavigate} isDisabled={navigationSaving}>不保存</Button><Button onPress={() => void handleSaveAndNavigate()} isPending={navigationSaving}>{({ isPending }) => <>{isPending && <Spinner color="current" size="sm" />}{isPending ? '保存中...' : '保存并切换'}</>}</Button></Modal.Footer></Modal.Dialog></Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
