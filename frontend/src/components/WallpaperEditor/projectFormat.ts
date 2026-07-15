import type { EditorLayer, WallpaperDocument } from './types';
import { DEFAULT_IMAGE_ADJUSTMENTS, DEFAULT_LAYER_EFFECTS } from './types';

const MAGIC = new Uint8Array([0x4c, 0x54, 0x57, 0x50]); // LTWP
const FORMAT_VERSION = 8;
const LEGACY_FORMAT_VERSIONS = [1, 2, 3, 4, 5, 6, 7];
const HEADER_SIZE = 16;
const MAX_PROJECT_BYTES = 200 * 1024 * 1024 - HEADER_SIZE;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

const enum ValueTag {
  Null = 0,
  False = 1,
  True = 2,
  Number = 3,
  String = 4,
  Array = 5,
  Object = 6,
}

class BinaryWriter {
  private buffer = new Uint8Array(1024);
  private length = 0;

  private ensureCapacity(additional: number) {
    const required = this.length + additional;
    if (required > MAX_PROJECT_BYTES) throw new Error('项目文件超过 200 MB');
    if (required <= this.buffer.length) return;
    let capacity = this.buffer.length;
    while (capacity < required) capacity = Math.max(capacity * 2, required);
    const next = new Uint8Array(capacity);
    next.set(this.buffer);
    this.buffer = next;
  }

  writeU8(value: number) {
    this.ensureCapacity(1);
    this.buffer[this.length] = value & 0xff;
    this.length += 1;
  }

  writeU32(value: number) {
    this.ensureCapacity(4);
    new DataView(this.buffer.buffer).setUint32(this.length, value, true);
    this.length += 4;
  }

  writeF64(value: number) {
    this.ensureCapacity(8);
    new DataView(this.buffer.buffer).setFloat64(this.length, value, true);
    this.length += 8;
  }

  writeBytes(value: Uint8Array) {
    this.ensureCapacity(value.length);
    this.buffer.set(value, this.length);
    this.length += value.length;
  }

  writeString(value: string) {
    const bytes = encoder.encode(value);
    this.writeU32(bytes.length);
    this.writeBytes(bytes);
  }

  writeValue(value: unknown, depth = 0) {
    if (depth > 40) throw new Error('项目结构层级过深');
    if (value === null || value === undefined) {
      this.writeU8(ValueTag.Null);
    } else if (value === false) {
      this.writeU8(ValueTag.False);
    } else if (value === true) {
      this.writeU8(ValueTag.True);
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('项目包含无效数值');
      this.writeU8(ValueTag.Number);
      this.writeF64(value);
    } else if (typeof value === 'string') {
      this.writeU8(ValueTag.String);
      this.writeString(value);
    } else if (Array.isArray(value)) {
      this.writeU8(ValueTag.Array);
      this.writeU32(value.length);
      value.forEach((item) => this.writeValue(item, depth + 1));
    } else if (typeof value === 'object') {
      this.writeU8(ValueTag.Object);
      const entries = Object.entries(value).filter(([, item]) => item !== undefined);
      this.writeU32(entries.length);
      entries.forEach(([key, item]) => {
        this.writeString(key);
        this.writeValue(item, depth + 1);
      });
    } else {
      throw new Error('项目包含不支持的数据类型');
    }
  }

  finish(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}

class BinaryReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  private take(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.bytes.length) {
      throw new Error('项目文件已损坏或不完整');
    }
    const result = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }

  readU8(): number {
    return this.take(1)[0];
  }

  readU32(): number {
    const value = new DataView(this.take(4).buffer, this.bytes.byteOffset + this.offset - 4, 4);
    return value.getUint32(0, true);
  }

  readF64(): number {
    const value = new DataView(this.take(8).buffer, this.bytes.byteOffset + this.offset - 8, 8).getFloat64(0, true);
    if (!Number.isFinite(value)) throw new Error('项目包含无效数值');
    return value;
  }

  readString(): string {
    const length = this.readU32();
    if (length > MAX_PROJECT_BYTES) throw new Error('项目文本字段过大');
    return decoder.decode(this.take(length));
  }

  readValue(depth = 0): unknown {
    if (depth > 40) throw new Error('项目结构层级过深');
    const tag = this.readU8();
    if (tag === ValueTag.Null) return null;
    if (tag === ValueTag.False) return false;
    if (tag === ValueTag.True) return true;
    if (tag === ValueTag.Number) return this.readF64();
    if (tag === ValueTag.String) return this.readString();
    if (tag === ValueTag.Array) {
      const count = this.readU32();
      if (count > 10000) throw new Error('项目数组过大');
      return Array.from({ length: count }, () => this.readValue(depth + 1));
    }
    if (tag === ValueTag.Object) {
      const count = this.readU32();
      if (count > 10000) throw new Error('项目对象过大');
      const result: Record<string, unknown> = {};
      for (let index = 0; index < count; index += 1) {
        const key = this.readString();
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('项目字段无效');
        result[key] = this.readValue(depth + 1);
      }
      return result;
    }
    throw new Error('项目包含未知数据标记');
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function hasString(record: Record<string, unknown>, key: string, maxLength = 1000): boolean {
  return typeof record[key] === 'string' && (record[key] as string).length > 0 && (record[key] as string).length <= maxLength;
}

function hasBoundedString(record: Record<string, unknown>, key: string, maxLength: number): boolean {
  return typeof record[key] === 'string' && (record[key] as string).length <= maxLength;
}

function hasNumber(record: Record<string, unknown>, key: string, min: number, max: number): boolean {
  return isFiniteNumber(record[key], min, max);
}

function hasColor(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === 'string' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(record[key] as string);
}

function hasEnum(record: Record<string, unknown>, key: string, values: readonly string[]): boolean {
  return typeof record[key] === 'string' && values.includes(record[key] as string);
}

function isValidImageAdjustments(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return hasNumber(value, 'brightness', 0, 300)
    && hasNumber(value, 'contrast', 0, 300)
    && hasNumber(value, 'saturation', 0, 300)
    && hasNumber(value, 'vibrance', -100, 100)
    && hasNumber(value, 'warmth', -100, 100)
    && hasNumber(value, 'hue', -180, 180)
    && hasNumber(value, 'grayscale', 0, 100)
    && hasNumber(value, 'sepia', 0, 100)
    && hasNumber(value, 'blur', 0, 100)
    && hasNumber(value, 'grain', 0, 100);
}

function isValidLayerEffects(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return hasNumber(value, 'rotateX', -89, 89)
    && hasNumber(value, 'rotateY', -89, 89)
    && hasNumber(value, 'perspective', 0, 100)
    && hasNumber(value, 'thickness', 0, 300)
    && hasEnum(value, 'thicknessColorMode', ['auto', 'solid', 'gradient'])
    && hasColor(value, 'thicknessColor')
    && Array.isArray(value.thicknessGradientColors)
    && value.thicknessGradientColors.length >= 2
    && value.thicknessGradientColors.length <= 8
    && value.thicknessGradientColors.every((color) => typeof color === 'string' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color))
    && hasNumber(value, 'edgeSoftness', 0, 100)
    && typeof value.shadowEnabled === 'boolean'
    && hasEnum(value, 'shadowType', ['outer', 'inner'])
    && hasColor(value, 'shadowColor')
    && hasNumber(value, 'shadowOpacity', 0, 100)
    && hasNumber(value, 'shadowBlur', 0, 200)
    && hasNumber(value, 'shadowDistance', 0, 1000)
    && hasNumber(value, 'shadowAngle', -360, 360)
    && typeof value.reflectionEnabled === 'boolean'
    && hasNumber(value, 'reflectionOpacity', 0, 100)
    && hasNumber(value, 'reflectionDistance', 0, 1000)
    && hasNumber(value, 'reflectionBlur', 0, 100);
}

function hasBaseLayer(value: unknown): value is EditorLayer {
  if (!isRecord(value)) return false;
  return hasString(value, 'id', 160)
    && hasBoundedString(value, 'name', 300)
    && ['shape', 'text', 'image', 'decoration', 'paint'].includes(String(value.type))
    && typeof value.visible === 'boolean'
    && typeof value.locked === 'boolean'
    && isFiniteNumber(value.opacity, 0, 100)
    && isFiniteNumber(value.x, -100000, 100000)
    && isFiniteNumber(value.y, -100000, 100000)
    && isFiniteNumber(value.width, 1, 100000)
    && isFiniteNumber(value.height, 1, 100000)
    && isFiniteNumber(value.rotation, -100000, 100000)
    && (value.flipX === undefined || typeof value.flipX === 'boolean')
    && (value.flipY === undefined || typeof value.flipY === 'boolean')
    && (value.effects === undefined || isValidLayerEffects(value.effects));
}

function isSafeImageSource(value: unknown): boolean {
  return typeof value === 'string' && (value === '' || value.startsWith('data:image/'));
}

function isValidLayer(value: unknown): value is EditorLayer {
  if (!hasBaseLayer(value) || !isRecord(value)) return false;
  if (value.type === 'shape') {
    return hasEnum(value, 'shape', ['rectangle', 'circle', 'triangle', 'star', 'hexagon', 'heart'])
      && hasColor(value, 'fill') && hasColor(value, 'stroke')
      && hasNumber(value, 'strokeWidth', 0, 1000) && hasNumber(value, 'radius', 0, 10000)
      && hasColor(value, 'shadowColor') && hasNumber(value, 'shadowBlur', 0, 2000);
  }
  if (value.type === 'text') {
    return hasBoundedString(value, 'text', 20000) && hasColor(value, 'color')
      && hasString(value, 'fontFamily', 300) && hasNumber(value, 'fontSize', 1, 2000)
      && hasNumber(value, 'fontWeight', 100, 1000) && hasEnum(value, 'align', ['left', 'center', 'right'])
      && hasNumber(value, 'letterSpacing', -100, 1000) && hasNumber(value, 'lineHeight', 0.1, 10)
      && hasColor(value, 'stroke') && hasNumber(value, 'strokeWidth', 0, 1000)
      && hasColor(value, 'shadowColor') && hasNumber(value, 'shadowBlur', 0, 2000)
      && (value.characterStyles === undefined || (
        Array.isArray(value.characterStyles)
        && value.characterStyles.length <= 20000
        && value.characterStyles.every((style) => isRecord(style)
          && (style.color === undefined || hasColor(style, 'color'))
          && (style.backgroundColor === undefined || hasColor(style, 'backgroundColor'))
          && (style.fontSize === undefined || hasNumber(style, 'fontSize', 1, 2000))
          && (style.fontFamily === undefined || hasString(style, 'fontFamily', 300))
          && (style.fontWeight === undefined || hasNumber(style, 'fontWeight', 100, 1000))
          && (style.fontStyle === undefined || hasEnum(style, 'fontStyle', ['normal', 'italic']))
          && (style.underline === undefined || typeof style.underline === 'boolean')
          && (style.letterSpacing === undefined || hasNumber(style, 'letterSpacing', -100, 1000)))));
  }
  if (value.type === 'image') {
    return isSafeImageSource(value.src) && hasEnum(value, 'fit', ['cover', 'contain', 'stretch'])
      && hasNumber(value, 'radius', 0, 10000) && hasColor(value, 'stroke')
      && hasNumber(value, 'strokeWidth', 0, 1000) && hasColor(value, 'shadowColor')
      && hasNumber(value, 'shadowBlur', 0, 2000)
      && (value.sourceAspectRatio === undefined || isFiniteNumber(value.sourceAspectRatio, 0.0001, 10000))
      && (value.aspectRatioLocked === undefined || typeof value.aspectRatioLocked === 'boolean')
      && (value.blendMode === undefined || hasEnum(value, 'blendMode', ['source-over', 'multiply', 'screen', 'overlay', 'soft-light', 'hard-light', 'darken', 'lighten', 'color-dodge', 'color-burn', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']))
      && (value.adjustments === undefined || isValidImageAdjustments(value.adjustments))
      && (value.cropShape === undefined || hasEnum(value, 'cropShape', ['rectangle', 'circle', 'ellipse', 'triangle', 'parallelogram', 'diamond']))
      && (value.dominantColor === undefined || hasColor(value, 'dominantColor'))
      && (value.crop === undefined || (
        isRecord(value.crop)
        && hasNumber(value.crop, 'x', 0, 0.99)
        && hasNumber(value.crop, 'y', 0, 0.99)
        && hasNumber(value.crop, 'width', 0.01, 1)
        && hasNumber(value.crop, 'height', 0.01, 1)
        && Number(value.crop.x) + Number(value.crop.width) <= 1.000001
        && Number(value.crop.y) + Number(value.crop.height) <= 1.000001
      ));
  }
  if (value.type === 'paint') {
    return hasEnum(value, 'kind', ['solid', 'gradient', 'image', 'emoji'])
      && hasEnum(value, 'texture', ['smooth', 'marker', 'chalk', 'spray'])
      && hasNumber(value, 'size', 1, 2000)
      && hasColor(value, 'color')
      && Array.isArray(value.gradientColors)
      && value.gradientColors.length >= 2
      && value.gradientColors.length <= 8
      && value.gradientColors.every((color) => typeof color === 'string' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color))
      && hasNumber(value, 'spacing', 1, 500)
      && (value.imageSrc === undefined || isSafeImageSource(value.imageSrc))
      && hasBoundedString(value, 'emoji', 64)
      && hasEnum(value, 'stampOrientation', ['fixed', 'follow'])
      && hasNumber(value, 'stampRotation', -100000, 100000)
      && typeof value.distortWithDirection === 'boolean'
      && hasNumber(value, 'sourceWidth', 1, 100000)
      && hasNumber(value, 'sourceHeight', 1, 100000)
      && Array.isArray(value.points)
      && value.points.length >= 1
      && value.points.length <= 50000
      && value.points.every((point) => isRecord(point)
        && hasNumber(point, 'x', -100000, 100000)
        && hasNumber(point, 'y', -100000, 100000)
        && hasNumber(point, 'angle', -100000, 100000));
  }
  return hasEnum(value, 'decoration', ['sparkle', 'flower', 'leaf', 'orbit', 'rainbow', 'tape'])
    && hasColor(value, 'color') && hasColor(value, 'secondaryColor')
    && hasNumber(value, 'strokeWidth', 0, 1000);
}

export function isValidWallpaperDocument(value: unknown): value is WallpaperDocument {
  if (!isRecord(value)) return false;
  if (!Number.isInteger(value.width) || !Number.isInteger(value.height)
    || !isFiniteNumber(value.width, 64, 8192) || !isFiniteNumber(value.height, 64, 8192)
    || value.width * value.height > 40_000_000) return false;
  if (!isRecord(value.background) || !isRecord(value.border) || !Array.isArray(value.layers)) return false;
  if (value.layers.length > 300 || !value.layers.every(isValidLayer)) return false;
  const layerIds = value.layers.map((layer) => layer.id);
  if (new Set(layerIds).size !== layerIds.length) return false;
  const background = value.background;
  const border = value.border;
  return hasEnum(background, 'mode', ['solid', 'gradient', 'image'])
    && hasColor(background, 'color')
    && hasEnum(background, 'gradientType', ['linear', 'radial', 'conic'])
    && Array.isArray(background.gradientColors)
    && background.gradientColors.length >= 2
    && background.gradientColors.length <= 8
    && background.gradientColors.every((color) => typeof color === 'string' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color))
    && hasNumber(background, 'gradientAngle', -100000, 100000)
    && (background.imageSrc === undefined || isSafeImageSource(background.imageSrc))
    && hasEnum(background, 'imageFit', ['cover', 'contain', 'stretch'])
    && hasNumber(background, 'imageBlur', 0, 200) && hasNumber(background, 'imageBrightness', 0, 500)
    && hasEnum(background, 'texture', ['none', 'grain', 'dots', 'grid', 'diagonal', 'waves', 'paper'])
    && hasColor(background, 'textureColor') && hasNumber(background, 'textureOpacity', 0, 100)
    && hasNumber(background, 'textureScale', 1, 2000)
    && (background.adjustments === undefined || isValidImageAdjustments(background.adjustments))
    && hasEnum(border, 'style', ['none', 'solid', 'double', 'dashed', 'film', 'corners'])
    && hasColor(border, 'color') && hasNumber(border, 'width', 0, 2000)
    && hasNumber(border, 'inset', 0, 10000) && hasNumber(border, 'radius', 0, 10000)
    && hasNumber(border, 'opacity', 0, 100);
}

function sanitizeWallpaperDocument(value: WallpaperDocument): WallpaperDocument {
  const sanitizeAdjustments = (adjustments = DEFAULT_IMAGE_ADJUSTMENTS) => ({
    brightness: adjustments.brightness,
    contrast: adjustments.contrast,
    saturation: adjustments.saturation,
    vibrance: adjustments.vibrance,
    warmth: adjustments.warmth,
    hue: adjustments.hue,
    grayscale: adjustments.grayscale,
    sepia: adjustments.sepia,
    blur: adjustments.blur,
    grain: adjustments.grain,
  });
  const sanitizeEffects = (effects = DEFAULT_LAYER_EFFECTS) => ({
    rotateX: effects.rotateX,
    rotateY: effects.rotateY,
    perspective: effects.perspective,
    thickness: effects.thickness,
    thicknessColorMode: effects.thicknessColorMode,
    thicknessColor: effects.thicknessColor,
    thicknessGradientColors: [...effects.thicknessGradientColors],
    edgeSoftness: effects.edgeSoftness,
    shadowEnabled: effects.shadowEnabled,
    shadowType: effects.shadowType,
    shadowColor: effects.shadowColor,
    shadowOpacity: effects.shadowOpacity,
    shadowBlur: effects.shadowBlur,
    shadowDistance: effects.shadowDistance,
    shadowAngle: effects.shadowAngle,
    reflectionEnabled: effects.reflectionEnabled,
    reflectionOpacity: effects.reflectionOpacity,
    reflectionDistance: effects.reflectionDistance,
    reflectionBlur: effects.reflectionBlur,
  });
  return {
    width: value.width,
    height: value.height,
    background: {
      mode: value.background.mode,
      color: value.background.color,
      gradientType: value.background.gradientType,
      gradientColors: [...value.background.gradientColors],
      gradientAngle: value.background.gradientAngle,
      ...(value.background.imageSrc ? { imageSrc: value.background.imageSrc } : {}),
      imageFit: value.background.imageFit,
      imageBlur: value.background.imageBlur,
      imageBrightness: value.background.imageBrightness,
      texture: value.background.texture,
      textureColor: value.background.textureColor,
      textureOpacity: value.background.textureOpacity,
      textureScale: value.background.textureScale,
      adjustments: sanitizeAdjustments(value.background.adjustments),
    },
    border: {
      style: value.border.style,
      color: value.border.color,
      width: value.border.width,
      inset: value.border.inset,
      radius: value.border.radius,
      opacity: value.border.opacity,
    },
    layers: value.layers.map((layer): EditorLayer => {
      const base = {
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        opacity: layer.opacity,
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height,
        rotation: layer.rotation,
        ...(layer.flipX !== undefined ? { flipX: layer.flipX } : {}),
        ...(layer.flipY !== undefined ? { flipY: layer.flipY } : {}),
        effects: sanitizeEffects(layer.effects),
      };
      if (layer.type === 'shape') {
        return {
          ...base,
          type: 'shape',
          shape: layer.shape,
          fill: layer.fill,
          stroke: layer.stroke,
          strokeWidth: layer.strokeWidth,
          radius: layer.radius,
          shadowColor: layer.shadowColor,
          shadowBlur: layer.shadowBlur,
        };
      }
      if (layer.type === 'text') {
        return {
          ...base,
          type: 'text',
          text: layer.text,
          color: layer.color,
          fontSize: layer.fontSize,
          fontFamily: layer.fontFamily,
          fontWeight: layer.fontWeight,
          align: layer.align,
          letterSpacing: layer.letterSpacing,
          lineHeight: layer.lineHeight,
          stroke: layer.stroke,
          strokeWidth: layer.strokeWidth,
          shadowColor: layer.shadowColor,
          shadowBlur: layer.shadowBlur,
          ...(layer.characterStyles ? { characterStyles: layer.characterStyles.map((style) => ({
            ...(style.color ? { color: style.color } : {}),
            ...(style.backgroundColor ? { backgroundColor: style.backgroundColor } : {}),
            ...(style.fontSize !== undefined ? { fontSize: style.fontSize } : {}),
            ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
            ...(style.fontWeight !== undefined ? { fontWeight: style.fontWeight } : {}),
            ...(style.fontStyle ? { fontStyle: style.fontStyle } : {}),
            ...(style.underline !== undefined ? { underline: style.underline } : {}),
            ...(style.letterSpacing !== undefined ? { letterSpacing: style.letterSpacing } : {}),
          })) } : {}),
        };
      }
      if (layer.type === 'image') {
        const crop = layer.crop || { x: 0, y: 0, width: 1, height: 1 };
        return {
          ...base,
          type: 'image',
          src: layer.src,
          fit: 'stretch',
          radius: layer.radius,
          stroke: layer.stroke,
          strokeWidth: layer.strokeWidth,
          shadowColor: layer.shadowColor,
          shadowBlur: layer.shadowBlur,
          sourceAspectRatio: layer.sourceAspectRatio || layer.width / layer.height,
          aspectRatioLocked: Boolean(layer.aspectRatioLocked),
          blendMode: layer.blendMode || 'source-over',
          adjustments: sanitizeAdjustments(layer.adjustments),
          cropShape: layer.cropShape || 'rectangle',
          dominantColor: layer.dominantColor || '#596273',
          crop: { x: crop.x, y: crop.y, width: crop.width, height: crop.height },
        };
      }
      if (layer.type === 'paint') {
        return {
          ...base,
          type: 'paint',
          kind: layer.kind,
          texture: layer.texture,
          size: layer.size,
          color: layer.color,
          gradientColors: [...layer.gradientColors],
          spacing: layer.spacing,
          ...(layer.imageSrc ? { imageSrc: layer.imageSrc } : {}),
          emoji: layer.emoji,
          stampOrientation: layer.stampOrientation,
          stampRotation: layer.stampRotation,
          distortWithDirection: layer.distortWithDirection,
          sourceWidth: layer.sourceWidth,
          sourceHeight: layer.sourceHeight,
          points: layer.points.map((point) => ({ x: point.x, y: point.y, angle: point.angle })),
        };
      }
      return {
        ...base,
        type: 'decoration',
        decoration: layer.decoration,
        color: layer.color,
        secondaryColor: layer.secondaryColor,
        strokeWidth: layer.strokeWidth,
      };
    }),
  };
}

export function encodeWallpaperProject(document: WallpaperDocument): Blob {
  if (!isValidWallpaperDocument(document)) throw new Error('当前项目包含无效数据');
  const writer = new BinaryWriter();
  writer.writeValue(document);
  const payload = writer.finish();
  if (payload.length > MAX_PROJECT_BYTES) throw new Error('项目文件超过 200 MB');
  const output = new Uint8Array(HEADER_SIZE + payload.length);
  output.set(MAGIC, 0);
  const header = new DataView(output.buffer);
  header.setUint16(4, FORMAT_VERSION, true);
  header.setUint16(6, 0, true);
  header.setUint32(8, payload.length, true);
  header.setUint32(12, crc32(payload), true);
  output.set(payload, HEADER_SIZE);
  return new Blob([output], { type: 'application/x-little-tree-wallpaper-project' });
}

export async function decodeWallpaperProject(file: File): Promise<WallpaperDocument> {
  if (file.size > MAX_PROJECT_BYTES + HEADER_SIZE) throw new Error('项目文件超过 200 MB');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < HEADER_SIZE || !MAGIC.every((byte, index) => bytes[index] === byte)) {
    throw new Error('不是小树壁纸项目文件');
  }
  const header = new DataView(bytes.buffer, bytes.byteOffset, HEADER_SIZE);
  const version = header.getUint16(4, true);
  if (version !== FORMAT_VERSION && !LEGACY_FORMAT_VERSIONS.includes(version)) throw new Error(`暂不支持项目格式版本 ${version}`);
  const payloadLength = header.getUint32(8, true);
  if (payloadLength !== bytes.length - HEADER_SIZE) throw new Error('项目文件长度校验失败');
  const payload = bytes.subarray(HEADER_SIZE);
  if (crc32(payload) !== header.getUint32(12, true)) throw new Error('项目文件校验失败');
  const reader = new BinaryReader(payload);
  const value = reader.readValue();
  if (reader.remaining !== 0 || !isValidWallpaperDocument(value)) throw new Error('项目内容无效或已损坏');
  return sanitizeWallpaperDocument(value);
}
