import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardActionArea,
  CardActions,
  CardContent,
  Chip,
  Divider,
  Grid,
  MenuItem,
  Paper,
  Slider,
  Stack,
  Step,
  StepButton,
  StepLabel,
  Stepper,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import BlurOnRoundedIcon from '@mui/icons-material/BlurOnRounded';
import ChangeHistoryRoundedIcon from '@mui/icons-material/ChangeHistoryRounded';
import ColorLensRoundedIcon from '@mui/icons-material/ColorLensRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import FilterHdrRoundedIcon from '@mui/icons-material/FilterHdrRounded';
import GradientRoundedIcon from '@mui/icons-material/GradientRounded';
import PanoramaHorizontalRoundedIcon from '@mui/icons-material/PanoramaHorizontalRounded';
import PaletteRoundedIcon from '@mui/icons-material/PaletteRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import WallpaperRoundedIcon from '@mui/icons-material/WallpaperRounded';
import WbSunnyRoundedIcon from '@mui/icons-material/WbSunnyRounded';
import { startTransition, useEffect, useMemo, useState } from 'react';

import type { SupportedLocale } from '../i18n';
import type { WallpaperItem } from '../types';

type LocalizedText = {
  'zh-CN': string;
  'en-US': string;
};

type BackgroundMode = 'solid' | 'gradient';
type PatternKind = 'none' | 'grid' | 'waves' | 'dots' | 'arches' | 'lattice';
type GeometryKind = 'circle' | 'diamond' | 'triangle' | 'bar' | 'arc';
type StickerKind = 'sparkle' | 'sun' | 'moon' | 'diamond' | 'petal' | 'ribbon';
type FontFamilyKey = 'sans' | 'serif' | 'mono';
type TextAlignKey = 'left' | 'center' | 'right';
type BorderStyle = 'none' | 'line' | 'double' | 'glow' | 'corners';

type PaletteOption = {
  id: string;
  name: LocalizedText;
  colors: [string, string, string];
};

type PatternConfig = {
  kind: PatternKind;
  color: string;
  opacity: number;
  density: number;
  scale: number;
  rotation: number;
};

type CompositionConfig = {
  ambient: number;
  vignette: number;
};

type GeometryLayer = {
  id: string;
  kind: GeometryKind;
  x: number;
  y: number;
  size: number;
  rotation: number;
  repeat: number;
  spread: number;
  direction: number;
  opacity: number;
  color: string;
};

type StickerInstance = {
  id: string;
  kind: StickerKind;
  x: number;
  y: number;
  size: number;
  rotation: number;
  opacity: number;
  color: string;
};

type TextOverlay = {
  content: string;
  x: number;
  y: number;
  size: number;
  rotation: number;
  opacity: number;
  color: string;
  fontFamily: FontFamilyKey;
  align: TextAlignKey;
};

type BorderConfig = {
  style: BorderStyle;
  color: string;
  width: number;
  inset: number;
  opacity: number;
  radius: number;
};

type CreatorSnapshot = {
  backgroundMode: BackgroundMode;
  paletteId: string;
  colors: [string, string, string];
  gradientAngle: number;
  backgroundIntensity: number;
  pattern: PatternConfig;
  composition: CompositionConfig;
  geometryLayers: GeometryLayer[];
  stickers: StickerInstance[];
  textOverlay: TextOverlay;
  border: BorderConfig;
  seed: number;
};

type UserPreset = {
  id: string;
  name: string;
  note?: string;
  snapshot: CreatorSnapshot;
};

type PresetCollection = {
  id: string;
  name: string;
  presets: UserPreset[];
};

type WallpaperCreatorProps = {
  language: SupportedLocale;
  displayResolution?: {
    width: number;
    height: number;
  };
  onSetWallpaper: (item: WallpaperItem) => void;
  onDownload: (item: WallpaperItem) => void;
};

type GeometryDefinition = {
  kind: GeometryKind;
  label: LocalizedText;
  icon: JSX.Element;
};

type StickerDefinition = {
  kind: StickerKind;
  label: LocalizedText;
  icon: JSX.Element;
};

const PRESET_STORAGE_KEY = 'ltw-wallpaper-creator-collections-v2';

const text = (zhCN: string, enUS: string): LocalizedText => ({
  'zh-CN': zhCN,
  'en-US': enUS,
});

const paletteOptions: PaletteOption[] = [
  { id: 'porcelain', name: text('瓷雾米白', 'Porcelain Haze'), colors: ['#F6F0E8', '#E2D3C3', '#C0A88F'] },
  { id: 'coast', name: text('海岸微光', 'Coastal Light'), colors: ['#EAF5FB', '#7DB9D8', '#285B87'] },
  { id: 'rose', name: text('玫瑰晨雾', 'Rose Morning'), colors: ['#F7E7E9', '#DFA5B4', '#8A5367'] },
  { id: 'moss', name: text('苔绿薄暮', 'Moss Dusk'), colors: ['#E7EFEA', '#8EB09B', '#466655'] },
  { id: 'aurora', name: text('极光天幕', 'Aurora Veil'), colors: ['#C8F4E5', '#7E91EA', '#313760'] },
  { id: 'sand', name: text('沙丘暖金', 'Sandstone Gold'), colors: ['#F6E9D7', '#D0A676', '#8E6446'] },
  { id: 'berry', name: text('莓色丝绒', 'Berry Velvet'), colors: ['#FFE4EC', '#D378A0', '#5B2948'] },
  { id: 'ink', name: text('墨灰银蓝', 'Ink Silver'), colors: ['#EFF2F7', '#92A0B3', '#37414F'] },
  { id: 'lilac', name: text('雾紫石英', 'Lilac Quartz'), colors: ['#F5EEFF', '#B799E9', '#6F51A1'] },
  { id: 'citrus', name: text('柑橘余晖', 'Citrus Glow'), colors: ['#FFF0CC', '#FFB367', '#D95A30'] },
];

const geometryDefinitions: GeometryDefinition[] = [
  { kind: 'circle', label: text('圆形', 'Circle'), icon: <BlurOnRoundedIcon fontSize="small" /> },
  { kind: 'diamond', label: text('菱形', 'Diamond'), icon: <FilterHdrRoundedIcon fontSize="small" /> },
  { kind: 'triangle', label: text('三角', 'Triangle'), icon: <ChangeHistoryRoundedIcon fontSize="small" /> },
  { kind: 'bar', label: text('长条', 'Bar'), icon: <PanoramaHorizontalRoundedIcon fontSize="small" /> },
  { kind: 'arc', label: text('弧线', 'Arc'), icon: <AutoAwesomeRoundedIcon fontSize="small" /> },
];

const stickerDefinitions: StickerDefinition[] = [
  { kind: 'sparkle', label: text('星芒', 'Sparkle'), icon: <AutoAwesomeRoundedIcon fontSize="small" /> },
  { kind: 'sun', label: text('日光', 'Sun'), icon: <WbSunnyRoundedIcon fontSize="small" /> },
  { kind: 'moon', label: text('月牙', 'Moon'), icon: <BlurOnRoundedIcon fontSize="small" /> },
  { kind: 'diamond', label: text('碎钻', 'Diamond'), icon: <FilterHdrRoundedIcon fontSize="small" /> },
  { kind: 'petal', label: text('花瓣', 'Petal'), icon: <PaletteRoundedIcon fontSize="small" /> },
  { kind: 'ribbon', label: text('丝带', 'Ribbon'), icon: <GradientRoundedIcon fontSize="small" /> },
];

const copyByLocale = {
  'zh-CN': {
    badge: '壁纸创作工坊',
    title: '从底色到细节，逐步完成你的专属壁纸。',
    description: '你可以从默认预设开始，也可以从零开始自由搭配颜色、纹样、几何、贴纸、文字和边框，完成后还可以保存到自己的预设集中。',
    workflowNote: '默认预设仅用于快速开始，后续内容都可以继续调整。',
    steps: [
      { label: '选底色', subtitle: '设置纯色或渐变' },
      { label: '选纹样', subtitle: '为画面增加层次' },
      { label: '选几何', subtitle: '调整图形与布局' },
      { label: '贴纸与文本', subtitle: '加入点缀与文字' },
      { label: '边框', subtitle: '完善整体收边' },
      { label: '预览导出', subtitle: '保存并导出作品' },
    ],
    defaultPresets: '默认预设',
    presetCollections: '预设集',
    collectionName: '预设集名称',
    newCollection: '新建预设集',
    renameCollection: '重命名预设集',
    deleteCollection: '删除预设集',
    presetName: '当前预设名',
    savePreset: '保存到当前预设集',
    loadPreset: '加载',
    deletePreset: '删除',
    presetEmpty: '当前预设集还没有内容。',
    backgroundTitle: '底色与配色',
    backgroundSubtitle: '先确定画面的主色调，再选择纯色或渐变效果。',
    solid: '纯色',
    gradient: '渐变',
    primaryColor: '主色',
    secondaryColor: '辅助色',
    accentColor: '强调色',
    gradientAngle: '渐变角度',
    backgroundIntensity: '底色层次',
    patternTitle: '纹样与重复层',
    patternSubtitle: '为背景叠加纹样，让画面更丰富，也更有节奏感。',
    patternKind: '纹样类型',
    patternColor: '纹样颜色',
    patternOpacity: '纹样透明度',
    patternDensity: '纹样密度',
    patternScale: '纹样尺度',
    patternRotation: '纹样角度',
    patternKinds: {
      none: '无',
      grid: '方格',
      waves: '波浪',
      dots: '点阵',
      arches: '拱形',
      lattice: '斜纹',
    },
    geometryTitle: '几何与构图',
    geometrySubtitle: '添加图形元素，调整位置、方向和排列方式，塑造画面结构。',
    noGeometry: '还没有几何图形',
    geometryColor: '图形颜色',
    geometryX: '横向位置',
    geometryY: '纵向位置',
    geometrySize: '图形尺寸',
    geometryRotation: '图形旋转',
    geometryRepeat: '循环次数',
    geometrySpread: '循环间距',
    geometryDirection: '循环方向',
    geometryOpacity: '图形透明度',
    compositionTitle: '画面氛围',
    ambient: '环境层次',
    vignette: '边缘压暗',
    reshuffle: '换一版布局',
    stickersTitle: '贴纸与文本',
    stickersSubtitle: '用贴纸和文字补充细节，让画面更完整、更有个性。',
    stickerColor: '贴纸颜色',
    stickerX: '贴纸横向位置',
    stickerY: '贴纸纵向位置',
    stickerSize: '贴纸尺寸',
    stickerRotation: '贴纸旋转',
    stickerOpacity: '贴纸透明度',
    noSticker: '还没有贴纸',
    textContent: '文本内容',
    textPlaceholder: '输入一句想放到壁纸上的短句',
    textColor: '文本颜色',
    textX: '文本横向位置',
    textY: '文本纵向位置',
    textSize: '字号',
    textRotation: '文本旋转',
    textOpacity: '文本透明度',
    textAlign: '文本对齐',
    fontStyle: '字体风格',
    left: '左对齐',
    center: '居中',
    right: '右对齐',
    sans: '现代无衬线',
    serif: '优雅衬线',
    mono: '等宽',
    clearText: '清空文本',
    borderTitle: '边框收尾',
    borderSubtitle: '为作品加上边框细节，让整体观感更利落。',
    borderStyle: '边框样式',
    borderColor: '边框颜色',
    borderWidth: '边框宽度',
    borderInset: '边框内缩',
    borderOpacity: '边框透明度',
    borderRadius: '边框圆角',
    borderStyles: {
      none: '无边框',
      line: '单线',
      double: '双线',
      glow: '发光框',
      corners: '角框',
    },
    previewTitle: '预览、导出与预设管理',
    previewSubtitle: '确认最终效果后，可以直接应用，也可以保存为自己的预设。',
    artworkName: '作品名称',
    renderSize: '输出尺寸',
    exportHint: '导出会自动按当前屏幕比例裁切适配。',
    apply: '设为壁纸',
    download: '下载 PNG',
    previous: '上一步',
    next: '下一步',
    ready: '当前效果已生成',
    summaryBackground: '底色',
    summaryPattern: '纹样',
    summaryGeometry: '几何',
    summarySticker: '贴纸',
    summaryText: '文本',
    summaryBorder: '边框',
  },
  'en-US': {
    badge: 'Wallpaper Studio',
    title: 'Build a wallpaper step by step, from color to finishing details.',
    description: 'Start from a preset or build from scratch. Adjust color, pattern, geometry, stickers, text, and border freely, then save the result into your own preset collections.',
    workflowNote: 'Presets are only a quick starting point. Every step can still be adjusted afterward.',
    steps: [
      { label: 'Background', subtitle: 'Choose solid or gradient' },
      { label: 'Pattern', subtitle: 'Add texture and rhythm' },
      { label: 'Geometry', subtitle: 'Shape the composition' },
      { label: 'Stickers & Text', subtitle: 'Add accents and copy' },
      { label: 'Border', subtitle: 'Finish the frame' },
      { label: 'Preview & Export', subtitle: 'Save and export' },
    ],
    defaultPresets: 'Default presets',
    presetCollections: 'Preset collections',
    collectionName: 'Collection name',
    newCollection: 'New collection',
    renameCollection: 'Rename collection',
    deleteCollection: 'Delete collection',
    presetName: 'Current preset name',
    savePreset: 'Save into current collection',
    loadPreset: 'Load',
    deletePreset: 'Delete',
    presetEmpty: 'This collection is empty right now.',
    backgroundTitle: 'Background and palette',
    backgroundSubtitle: 'Set the main color direction first, then choose solid or gradient.',
    solid: 'Solid',
    gradient: 'Gradient',
    primaryColor: 'Primary',
    secondaryColor: 'Secondary',
    accentColor: 'Accent',
    gradientAngle: 'Gradient angle',
    backgroundIntensity: 'Background depth',
    patternTitle: 'Pattern layer',
    patternSubtitle: 'Layer a pattern over the background to add texture, rhythm, and detail.',
    patternKind: 'Pattern type',
    patternColor: 'Pattern color',
    patternOpacity: 'Pattern opacity',
    patternDensity: 'Pattern density',
    patternScale: 'Pattern scale',
    patternRotation: 'Pattern angle',
    patternKinds: {
      none: 'None',
      grid: 'Grid',
      waves: 'Waves',
      dots: 'Dots',
      arches: 'Arches',
      lattice: 'Lattice',
    },
    geometryTitle: 'Geometry and composition',
    geometrySubtitle: 'Add shapes and refine their position, direction, and arrangement to build the composition.',
    noGeometry: 'No geometry yet',
    geometryColor: 'Shape color',
    geometryX: 'Horizontal position',
    geometryY: 'Vertical position',
    geometrySize: 'Shape size',
    geometryRotation: 'Shape rotation',
    geometryRepeat: 'Repeat count',
    geometrySpread: 'Repeat spacing',
    geometryDirection: 'Repeat direction',
    geometryOpacity: 'Shape opacity',
    compositionTitle: 'Overall atmosphere',
    ambient: 'Ambient depth',
    vignette: 'Vignette',
    reshuffle: 'Shuffle layout',
    stickersTitle: 'Stickers and text',
    stickersSubtitle: 'Use stickers and text to add character and complete the overall look.',
    stickerColor: 'Sticker color',
    stickerX: 'Sticker X',
    stickerY: 'Sticker Y',
    stickerSize: 'Sticker size',
    stickerRotation: 'Sticker rotation',
    stickerOpacity: 'Sticker opacity',
    noSticker: 'No sticker yet',
    textContent: 'Text content',
    textPlaceholder: 'Type a short line you want on the wallpaper',
    textColor: 'Text color',
    textX: 'Text X',
    textY: 'Text Y',
    textSize: 'Text size',
    textRotation: 'Text rotation',
    textOpacity: 'Text opacity',
    textAlign: 'Text align',
    fontStyle: 'Font style',
    left: 'Left',
    center: 'Center',
    right: 'Right',
    sans: 'Modern sans',
    serif: 'Elegant serif',
    mono: 'Monospace',
    clearText: 'Clear text',
    borderTitle: 'Border finish',
    borderSubtitle: 'Add a border treatment to give the artwork a cleaner final finish.',
    borderStyle: 'Border style',
    borderColor: 'Border color',
    borderWidth: 'Border width',
    borderInset: 'Border inset',
    borderOpacity: 'Border opacity',
    borderRadius: 'Border radius',
    borderStyles: {
      none: 'No border',
      line: 'Single line',
      double: 'Double line',
      glow: 'Glow frame',
      corners: 'Corner frame',
    },
    previewTitle: 'Preview, export, and preset management',
    previewSubtitle: 'Review the final result, then apply it or save it as one of your presets.',
    artworkName: 'Artwork name',
    renderSize: 'Render size',
    exportHint: 'Export is cropped to match the current screen ratio automatically.',
    apply: 'Set as wallpaper',
    download: 'Download PNG',
    previous: 'Back',
    next: 'Next',
    ready: 'Wallpaper ready',
    summaryBackground: 'Background',
    summaryPattern: 'Pattern',
    summaryGeometry: 'Geometry',
    summarySticker: 'Stickers',
    summaryText: 'Text',
    summaryBorder: 'Border',
  },
} as const;

const fontFamilies: Record<FontFamilyKey, string> = {
  sans: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'Consolas, "Courier New", monospace',
};

function makeSnapshot(partial: Partial<CreatorSnapshot>): CreatorSnapshot {
  return {
    backgroundMode: 'gradient',
    paletteId: 'coast',
    colors: ['#EAF5FB', '#7DB9D8', '#285B87'],
    gradientAngle: 132,
    backgroundIntensity: 54,
    pattern: {
      kind: 'none',
      color: '#FFFFFF',
      opacity: 18,
      density: 42,
      scale: 44,
      rotation: 0,
    },
    composition: {
      ambient: 58,
      vignette: 16,
    },
    geometryLayers: [],
    stickers: [],
    textOverlay: {
      content: '',
      x: 50,
      y: 74,
      size: 7,
      rotation: 0,
      opacity: 92,
      color: '#FFFFFF',
      fontFamily: 'sans',
      align: 'center',
    },
    border: {
      style: 'none',
      color: '#FFFFFF',
      width: 8,
      inset: 3,
      opacity: 80,
      radius: 28,
    },
    seed: 1,
    ...partial,
  };
}

const defaultCollections: PresetCollection[] = [
  {
    id: 'default-signature',
    name: '默认预设',
    presets: [
      {
        id: 'preset-porcelain-breath',
        name: '瓷光留白',
        note: '极简留白，适合办公桌面。',
        snapshot: makeSnapshot({
          backgroundMode: 'solid',
          paletteId: 'porcelain',
          colors: ['#F6F0E8', '#E2D3C3', '#C0A88F'],
          backgroundIntensity: 42,
          pattern: { kind: 'none', color: '#FFFFFF', opacity: 0, density: 36, scale: 42, rotation: 0 },
          geometryLayers: [
            { id: 'geo-porcelain', kind: 'circle', x: 80, y: 22, size: 22, rotation: 0, repeat: 1, spread: 0, direction: 0, opacity: 16, color: '#FFFFFF' },
          ],
          border: { style: 'line', color: '#B99F87', width: 4, inset: 3, opacity: 54, radius: 30 },
          composition: { ambient: 52, vignette: 8 },
        }),
      },
      {
        id: 'preset-coast-waves',
        name: '海岸波浪',
        note: '海岸蓝渐变叠加轻波纹。',
        snapshot: makeSnapshot({
          backgroundMode: 'gradient',
          paletteId: 'coast',
          colors: ['#EAF5FB', '#7DB9D8', '#285B87'],
          gradientAngle: 118,
          backgroundIntensity: 62,
          pattern: { kind: 'waves', color: '#FFFFFF', opacity: 18, density: 48, scale: 46, rotation: 12 },
          geometryLayers: [
            { id: 'geo-coast', kind: 'bar', x: 68, y: 34, size: 18, rotation: 16, repeat: 3, spread: 7, direction: 120, opacity: 18, color: '#EAF5FB' },
          ],
          border: { style: 'double', color: '#EAF5FB', width: 4, inset: 4, opacity: 62, radius: 26 },
          composition: { ambient: 62, vignette: 14 },
        }),
      },
      {
        id: 'preset-moss-grid',
        name: '松影方格',
        note: '偏安静的绿调方格和几何。',
        snapshot: makeSnapshot({
          backgroundMode: 'solid',
          paletteId: 'moss',
          colors: ['#E7EFEA', '#8EB09B', '#466655'],
          backgroundIntensity: 46,
          pattern: { kind: 'grid', color: '#466655', opacity: 20, density: 54, scale: 42, rotation: 0 },
          geometryLayers: [
            { id: 'geo-moss', kind: 'diamond', x: 22, y: 76, size: 16, rotation: 18, repeat: 4, spread: 6, direction: 18, opacity: 18, color: '#FFFFFF' },
          ],
          border: { style: 'corners', color: '#D9E8DE', width: 7, inset: 3, opacity: 82, radius: 22 },
          composition: { ambient: 48, vignette: 10 },
        }),
      },
      {
        id: 'preset-berry-bloom',
        name: '莓色花影',
        note: '柔软但不腻，适合配短句文本。',
        snapshot: makeSnapshot({
          backgroundMode: 'gradient',
          paletteId: 'berry',
          colors: ['#FFE4EC', '#D378A0', '#5B2948'],
          gradientAngle: 144,
          backgroundIntensity: 68,
          pattern: { kind: 'dots', color: '#FFFFFF', opacity: 20, density: 46, scale: 50, rotation: 0 },
          geometryLayers: [
            { id: 'geo-berry', kind: 'triangle', x: 72, y: 22, size: 18, rotation: 20, repeat: 3, spread: 8, direction: 132, opacity: 20, color: '#FFE4EC' },
          ],
          border: { style: 'glow', color: '#FFE4EC', width: 5, inset: 3, opacity: 58, radius: 30 },
          composition: { ambient: 70, vignette: 18 },
        }),
      },
    ],
  },
  {
    id: 'default-frames',
    name: '边框灵感',
    presets: [
      {
        id: 'preset-ink-frame',
        name: '夜蓝相框',
        note: '双线边框更适合展示感。',
        snapshot: makeSnapshot({
          backgroundMode: 'gradient',
          paletteId: 'ink',
          colors: ['#EFF2F7', '#92A0B3', '#37414F'],
          gradientAngle: 116,
          pattern: { kind: 'lattice', color: '#FFFFFF', opacity: 12, density: 56, scale: 38, rotation: 24 },
          border: { style: 'double', color: '#FFFFFF', width: 4, inset: 5, opacity: 72, radius: 18 },
          composition: { ambient: 58, vignette: 22 },
        }),
      },
      {
        id: 'preset-lilac-glow',
        name: '雾紫发光框',
        note: '轻发光边框适合娱乐或灵感桌面。',
        snapshot: makeSnapshot({
          backgroundMode: 'gradient',
          paletteId: 'lilac',
          colors: ['#F5EEFF', '#B799E9', '#6F51A1'],
          gradientAngle: 154,
          pattern: { kind: 'arches', color: '#FFFFFF', opacity: 15, density: 42, scale: 54, rotation: 0 },
          border: { style: 'glow', color: '#F5EEFF', width: 5, inset: 4, opacity: 64, radius: 34 },
          composition: { ambient: 64, vignette: 12 },
        }),
      },
    ],
  },
];

function cloneCollections(collections: PresetCollection[]) {
  return JSON.parse(JSON.stringify(collections)) as PresetCollection[];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hashValue(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function normalizeHex(value: string) {
  const cleaned = value.trim().replace(/[^#0-9a-fA-F]/g, '');
  if (!cleaned) {
    return '#000000';
  }
  const normalized = cleaned.startsWith('#') ? cleaned : `#${cleaned}`;
  if (/^#[0-9a-fA-F]{3}$/.test(normalized) || /^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return normalized.toUpperCase();
  }
  return '#000000';
}

function hexToRgba(hex: string, opacity = 1) {
  const normalized = normalizeHex(hex).replace('#', '');
  const expanded = normalized.length === 3
    ? normalized
        .split('')
        .map((char) => `${char}${char}`)
        .join('')
    : normalized;
  const numeric = Number.parseInt(expanded, 16);
  const red = (numeric >> 16) & 255;
  const green = (numeric >> 8) & 255;
  const blue = numeric & 255;
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

function getRelativeLuminance(hex: string) {
  const normalized = normalizeHex(hex).replace('#', '');
  const expanded = normalized.length === 3
    ? normalized
        .split('')
        .map((char) => `${char}${char}`)
        .join('')
    : normalized;
  const numeric = Number.parseInt(expanded, 16);
  const red = ((numeric >> 16) & 255) / 255;
  const green = ((numeric >> 8) & 255) / 255;
  const blue = (numeric & 255) / 255;
  const channels = [red, green, blue].map((channel) => (
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function getVisiblePatternColor(colors: [string, string, string], backgroundMode: BackgroundMode) {
  if (backgroundMode === 'gradient') {
    return normalizeHex(colors[2]);
  }
  return getRelativeLuminance(colors[0]) > 0.55 ? '#1F2937' : '#F8FAFC';
}

function createRandom(seedText: string) {
  let seed = 0;
  for (let index = 0; index < seedText.length; index += 1) {
    seed = (seed * 1664525 + seedText.charCodeAt(index) + 1013904223) >>> 0;
  }

  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
}

function buildLinearGradient(ctx: CanvasRenderingContext2D, width: number, height: number, colors: [string, string, string], angle: number) {
  const radians = (angle * Math.PI) / 180;
  const deltaX = Math.cos(radians) * width * 0.6;
  const deltaY = Math.sin(radians) * height * 0.6;
  const gradient = ctx.createLinearGradient(
    width / 2 - deltaX,
    height / 2 - deltaY,
    width / 2 + deltaX,
    height / 2 + deltaY,
  );
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(0.55, colors[1]);
  gradient.addColorStop(1, colors[2]);
  return gradient;
}

function drawGlow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, opacity: number) {
  const gradient = ctx.createRadialGradient(x, y, radius * 0.08, x, y, radius);
  gradient.addColorStop(0, hexToRgba(color, opacity));
  gradient.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawRoundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
}

function drawPolygon(ctx: CanvasRenderingContext2D, points: Array<[number, number]>, fill: string) {
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) {
      ctx.moveTo(x, y);
      return;
    }
    ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawStickerShape(ctx: CanvasRenderingContext2D, kind: StickerKind, size: number, color: string) {
  switch (kind) {
    case 'sparkle': {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let point = 0; point < 8; point += 1) {
        const outerAngle = (Math.PI / 4) * point;
        const innerAngle = outerAngle + Math.PI / 8;
        const outerRadius = size;
        const innerRadius = size * 0.36;
        const outerX = Math.cos(outerAngle) * outerRadius;
        const outerY = Math.sin(outerAngle) * outerRadius;
        const innerX = Math.cos(innerAngle) * innerRadius;
        const innerY = Math.sin(innerAngle) * innerRadius;
        if (point === 0) {
          ctx.moveTo(outerX, outerY);
        } else {
          ctx.lineTo(outerX, outerY);
        }
        ctx.lineTo(innerX, innerY);
      }
      ctx.closePath();
      ctx.fill();
      return;
    }
    case 'sun': {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, size * 0.07);
      ctx.lineCap = 'round';
      for (let index = 0; index < 12; index += 1) {
        const angle = (Math.PI * 2 * index) / 12;
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * size * 0.58, Math.sin(angle) * size * 0.58);
        ctx.lineTo(Math.cos(angle) * size * 0.84, Math.sin(angle) * size * 0.84);
        ctx.stroke();
      }
      return;
    }
    case 'moon': {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.5, Math.PI * 0.22, Math.PI * 1.76);
      ctx.arc(size * 0.18, -size * 0.02, size * 0.44, Math.PI * 1.7, Math.PI * 0.28, true);
      ctx.closePath();
      ctx.fill();
      return;
    }
    case 'diamond':
      drawPolygon(ctx, [[0, -size], [size * 0.78, 0], [0, size], [-size * 0.78, 0]], color);
      return;
    case 'petal': {
      ctx.fillStyle = color;
      for (let index = 0; index < 6; index += 1) {
        ctx.save();
        ctx.rotate((Math.PI * 2 * index) / 6);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(size * 0.12, -size * 0.42, size * 0.44, -size * 0.42, 0, -size);
        ctx.bezierCurveTo(-size * 0.44, -size * 0.42, -size * 0.12, -size * 0.42, 0, 0);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = hexToRgba('#FFFFFF', 0.92);
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.18, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case 'ribbon': {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-size * 0.88, -size * 0.14);
      ctx.bezierCurveTo(-size * 0.42, -size * 0.68, size * 0.16, -size * 0.52, size * 0.32, 0);
      ctx.bezierCurveTo(size * 0.44, size * 0.42, size * 0.76, size * 0.42, size, size * 0.06);
      ctx.bezierCurveTo(size * 0.3, size * 0.92, -size * 0.34, size * 0.74, -size, size * 0.2);
      ctx.closePath();
      ctx.fill();
      return;
    }
    default:
      return;
  }
}

function drawGeometryShape(ctx: CanvasRenderingContext2D, kind: GeometryKind, size: number, color: string) {
  switch (kind) {
    case 'circle':
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, size, 0, Math.PI * 2);
      ctx.fill();
      return;
    case 'diamond':
      drawPolygon(ctx, [[0, -size], [size * 0.72, 0], [0, size], [-size * 0.72, 0]], color);
      return;
    case 'triangle':
      drawPolygon(ctx, [[0, -size], [size * 0.86, size * 0.62], [-size * 0.86, size * 0.62]], color);
      return;
    case 'bar':
      drawRoundedRectPath(ctx, -size * 1.2, -size * 0.22, size * 2.4, size * 0.44, size * 0.18);
      ctx.fillStyle = color;
      ctx.fill();
      return;
    case 'arc':
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(4, size * 0.14);
      ctx.beginPath();
      ctx.arc(0, 0, size, Math.PI * 0.1, Math.PI * 1.5);
      ctx.stroke();
      return;
    default:
      return;
  }
}

function wrapText(ctx: CanvasRenderingContext2D, content: string, maxWidth: number) {
  const lines: string[] = [];
  const paragraphs = content.split('\n');
  paragraphs.forEach((paragraph) => {
    const words = paragraph.trim().length === 0 ? [''] : paragraph.split(/\s+/);
    let currentLine = '';
    words.forEach((word) => {
      const nextLine = currentLine ? `${currentLine} ${word}` : word;
      if (ctx.measureText(nextLine).width <= maxWidth || currentLine.length === 0) {
        currentLine = nextLine;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    });
    lines.push(currentLine);
  });
  return lines.slice(0, 4);
}

function drawPatternLayer(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  minSide: number,
  pattern: PatternConfig,
  random: () => number,
) {
  if (pattern.kind === 'none' || pattern.opacity <= 0) {
    return;
  }

  const densityFactor = clamp(pattern.density / 100, 0.08, 1);
  const scaleFactor = clamp(pattern.scale / 100, 0.18, 1.4);
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate((pattern.rotation * Math.PI) / 180);
  ctx.translate(-width / 2, -height / 2);
  ctx.strokeStyle = hexToRgba(pattern.color, pattern.opacity / 100);
  ctx.fillStyle = hexToRgba(pattern.color, pattern.opacity / 100);

  if (pattern.kind === 'grid') {
    const gap = minSide * (0.14 - densityFactor * 0.08 + (1 - scaleFactor) * 0.04);
    ctx.lineWidth = Math.max(1, minSide * 0.0024);
    for (let x = -gap; x < width + gap; x += gap) {
      ctx.beginPath();
      ctx.moveTo(x, -gap);
      ctx.lineTo(x, height + gap);
      ctx.stroke();
    }
    for (let y = -gap; y < height + gap; y += gap) {
      ctx.beginPath();
      ctx.moveTo(-gap, y);
      ctx.lineTo(width + gap, y);
      ctx.stroke();
    }
  }

  if (pattern.kind === 'waves') {
    const gap = minSide * (0.12 - densityFactor * 0.05);
    const amplitude = minSide * (0.02 + scaleFactor * 0.045);
    ctx.lineWidth = Math.max(2, minSide * 0.0028);
    for (let baseY = -gap; baseY < height + gap; baseY += gap) {
      ctx.beginPath();
      for (let x = -gap; x < width + gap; x += 14) {
        const y = baseY + Math.sin((x / width) * Math.PI * 4 + baseY * 0.02) * amplitude;
        if (x === -gap) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
  }

  if (pattern.kind === 'dots') {
    const gap = minSide * (0.12 - densityFactor * 0.06 + (1 - scaleFactor) * 0.04);
    for (let x = gap * 0.5; x < width; x += gap) {
      for (let y = gap * 0.5; y < height; y += gap) {
        ctx.beginPath();
        ctx.arc(x, y, minSide * (0.004 + scaleFactor * 0.008) + random() * minSide * 0.003, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  if (pattern.kind === 'arches') {
    const tile = minSide * (0.16 - densityFactor * 0.06 + (1 - scaleFactor) * 0.04);
    ctx.lineWidth = Math.max(2, minSide * 0.0032);
    for (let x = -tile; x < width + tile; x += tile) {
      for (let y = tile * 0.3; y < height + tile; y += tile * 0.86) {
        ctx.beginPath();
        ctx.arc(x + tile * 0.5, y, tile * 0.32, Math.PI, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  if (pattern.kind === 'lattice') {
    const gap = minSide * (0.1 - densityFactor * 0.04 + (1 - scaleFactor) * 0.03);
    ctx.lineWidth = Math.max(1, minSide * 0.0026);
    for (let x = -height; x < width; x += gap) {
      ctx.beginPath();
      ctx.moveTo(x, -gap);
      ctx.lineTo(x + height + gap, height + gap);
      ctx.stroke();
    }
    for (let x = 0; x < width + height; x += gap) {
      ctx.beginPath();
      ctx.moveTo(x, -gap);
      ctx.lineTo(x - height - gap, height + gap);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawGeometryLayer(ctx: CanvasRenderingContext2D, width: number, height: number, minSide: number, layer: GeometryLayer) {
  const angle = (layer.direction * Math.PI) / 180;
  const repeatCount = Math.max(1, Math.round(layer.repeat));
  const offsetDistance = (layer.spread / 100) * minSide;
  const originX = (layer.x / 100) * width;
  const originY = (layer.y / 100) * height;
  const size = minSide * (layer.size / 100);
  for (let index = 0; index < repeatCount; index += 1) {
    const distance = (index - (repeatCount - 1) / 2) * offsetDistance;
    const x = originX + Math.cos(angle) * distance;
    const y = originY + Math.sin(angle) * distance;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    ctx.globalAlpha = layer.opacity / 100;
    drawGeometryShape(ctx, layer.kind, size, layer.color);
    ctx.restore();
  }
}

function drawStickerLayer(ctx: CanvasRenderingContext2D, width: number, height: number, minSide: number, sticker: StickerInstance) {
  const size = minSide * (sticker.size / 100);
  ctx.save();
  ctx.translate((sticker.x / 100) * width, (sticker.y / 100) * height);
  ctx.rotate((sticker.rotation * Math.PI) / 180);
  ctx.globalAlpha = sticker.opacity / 100;
  drawStickerShape(ctx, sticker.kind, size, sticker.color);
  ctx.restore();
}

function drawBorderLayer(ctx: CanvasRenderingContext2D, width: number, height: number, border: BorderConfig) {
  if (border.style === 'none') {
    return;
  }

  const inset = Math.max(6, (border.inset / 100) * Math.min(width, height));
  const radius = (border.radius / 100) * Math.min(width, height) * 0.3;
  const color = hexToRgba(border.color, border.opacity / 100);
  const lineWidth = Math.max(2, (border.width / 100) * Math.min(width, height) * 0.08);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;

  if (border.style === 'line' || border.style === 'glow') {
    if (border.style === 'glow') {
      ctx.shadowColor = hexToRgba(border.color, 0.45);
      ctx.shadowBlur = lineWidth * 6;
    }
    drawRoundedRectPath(ctx, inset, inset, width - inset * 2, height - inset * 2, radius);
    ctx.stroke();
  }

  if (border.style === 'double') {
    drawRoundedRectPath(ctx, inset, inset, width - inset * 2, height - inset * 2, radius);
    ctx.stroke();
    drawRoundedRectPath(ctx, inset + lineWidth * 2.6, inset + lineWidth * 2.6, width - (inset + lineWidth * 2.6) * 2, height - (inset + lineWidth * 2.6) * 2, Math.max(0, radius - lineWidth * 1.5));
    ctx.stroke();
  }

  if (border.style === 'corners') {
    const corner = Math.min(width, height) * 0.08;
    const x1 = inset;
    const y1 = inset;
    const x2 = width - inset;
    const y2 = height - inset;
    const corners: Array<[number, number, number, number, number, number]> = [
      [x1, y1 + corner, x1, y1, x1 + corner, y1],
      [x2 - corner, y1, x2, y1, x2, y1 + corner],
      [x1, y2 - corner, x1, y2, x1 + corner, y2],
      [x2 - corner, y2, x2, y2, x2, y2 - corner],
    ];
    corners.forEach(([sx, sy, mx, my, ex, ey]) => {
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(mx, my);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    });
  }

  ctx.restore();
}

function renderWallpaper(options: {
  width: number;
  height: number;
  snapshot: CreatorSnapshot;
}) {
  const canvas = document.createElement('canvas');
  canvas.width = options.width;
  canvas.height = options.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return '';
  }

  const { width, height, snapshot } = options;
  const { colors } = snapshot;
  const minSide = Math.min(width, height);
  const random = createRandom(`${snapshot.paletteId}:${snapshot.seed}:${snapshot.pattern.kind}:${snapshot.geometryLayers.length}`);
  const isSolidBackground = snapshot.backgroundMode === 'solid';

  if (!isSolidBackground) {
    ctx.fillStyle = buildLinearGradient(ctx, width, height, colors, snapshot.gradientAngle);
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.fillStyle = colors[0];
    ctx.fillRect(0, 0, width, height);
  }

  const ambient = snapshot.composition.ambient / 100;
  if (!isSolidBackground) {
    drawGlow(ctx, width * 0.18, height * 0.18, minSide * (0.26 + ambient * 0.12), colors[1], 0.22 + ambient * 0.18);
    drawGlow(ctx, width * 0.82, height * 0.22, minSide * (0.18 + ambient * 0.12), colors[2], 0.18 + ambient * 0.14);
    drawGlow(ctx, width * 0.72, height * 0.82, minSide * (0.24 + ambient * 0.14), colors[0], 0.14 + ambient * 0.14);
  }

  if (!isSolidBackground) {
    ctx.save();
    ctx.filter = `blur(${Math.round(minSide * 0.018)}px)`;
    ctx.strokeStyle = hexToRgba('#FFFFFF', 0.1 + ambient * 0.1);
    ctx.lineWidth = minSide * 0.045;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-width * 0.08, height * 0.26);
    ctx.bezierCurveTo(width * 0.16, height * 0.04, width * 0.4, height * 0.42, width * 0.72, height * 0.2);
    ctx.bezierCurveTo(width * 0.86, height * 0.1, width * 0.96, height * 0.26, width * 1.06, height * 0.18);
    ctx.stroke();
    ctx.restore();
  }

  drawPatternLayer(ctx, width, height, minSide, snapshot.pattern, random);
  snapshot.geometryLayers.forEach((layer) => drawGeometryLayer(ctx, width, height, minSide, layer));
  snapshot.stickers.forEach((sticker) => drawStickerLayer(ctx, width, height, minSide, sticker));

  if (snapshot.textOverlay.content.trim()) {
    const fontSize = Math.round(minSide * (snapshot.textOverlay.size / 100));
    ctx.save();
    ctx.translate((snapshot.textOverlay.x / 100) * width, (snapshot.textOverlay.y / 100) * height);
    ctx.rotate((snapshot.textOverlay.rotation * Math.PI) / 180);
    ctx.globalAlpha = snapshot.textOverlay.opacity / 100;
    ctx.fillStyle = snapshot.textOverlay.color;
    ctx.textAlign = snapshot.textOverlay.align;
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${fontSize}px ${fontFamilies[snapshot.textOverlay.fontFamily]}`;
    const lines = wrapText(ctx, snapshot.textOverlay.content, width * 0.62);
    const lineHeight = fontSize * 1.18;
    const anchorOffset = snapshot.textOverlay.align === 'left' ? -width * 0.24 : snapshot.textOverlay.align === 'right' ? width * 0.24 : 0;
    lines.forEach((line, index) => {
      const yOffset = (index - (lines.length - 1) / 2) * lineHeight;
      ctx.fillText(line, anchorOffset, yOffset);
    });
    ctx.restore();
  }

  if (snapshot.composition.vignette > 0) {
    const vignette = ctx.createRadialGradient(width / 2, height / 2, minSide * 0.14, width / 2, height / 2, minSide * 0.9);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, `rgba(0, 0, 0, ${snapshot.composition.vignette / 220})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }

  drawBorderLayer(ctx, width, height, snapshot.border);
  return canvas.toDataURL('image/png');
}

function safeLoadCollections() {
  try {
    const raw = window.localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) {
      return cloneCollections(defaultCollections);
    }
    const parsed = JSON.parse(raw) as PresetCollection[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return cloneCollections(defaultCollections);
    }
    return parsed;
  } catch {
    return cloneCollections(defaultCollections);
  }
}

export function WallpaperCreator({ language, displayResolution, onSetWallpaper, onDownload }: WallpaperCreatorProps) {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('md'));
  const copy = copyByLocale[language];
  const localeKey: SupportedLocale = language === 'en-US' ? 'en-US' : 'zh-CN';
  const initialPreset = defaultCollections[0].presets[0];

  const [activeStep, setActiveStep] = useState(0);
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>(initialPreset.snapshot.backgroundMode);
  const [paletteId, setPaletteId] = useState(initialPreset.snapshot.paletteId);
  const [colors, setColors] = useState<[string, string, string]>(initialPreset.snapshot.colors);
  const [gradientAngle, setGradientAngle] = useState(initialPreset.snapshot.gradientAngle);
  const [backgroundIntensity, setBackgroundIntensity] = useState(initialPreset.snapshot.backgroundIntensity);
  const [pattern, setPattern] = useState<PatternConfig>(initialPreset.snapshot.pattern);
  const [composition, setComposition] = useState<CompositionConfig>(initialPreset.snapshot.composition);
  const [geometryLayers, setGeometryLayers] = useState<GeometryLayer[]>(initialPreset.snapshot.geometryLayers);
  const [activeGeometryId, setActiveGeometryId] = useState<string | null>(initialPreset.snapshot.geometryLayers[0]?.id ?? null);
  const [stickers, setStickers] = useState<StickerInstance[]>(initialPreset.snapshot.stickers);
  const [activeStickerId, setActiveStickerId] = useState<string | null>(initialPreset.snapshot.stickers[0]?.id ?? null);
  const [textOverlay, setTextOverlay] = useState<TextOverlay>(initialPreset.snapshot.textOverlay);
  const [border, setBorder] = useState<BorderConfig>(initialPreset.snapshot.border);
  const [seed, setSeed] = useState(initialPreset.snapshot.seed);
  const [title, setTitle] = useState(initialPreset.name);
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [collections, setCollections] = useState<PresetCollection[]>(() => cloneCollections(defaultCollections));
  const [selectedCollectionId, setSelectedCollectionId] = useState(defaultCollections[0].id);
  const [collectionDraftName, setCollectionDraftName] = useState('');
  const [presetDraftName, setPresetDraftName] = useState(initialPreset.name);

  useEffect(() => {
    const loaded = safeLoadCollections();
    setCollections(loaded);
    setSelectedCollectionId(loaded[0]?.id ?? defaultCollections[0].id);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(collections));
  }, [collections]);

  const currentSnapshot = useMemo<CreatorSnapshot>(() => ({
    backgroundMode,
    paletteId,
    colors,
    gradientAngle,
    backgroundIntensity,
    pattern,
    composition,
    geometryLayers,
    stickers,
    textOverlay,
    border,
    seed,
  }), [backgroundIntensity, backgroundMode, border, colors, composition, geometryLayers, gradientAngle, paletteId, pattern, seed, stickers, textOverlay]);

  const renderSize = useMemo(() => {
    const rawWidth = clamp(Math.round(displayResolution?.width ?? 1920), 1280, 3840);
    const rawHeight = clamp(Math.round(displayResolution?.height ?? 1080), 720, 2160);
    const ratio = Math.min(1, 2800 / rawWidth, 1600 / rawHeight);
    return {
      width: Math.max(1280, Math.round(rawWidth * ratio)),
      height: Math.max(720, Math.round(rawHeight * ratio)),
      outputWidth: rawWidth,
      outputHeight: rawHeight,
    };
  }, [displayResolution?.height, displayResolution?.width]);

  const selectedPalette = useMemo(
    () => paletteOptions.find((palette) => palette.id === paletteId) ?? null,
    [paletteId],
  );

  const selectedCollection = useMemo(
    () => collections.find((collection) => collection.id === selectedCollectionId) ?? collections[0] ?? null,
    [collections, selectedCollectionId],
  );

  const activeGeometry = useMemo(
    () => geometryLayers.find((layer) => layer.id === activeGeometryId) ?? null,
    [activeGeometryId, geometryLayers],
  );

  const activeSticker = useMemo(
    () => stickers.find((sticker) => sticker.id === activeStickerId) ?? null,
    [activeStickerId, stickers],
  );

  useEffect(() => {
    const nextUrl = renderWallpaper({
      width: renderSize.width,
      height: renderSize.height,
      snapshot: currentSnapshot,
    });
    startTransition(() => {
      setGeneratedUrl(nextUrl);
    });
  }, [currentSnapshot, renderSize.height, renderSize.width]);

  const generatedItem = useMemo<WallpaperItem | null>(() => {
    if (!generatedUrl) {
      return null;
    }
    const serialized = JSON.stringify({ snapshot: currentSnapshot, title, size: renderSize });
    return {
      id: `creator:${hashValue(serialized)}`,
      source_id: 'builtin.creator',
      source_name: language === 'en-US' ? 'Wallpaper Creator' : '壁纸创作工坊',
      title: title.trim() || presetDraftName.trim() || (language === 'en-US' ? 'Custom Wallpaper' : '自定义壁纸'),
      image_url: generatedUrl,
      preview_url: generatedUrl,
      width: renderSize.outputWidth,
      height: renderSize.outputHeight,
      description: selectedCollection?.name ?? (language === 'en-US' ? 'Custom wallpaper' : '自定义壁纸'),
      metadata: {
        creator_snapshot: currentSnapshot,
        output_profile: {
          mode: 'cover_center_crop',
          width: renderSize.outputWidth,
          height: renderSize.outputHeight,
        },
      },
    };
  }, [currentSnapshot, generatedUrl, language, presetDraftName, renderSize, selectedCollection?.name, title]);

  function applySnapshot(snapshot: CreatorSnapshot, nextTitle?: string) {
    setBackgroundMode(snapshot.backgroundMode);
    setPaletteId(snapshot.paletteId);
    setColors(snapshot.colors);
    setGradientAngle(snapshot.gradientAngle);
    setBackgroundIntensity(snapshot.backgroundIntensity);
    setPattern(snapshot.pattern);
    setComposition(snapshot.composition);
    setGeometryLayers(snapshot.geometryLayers);
    setActiveGeometryId(snapshot.geometryLayers[0]?.id ?? null);
    setStickers(snapshot.stickers);
    setActiveStickerId(snapshot.stickers[0]?.id ?? null);
    setTextOverlay(snapshot.textOverlay);
    setBorder(snapshot.border);
    setSeed(snapshot.seed);
    if (nextTitle) {
      setTitle(nextTitle);
      setPresetDraftName(nextTitle);
    }
  }

  function updateColor(index: number, value: string) {
    const normalized = normalizeHex(value);
    setColors((current) => {
      const next = [...current] as [string, string, string];
      next[index] = normalized;
      return next;
    });
    setPaletteId('custom');
  }

  function updatePatternColor(value: string) {
    setPattern((current) => ({ ...current, color: normalizeHex(value) }));
  }

  function updatePatternKind(nextKind: PatternKind) {
    setPattern((current) => {
      if (nextKind === 'none') {
        return { ...current, kind: nextKind };
      }

      const shouldBoostVisibility = current.kind === 'none' || current.opacity < 24 || normalizeHex(current.color) === '#FFFFFF';
      return {
        ...current,
        kind: nextKind,
        color: shouldBoostVisibility ? getVisiblePatternColor(colors, backgroundMode) : current.color,
        opacity: shouldBoostVisibility ? 38 : current.opacity,
        density: shouldBoostVisibility ? 56 : current.density,
        scale: shouldBoostVisibility ? 52 : current.scale,
      };
    });
  }

  function addGeometry(kind: GeometryKind) {
    const next: GeometryLayer = {
      id: `${kind}-${Date.now()}-${geometryLayers.length}`,
      kind,
      x: 50,
      y: 50,
      size: 16,
      rotation: 0,
      repeat: 1,
      spread: 10,
      direction: 0,
      opacity: 24,
      color: colors[2],
    };
    setGeometryLayers((current) => [...current, next]);
    setActiveGeometryId(next.id);
  }

  function updateGeometry(patch: Partial<GeometryLayer>) {
    if (!activeGeometryId) {
      return;
    }
    setGeometryLayers((current) => current.map((layer) => (layer.id === activeGeometryId ? { ...layer, ...patch } : layer)));
  }

  function removeGeometry() {
    if (!activeGeometryId) {
      return;
    }
    setGeometryLayers((current) => {
      const next = current.filter((layer) => layer.id !== activeGeometryId);
      setActiveGeometryId(next[0]?.id ?? null);
      return next;
    });
  }

  function addSticker(kind: StickerKind) {
    const next: StickerInstance = {
      id: `${kind}-${Date.now()}-${stickers.length}`,
      kind,
      x: 50,
      y: 50,
      size: 9,
      rotation: 0,
      opacity: 92,
      color: colors[2],
    };
    setStickers((current) => [...current, next]);
    setActiveStickerId(next.id);
  }

  function updateSticker(patch: Partial<StickerInstance>) {
    if (!activeStickerId) {
      return;
    }
    setStickers((current) => current.map((sticker) => (sticker.id === activeStickerId ? { ...sticker, ...patch } : sticker)));
  }

  function removeSticker() {
    if (!activeStickerId) {
      return;
    }
    setStickers((current) => {
      const next = current.filter((sticker) => sticker.id !== activeStickerId);
      setActiveStickerId(next[0]?.id ?? null);
      return next;
    });
  }

  function createCollection() {
    const name = collectionDraftName.trim();
    if (!name) {
      return;
    }
    const collection: PresetCollection = {
      id: `collection-${Date.now()}`,
      name,
      presets: [],
    };
    setCollections((current) => [...current, collection]);
    setSelectedCollectionId(collection.id);
    setCollectionDraftName('');
  }

  function renameCollection() {
    const name = collectionDraftName.trim();
    if (!name || !selectedCollection) {
      return;
    }
    setCollections((current) => current.map((collection) => (collection.id === selectedCollection.id ? { ...collection, name } : collection)));
    setCollectionDraftName('');
  }

  function deleteCollection() {
    if (!selectedCollection || collections.length <= 1) {
      return;
    }
    setCollections((current) => {
      const next = current.filter((collection) => collection.id !== selectedCollection.id);
      setSelectedCollectionId(next[0]?.id ?? current[0]?.id ?? defaultCollections[0].id);
      return next;
    });
  }

  function saveCurrentPreset() {
    const presetName = presetDraftName.trim();
    if (!selectedCollection || !presetName) {
      return;
    }
    const nextPreset: UserPreset = {
      id: `preset-${Date.now()}`,
      name: presetName,
      note: title.trim(),
      snapshot: currentSnapshot,
    };
    setCollections((current) => current.map((collection) => (
      collection.id === selectedCollection.id
        ? { ...collection, presets: [nextPreset, ...collection.presets] }
        : collection
    )));
  }

  function deletePreset(presetId: string) {
    if (!selectedCollection) {
      return;
    }
    setCollections((current) => current.map((collection) => (
      collection.id === selectedCollection.id
        ? { ...collection, presets: collection.presets.filter((preset) => preset.id !== presetId) }
        : collection
    )));
  }

  const steps = copy.steps;
  const quickPresets = collections[0]?.presets.slice(0, 4) ?? [];

  return (
    <Stack spacing={3}>
      <Paper
        sx={{
          p: { xs: 2.5, md: 3 },
          background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.08)} 0%, ${alpha(theme.palette.secondary.main, 0.08)} 100%)`,
          border: `1px solid ${alpha(theme.palette.primary.main, 0.12)}`,
        }}
      >
        <Stack spacing={1.5}>
          <Chip label={copy.badge} color="primary" variant="outlined" sx={{ alignSelf: 'flex-start' }} />
          <Typography variant="h4">{copy.title}</Typography>
          <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 980 }}>
            {copy.description}
          </Typography>
          <Alert severity="info">{copy.workflowNote}</Alert>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <Chip icon={<WallpaperRoundedIcon />} label={`${copy.renderSize}: ${renderSize.outputWidth} × ${renderSize.outputHeight}`} />
            <Chip icon={<AutoAwesomeRoundedIcon />} label={copy.ready} />
          </Stack>
        </Stack>
      </Paper>

      <Paper sx={{ p: { xs: 1.5, md: 2 } }}>
        <Stepper nonLinear activeStep={activeStep} orientation={mobile ? 'vertical' : 'horizontal'} alternativeLabel={!mobile}>
          {steps.map((step, index) => (
            <Step key={step.label} completed={index < activeStep}>
              <StepButton color="inherit" onClick={() => setActiveStep(index)}>
                <StepLabel>
                  <Stack spacing={0.25} alignItems={mobile ? 'flex-start' : 'center'}>
                    <Typography variant="subtitle2">{step.label}</Typography>
                    <Typography variant="caption" color="text.secondary">{step.subtitle}</Typography>
                  </Stack>
                </StepLabel>
              </StepButton>
            </Step>
          ))}
        </Stepper>
      </Paper>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, xl: 7 }}>
          <Card>
            <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
              <Stack spacing={3}>
                {activeStep === 0 && (
                  <Stack spacing={3}>
                    <Stack spacing={1.25}>
                      <Typography variant="h5">{copy.defaultPresets}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {copy.workflowNote}
                      </Typography>
                    </Stack>

                    <Grid container spacing={2}>
                      {quickPresets.map((preset) => (
                        <Grid key={preset.id} size={{ xs: 12, md: 6 }}>
                          <Card variant="outlined">
                            <CardActionArea onClick={() => applySnapshot(preset.snapshot, preset.name)}>
                              <Box
                                sx={{
                                  height: 132,
                                  background: `linear-gradient(${preset.snapshot.gradientAngle}deg, ${preset.snapshot.colors[0]} 0%, ${preset.snapshot.colors[1]} 50%, ${preset.snapshot.colors[2]} 100%)`,
                                }}
                              />
                              <CardContent>
                                <Stack spacing={1}>
                                  <Typography variant="h6">{preset.name}</Typography>
                                  {preset.note && <Typography variant="body2" color="text.secondary">{preset.note}</Typography>}
                                </Stack>
                              </CardContent>
                            </CardActionArea>
                          </Card>
                        </Grid>
                      ))}
                    </Grid>

                    <Divider />

                    <Stack spacing={2}>
                      <Typography variant="h5">{copy.backgroundTitle}</Typography>
                      <Typography variant="body2" color="text.secondary">{copy.backgroundSubtitle}</Typography>
                      <ToggleButtonGroup
                        value={backgroundMode}
                        exclusive
                        onChange={(_event, nextValue: BackgroundMode | null) => {
                          if (!nextValue) {
                            return;
                          }
                          setBackgroundMode(nextValue);
                        }}
                        size="small"
                      >
                        <ToggleButton value="solid">
                          <Stack direction="row" spacing={1} alignItems="center">
                            <ColorLensRoundedIcon fontSize="small" />
                            <span>{copy.solid}</span>
                          </Stack>
                        </ToggleButton>
                        <ToggleButton value="gradient">
                          <Stack direction="row" spacing={1} alignItems="center">
                            <GradientRoundedIcon fontSize="small" />
                            <span>{copy.gradient}</span>
                          </Stack>
                        </ToggleButton>
                      </ToggleButtonGroup>

                      <Grid container spacing={2}>
                        {paletteOptions.map((palette) => {
                          const selected = palette.id === selectedPalette?.id;
                          return (
                            <Grid key={palette.id} size={{ xs: 12, md: 6 }}>
                              <Card sx={{ borderColor: selected ? 'primary.main' : undefined }}>
                                <CardActionArea
                                  onClick={() => {
                                    setPaletteId(palette.id);
                                    setColors(palette.colors);
                                  }}
                                >
                                  <Box sx={{ height: 84, background: `linear-gradient(135deg, ${palette.colors[0]} 0%, ${palette.colors[1]} 48%, ${palette.colors[2]} 100%)` }} />
                                  <CardContent>
                                    <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
                                      <Typography variant="subtitle1">{palette.name[localeKey]}</Typography>
                                      {selected && <Chip size="small" color="primary" label={copy.ready} />}
                                    </Stack>
                                  </CardContent>
                                </CardActionArea>
                              </Card>
                            </Grid>
                          );
                        })}
                      </Grid>

                      <Grid container spacing={2}>
                        <Grid size={{ xs: 12, md: backgroundMode === 'solid' ? 12 : 4 }}>
                          <ColorControl label={copy.primaryColor} value={colors[0]} onChange={(value) => updateColor(0, value)} />
                        </Grid>
                        {backgroundMode === 'gradient' && (
                          <>
                            <Grid size={{ xs: 12, md: 4 }}>
                              <ColorControl label={copy.secondaryColor} value={colors[1]} onChange={(value) => updateColor(1, value)} />
                            </Grid>
                            <Grid size={{ xs: 12, md: 4 }}>
                              <ColorControl label={copy.accentColor} value={colors[2]} onChange={(value) => updateColor(2, value)} />
                            </Grid>
                          </>
                        )}
                      </Grid>

                      {backgroundMode === 'gradient' && <SliderField label={copy.gradientAngle} value={gradientAngle} min={0} max={360} onChange={setGradientAngle} />}
                    </Stack>
                  </Stack>
                )}

                {activeStep === 1 && (
                  <Stack spacing={3}>
                    <Stack spacing={1.25}>
                      <Typography variant="h5">{copy.patternTitle}</Typography>
                      <Typography variant="body2" color="text.secondary">{copy.patternSubtitle}</Typography>
                    </Stack>

                    <TextField
                      select
                      label={copy.patternKind}
                      value={pattern.kind}
                      onChange={(event) => updatePatternKind(event.target.value as PatternKind)}
                      fullWidth
                    >
                      <MenuItem value="none">{copy.patternKinds.none}</MenuItem>
                      <MenuItem value="grid">{copy.patternKinds.grid}</MenuItem>
                      <MenuItem value="waves">{copy.patternKinds.waves}</MenuItem>
                      <MenuItem value="dots">{copy.patternKinds.dots}</MenuItem>
                      <MenuItem value="arches">{copy.patternKinds.arches}</MenuItem>
                      <MenuItem value="lattice">{copy.patternKinds.lattice}</MenuItem>
                    </TextField>

                    <ColorControl label={copy.patternColor} value={pattern.color} onChange={updatePatternColor} />
                    <SliderField label={copy.patternOpacity} value={pattern.opacity} min={0} max={100} onChange={(value) => setPattern((current) => ({ ...current, opacity: value }))} />
                    <SliderField label={copy.patternDensity} value={pattern.density} min={0} max={100} onChange={(value) => setPattern((current) => ({ ...current, density: value }))} />
                    <SliderField label={copy.patternScale} value={pattern.scale} min={20} max={100} onChange={(value) => setPattern((current) => ({ ...current, scale: value }))} />
                    <SliderField label={copy.patternRotation} value={pattern.rotation} min={-180} max={180} onChange={(value) => setPattern((current) => ({ ...current, rotation: value }))} />
                  </Stack>
                )}

                {activeStep === 2 && (
                  <Stack spacing={3}>
                    <Stack spacing={1.25}>
                      <Typography variant="h5">{copy.geometryTitle}</Typography>
                      <Typography variant="body2" color="text.secondary">{copy.geometrySubtitle}</Typography>
                    </Stack>

                    <Grid container spacing={1.5}>
                      {geometryDefinitions.map((item) => (
                        <Grid key={item.kind} size={{ xs: 6, md: 4, xl: 3 }}>
                          <Card variant="outlined">
                            <CardActionArea onClick={() => addGeometry(item.kind)}>
                              <CardContent sx={{ py: 2.5 }}>
                                <Stack spacing={1.25} alignItems="center">
                                  <Avatar sx={{ bgcolor: alpha(theme.palette.primary.main, 0.12), color: 'primary.main' }}>{item.icon}</Avatar>
                                  <Typography variant="body2">{item.label[localeKey]}</Typography>
                                </Stack>
                              </CardContent>
                            </CardActionArea>
                          </Card>
                        </Grid>
                      ))}
                    </Grid>

                    {geometryLayers.length === 0 ? (
                      <Alert severity="info">{copy.noGeometry}</Alert>
                    ) : (
                      <Stack spacing={2}>
                        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1.5}>
                          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                            {geometryLayers.map((layer, index) => {
                              const definition = geometryDefinitions.find((item) => item.kind === layer.kind) ?? geometryDefinitions[0];
                              return (
                                <Chip
                                  key={layer.id}
                                  label={`${definition.label[localeKey]} ${index + 1}`}
                                  color={layer.id === activeGeometryId ? 'primary' : 'default'}
                                  onClick={() => setActiveGeometryId(layer.id)}
                                />
                              );
                            })}
                          </Stack>
                          <Button variant="text" color="inherit" onClick={removeGeometry} disabled={!activeGeometry}>{copy.deletePreset}</Button>
                        </Stack>

                        {activeGeometry && (
                          <Paper variant="outlined" sx={{ p: 2.5 }}>
                            <Stack spacing={3}>
                              <ColorControl label={copy.geometryColor} value={activeGeometry.color} onChange={(value) => updateGeometry({ color: normalizeHex(value) })} />
                              <SliderField label={copy.geometryX} value={activeGeometry.x} min={0} max={100} onChange={(value) => updateGeometry({ x: value })} />
                              <SliderField label={copy.geometryY} value={activeGeometry.y} min={0} max={100} onChange={(value) => updateGeometry({ y: value })} />
                              <SliderField label={copy.geometrySize} value={activeGeometry.size} min={6} max={32} onChange={(value) => updateGeometry({ size: value })} />
                              <SliderField label={copy.geometryRotation} value={activeGeometry.rotation} min={-180} max={180} onChange={(value) => updateGeometry({ rotation: value })} />
                              <SliderField label={copy.geometryRepeat} value={activeGeometry.repeat} min={1} max={8} onChange={(value) => updateGeometry({ repeat: Math.round(value) })} />
                              <SliderField label={copy.geometrySpread} value={activeGeometry.spread} min={0} max={28} onChange={(value) => updateGeometry({ spread: value })} />
                              <SliderField label={copy.geometryDirection} value={activeGeometry.direction} min={0} max={360} onChange={(value) => updateGeometry({ direction: value })} />
                              <SliderField label={copy.geometryOpacity} value={activeGeometry.opacity} min={0} max={100} onChange={(value) => updateGeometry({ opacity: value })} />
                            </Stack>
                          </Paper>
                        )}
                      </Stack>
                    )}

                    <Divider />

                    <Stack spacing={2}>
                      <Typography variant="h6">{copy.compositionTitle}</Typography>
                      <SliderField label={copy.ambient} value={composition.ambient} min={0} max={100} onChange={(value) => setComposition((current) => ({ ...current, ambient: value }))} />
                      <SliderField label={copy.vignette} value={composition.vignette} min={0} max={40} onChange={(value) => setComposition((current) => ({ ...current, vignette: value }))} />
                      <Button variant="outlined" startIcon={<RefreshRoundedIcon />} onClick={() => setSeed((current) => current + 1)} sx={{ alignSelf: 'flex-start' }}>
                        {copy.reshuffle}
                      </Button>
                    </Stack>
                  </Stack>
                )}

                {activeStep === 3 && (
                  <Stack spacing={3}>
                    <Stack spacing={1.25}>
                      <Typography variant="h5">{copy.stickersTitle}</Typography>
                      <Typography variant="body2" color="text.secondary">{copy.stickersSubtitle}</Typography>
                    </Stack>

                    <Grid container spacing={1.5}>
                      {stickerDefinitions.map((item) => (
                        <Grid key={item.kind} size={{ xs: 6, md: 4, xl: 3 }}>
                          <Card variant="outlined">
                            <CardActionArea onClick={() => addSticker(item.kind)}>
                              <CardContent sx={{ py: 2.5 }}>
                                <Stack spacing={1.25} alignItems="center">
                                  <Avatar sx={{ bgcolor: alpha(theme.palette.primary.main, 0.12), color: 'primary.main' }}>{item.icon}</Avatar>
                                  <Typography variant="body2">{item.label[localeKey]}</Typography>
                                </Stack>
                              </CardContent>
                            </CardActionArea>
                          </Card>
                        </Grid>
                      ))}
                    </Grid>

                    {stickers.length === 0 ? (
                      <Alert severity="info">{copy.noSticker}</Alert>
                    ) : (
                      <Stack spacing={2}>
                        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1.5}>
                          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                            {stickers.map((sticker, index) => {
                              const definition = stickerDefinitions.find((item) => item.kind === sticker.kind) ?? stickerDefinitions[0];
                              return (
                                <Chip
                                  key={sticker.id}
                                  label={`${definition.label[localeKey]} ${index + 1}`}
                                  color={sticker.id === activeStickerId ? 'primary' : 'default'}
                                  onClick={() => setActiveStickerId(sticker.id)}
                                />
                              );
                            })}
                          </Stack>
                          <Button variant="text" color="inherit" onClick={removeSticker} disabled={!activeSticker}>{copy.deletePreset}</Button>
                        </Stack>

                        {activeSticker && (
                          <Paper variant="outlined" sx={{ p: 2.5 }}>
                            <Stack spacing={3}>
                              <ColorControl label={copy.stickerColor} value={activeSticker.color} onChange={(value) => updateSticker({ color: normalizeHex(value) })} />
                              <SliderField label={copy.stickerX} value={activeSticker.x} min={0} max={100} onChange={(value) => updateSticker({ x: value })} />
                              <SliderField label={copy.stickerY} value={activeSticker.y} min={0} max={100} onChange={(value) => updateSticker({ y: value })} />
                              <SliderField label={copy.stickerSize} value={activeSticker.size} min={4} max={24} onChange={(value) => updateSticker({ size: value })} />
                              <SliderField label={copy.stickerRotation} value={activeSticker.rotation} min={-180} max={180} onChange={(value) => updateSticker({ rotation: value })} />
                              <SliderField label={copy.stickerOpacity} value={activeSticker.opacity} min={0} max={100} onChange={(value) => updateSticker({ opacity: value })} />
                            </Stack>
                          </Paper>
                        )}
                      </Stack>
                    )}

                    <Divider />

                    <Stack spacing={2}>
                      <Typography variant="h6">{copy.textContent}</Typography>
                      <TextField
                        label={copy.textContent}
                        multiline
                        minRows={3}
                        value={textOverlay.content}
                        onChange={(event) => setTextOverlay((current) => ({ ...current, content: event.target.value }))}
                        placeholder={copy.textPlaceholder}
                        fullWidth
                      />
                      <ColorControl label={copy.textColor} value={textOverlay.color} onChange={(value) => setTextOverlay((current) => ({ ...current, color: normalizeHex(value) }))} />
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                        <Button variant="text" color="inherit" onClick={() => setTextOverlay((current) => ({ ...current, content: '' }))}>{copy.clearText}</Button>
                      </Stack>
                      <Stack spacing={1.5}>
                        <Typography variant="subtitle2" color="text.secondary">{copy.fontStyle}</Typography>
                        <ToggleButtonGroup
                          value={textOverlay.fontFamily}
                          exclusive
                          onChange={(_event, nextValue: FontFamilyKey | null) => {
                            if (!nextValue) {
                              return;
                            }
                            setTextOverlay((current) => ({ ...current, fontFamily: nextValue }));
                          }}
                          size="small"
                        >
                          <ToggleButton value="sans">{copy.sans}</ToggleButton>
                          <ToggleButton value="serif">{copy.serif}</ToggleButton>
                          <ToggleButton value="mono">{copy.mono}</ToggleButton>
                        </ToggleButtonGroup>
                      </Stack>
                      <Stack spacing={1.5}>
                        <Typography variant="subtitle2" color="text.secondary">{copy.textAlign}</Typography>
                        <ToggleButtonGroup
                          value={textOverlay.align}
                          exclusive
                          onChange={(_event, nextValue: TextAlignKey | null) => {
                            if (!nextValue) {
                              return;
                            }
                            setTextOverlay((current) => ({ ...current, align: nextValue }));
                          }}
                          size="small"
                        >
                          <ToggleButton value="left">{copy.left}</ToggleButton>
                          <ToggleButton value="center">{copy.center}</ToggleButton>
                          <ToggleButton value="right">{copy.right}</ToggleButton>
                        </ToggleButtonGroup>
                      </Stack>
                      <Paper variant="outlined" sx={{ p: 2.5 }}>
                        <Stack spacing={3}>
                          <SliderField label={copy.textX} value={textOverlay.x} min={0} max={100} onChange={(value) => setTextOverlay((current) => ({ ...current, x: value }))} />
                          <SliderField label={copy.textY} value={textOverlay.y} min={0} max={100} onChange={(value) => setTextOverlay((current) => ({ ...current, y: value }))} />
                          <SliderField label={copy.textSize} value={textOverlay.size} min={3} max={18} onChange={(value) => setTextOverlay((current) => ({ ...current, size: value }))} />
                          <SliderField label={copy.textRotation} value={textOverlay.rotation} min={-40} max={40} onChange={(value) => setTextOverlay((current) => ({ ...current, rotation: value }))} />
                          <SliderField label={copy.textOpacity} value={textOverlay.opacity} min={0} max={100} onChange={(value) => setTextOverlay((current) => ({ ...current, opacity: value }))} />
                        </Stack>
                      </Paper>
                    </Stack>
                  </Stack>
                )}

                {activeStep === 4 && (
                  <Stack spacing={3}>
                    <Stack spacing={1.25}>
                      <Typography variant="h5">{copy.borderTitle}</Typography>
                      <Typography variant="body2" color="text.secondary">{copy.borderSubtitle}</Typography>
                    </Stack>

                    <TextField
                      select
                      label={copy.borderStyle}
                      value={border.style}
                      onChange={(event) => setBorder((current) => ({ ...current, style: event.target.value as BorderStyle }))}
                      fullWidth
                    >
                      <MenuItem value="none">{copy.borderStyles.none}</MenuItem>
                      <MenuItem value="line">{copy.borderStyles.line}</MenuItem>
                      <MenuItem value="double">{copy.borderStyles.double}</MenuItem>
                      <MenuItem value="glow">{copy.borderStyles.glow}</MenuItem>
                      <MenuItem value="corners">{copy.borderStyles.corners}</MenuItem>
                    </TextField>

                    <ColorControl label={copy.borderColor} value={border.color} onChange={(value) => setBorder((current) => ({ ...current, color: normalizeHex(value) }))} />
                    <SliderField label={copy.borderWidth} value={border.width} min={1} max={14} onChange={(value) => setBorder((current) => ({ ...current, width: value }))} />
                    <SliderField label={copy.borderInset} value={border.inset} min={1} max={10} onChange={(value) => setBorder((current) => ({ ...current, inset: value }))} />
                    <SliderField label={copy.borderOpacity} value={border.opacity} min={0} max={100} onChange={(value) => setBorder((current) => ({ ...current, opacity: value }))} />
                    <SliderField label={copy.borderRadius} value={border.radius} min={0} max={100} onChange={(value) => setBorder((current) => ({ ...current, radius: value }))} />
                  </Stack>
                )}

                {activeStep === 5 && (
                  <Stack spacing={3}>
                    <Stack spacing={1.25}>
                      <Typography variant="h5">{copy.previewTitle}</Typography>
                      <Typography variant="body2" color="text.secondary">{copy.previewSubtitle}</Typography>
                    </Stack>

                    <TextField label={copy.artworkName} value={title} onChange={(event) => setTitle(event.target.value)} fullWidth />
                    <TextField label={copy.presetName} value={presetDraftName} onChange={(event) => setPresetDraftName(event.target.value)} fullWidth />

                    <Paper variant="outlined" sx={{ p: 2.5 }}>
                      <Stack spacing={2}>
                        <Typography variant="h6">{copy.presetCollections}</Typography>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          {collections.map((collection) => (
                            <Chip
                              key={collection.id}
                              label={collection.name}
                              color={collection.id === selectedCollection?.id ? 'primary' : 'default'}
                              onClick={() => setSelectedCollectionId(collection.id)}
                            />
                          ))}
                        </Stack>

                        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                          <TextField label={copy.collectionName} value={collectionDraftName} onChange={(event) => setCollectionDraftName(event.target.value)} fullWidth />
                          <Button variant="outlined" onClick={createCollection}>{copy.newCollection}</Button>
                          <Button variant="outlined" onClick={renameCollection} disabled={!selectedCollection}>{copy.renameCollection}</Button>
                          <Button variant="text" color="inherit" onClick={deleteCollection} disabled={!selectedCollection || collections.length <= 1}>{copy.deleteCollection}</Button>
                        </Stack>

                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                          <Button variant="contained" onClick={saveCurrentPreset} disabled={!selectedCollection || !presetDraftName.trim()}>
                            {copy.savePreset}
                          </Button>
                        </Stack>

                        {selectedCollection?.presets.length ? (
                          <Grid container spacing={2}>
                            {selectedCollection.presets.map((preset) => (
                              <Grid key={preset.id} size={{ xs: 12, md: 6 }}>
                                <Card variant="outlined">
                                  <Box
                                    sx={{
                                      height: 92,
                                      background: `linear-gradient(${preset.snapshot.gradientAngle}deg, ${preset.snapshot.colors[0]} 0%, ${preset.snapshot.colors[1]} 50%, ${preset.snapshot.colors[2]} 100%)`,
                                    }}
                                  />
                                  <CardContent>
                                    <Stack spacing={1}>
                                      <Typography variant="subtitle1">{preset.name}</Typography>
                                      {preset.note && <Typography variant="body2" color="text.secondary">{preset.note}</Typography>}
                                    </Stack>
                                  </CardContent>
                                  <CardActions sx={{ px: 2, pb: 2 }}>
                                    <Button size="small" onClick={() => applySnapshot(preset.snapshot, preset.name)}>{copy.loadPreset}</Button>
                                    <Button size="small" color="inherit" onClick={() => deletePreset(preset.id)}>{copy.deletePreset}</Button>
                                  </CardActions>
                                </Card>
                              </Grid>
                            ))}
                          </Grid>
                        ) : (
                          <Alert severity="info">{copy.presetEmpty}</Alert>
                        )}
                      </Stack>
                    </Paper>

                    <Paper variant="outlined" sx={{ p: 2.5 }}>
                      <Stack spacing={1.5}>
                        <Typography variant="h6">{copy.renderSize}</Typography>
                        <Typography variant="body2" color="text.secondary">{copy.exportHint}</Typography>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          <Chip label={`${copy.summaryBackground}: ${backgroundMode === 'solid' ? copy.solid : copy.gradient}`} />
                          <Chip label={`${copy.summaryPattern}: ${copy.patternKinds[pattern.kind]}`} />
                          <Chip label={`${copy.summaryGeometry}: ${geometryLayers.length}`} />
                          <Chip label={`${copy.summarySticker}: ${stickers.length}`} />
                          <Chip label={`${copy.summaryText}: ${textOverlay.content.trim() ? 1 : 0}`} />
                          <Chip label={`${copy.summaryBorder}: ${copy.borderStyles[border.style]}`} />
                        </Stack>
                      </Stack>
                    </Paper>
                  </Stack>
                )}
              </Stack>
            </CardContent>

            <Divider />

            <CardActions sx={{ p: 2, justifyContent: 'space-between' }}>
              <Button disabled={activeStep === 0} onClick={() => setActiveStep((current) => Math.max(0, current - 1))}>{copy.previous}</Button>
              <Button variant="contained" disabled={activeStep === steps.length - 1} onClick={() => setActiveStep((current) => Math.min(steps.length - 1, current + 1))}>{copy.next}</Button>
            </CardActions>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, xl: 5 }}>
          <Card sx={{ position: { xl: 'sticky' }, top: { xl: 92 } }}>
            <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
              <Stack spacing={2}>
                <Stack spacing={0.5}>
                  <Typography variant="h5">{copy.previewTitle}</Typography>
                  <Typography variant="body2" color="text.secondary">{copy.previewSubtitle}</Typography>
                </Stack>

                <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: 3, bgcolor: alpha(theme.palette.common.black, 0.04) }}>
                  {generatedUrl ? (
                    <Box component="img" src={generatedUrl} alt={title} sx={{ width: '100%', display: 'block', aspectRatio: `${renderSize.outputWidth} / ${renderSize.outputHeight}`, objectFit: 'cover' }} />
                  ) : (
                    <Box sx={{ aspectRatio: '16 / 9', display: 'grid', placeItems: 'center' }}>
                      <Typography variant="body2" color="text.secondary">{copy.previewSubtitle}</Typography>
                    </Box>
                  )}
                </Paper>

                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {colors.map((color) => (
                    <Box key={color} sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: color, border: `1px solid ${alpha(theme.palette.common.black, 0.12)}` }} />
                  ))}
                </Stack>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                  <Button variant="contained" startIcon={<WallpaperRoundedIcon />} onClick={() => generatedItem && onSetWallpaper(generatedItem)} disabled={!generatedItem} fullWidth>
                    {copy.apply}
                  </Button>
                  <Button variant="outlined" startIcon={<DownloadRoundedIcon />} onClick={() => generatedItem && onDownload(generatedItem)} disabled={!generatedItem} fullWidth>
                    {copy.download}
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Stack>
  );
}

function SliderField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <Stack spacing={1}>
      <Stack direction="row" justifyContent="space-between" spacing={1}>
        <Typography variant="body2" color="text.secondary">{label}</Typography>
        <Typography variant="body2">{Math.round(value)}</Typography>
      </Stack>
      <Slider value={value} min={min} max={max} onChange={(_event, nextValue) => onChange(Array.isArray(nextValue) ? nextValue[0] : nextValue)} valueLabelDisplay="auto" />
    </Stack>
  );
}

function ColorControl({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Stack spacing={1}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Paper variant="outlined" sx={{ p: 1.25 }}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <TextField type="color" value={normalizeHex(value)} onChange={(event) => onChange(event.target.value)} sx={{ width: 88, flexShrink: 0 }} />
          <TextField value={normalizeHex(value)} onChange={(event) => onChange(event.target.value)} fullWidth />
        </Stack>
      </Paper>
    </Stack>
  );
}
