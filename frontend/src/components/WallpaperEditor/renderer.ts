import type {
  BrushPoint,
  BrushSettings,
  CropMaskShape,
  DecorationKind,
  EditorLayer,
  ImageLayer,
  Point,
  ShapeKind,
  TextureType,
  WallpaperDocument,
} from './types';
import { DEFAULT_IMAGE_ADJUSTMENTS, DEFAULT_LAYER_EFFECTS } from './types';

export type ImageCache = Map<string, HTMLImageElement>;

function imageFilter(adjustments = DEFAULT_IMAGE_ADJUSTMENTS, extraBlur = 0): string {
  const saturation = Math.max(0, adjustments.saturation + adjustments.vibrance * 0.65);
  return [
    `blur(${Math.max(0, adjustments.blur + extraBlur)}px)`,
    `brightness(${Math.max(0, adjustments.brightness)}%)`,
    `contrast(${Math.max(0, adjustments.contrast)}%)`,
    `saturate(${saturation}%)`,
    `hue-rotate(${adjustments.hue}deg)`,
    `grayscale(${Math.max(0, adjustments.grayscale)}%)`,
    `sepia(${Math.max(0, adjustments.sepia)}%)`,
  ].join(' ');
}

function drawWarmthOverlay(context: CanvasRenderingContext2D, warmth: number, x: number, y: number, width: number, height: number) {
  if (warmth === 0) return;
  context.save();
  context.globalCompositeOperation = 'soft-light';
  context.globalAlpha *= Math.min(0.5, Math.abs(warmth) / 180);
  context.fillStyle = warmth > 0 ? '#FF9A42' : '#4A8DFF';
  context.fillRect(x, y, width, height);
  context.restore();
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.roundRect(x, y, width, height, r);
}

function polygonPath(context: CanvasRenderingContext2D, sides: number, radius: number, rotation = -Math.PI / 2) {
  context.beginPath();
  for (let index = 0; index < sides; index += 1) {
    const angle = rotation + (index * Math.PI * 2) / sides;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
}

function shapePath(context: CanvasRenderingContext2D, shape: ShapeKind, width: number, height: number, radius: number) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  context.beginPath();
  if (shape === 'rectangle') {
    roundedRectPath(context, -halfWidth, -halfHeight, width, height, radius);
  } else if (shape === 'circle') {
    context.ellipse(0, 0, halfWidth, halfHeight, 0, 0, Math.PI * 2);
  } else if (shape === 'triangle') {
    context.moveTo(0, -halfHeight);
    context.lineTo(halfWidth, halfHeight);
    context.lineTo(-halfWidth, halfHeight);
    context.closePath();
  } else if (shape === 'hexagon') {
    context.save();
    context.scale(halfWidth, halfHeight);
    polygonPath(context, 6, 1, 0);
    context.restore();
  } else if (shape === 'star') {
    const outer = Math.min(halfWidth, halfHeight);
    const inner = outer * 0.44;
    for (let index = 0; index < 10; index += 1) {
      const pointRadius = index % 2 === 0 ? outer : inner;
      const angle = -Math.PI / 2 + index * Math.PI / 5;
      const x = Math.cos(angle) * pointRadius;
      const y = Math.sin(angle) * pointRadius;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
  } else {
    context.moveTo(0, halfHeight);
    context.bezierCurveTo(-halfWidth * 1.12, halfHeight * 0.28, -halfWidth * 1.08, -halfHeight * 0.55, -halfWidth * 0.48, -halfHeight * 0.82);
    context.bezierCurveTo(-halfWidth * 0.18, -halfHeight * 0.96, 0, -halfHeight * 0.7, 0, -halfHeight * 0.43);
    context.bezierCurveTo(0, -halfHeight * 0.7, halfWidth * 0.18, -halfHeight * 0.96, halfWidth * 0.48, -halfHeight * 0.82);
    context.bezierCurveTo(halfWidth * 1.08, -halfHeight * 0.55, halfWidth * 1.12, halfHeight * 0.28, 0, halfHeight);
    context.closePath();
  }
}

function appendImageMaskPath(
  context: CanvasRenderingContext2D,
  shape: CropMaskShape,
  left: number,
  top: number,
  width: number,
  height: number,
  radius: number,
) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const centerX = left + halfWidth;
  const centerY = top + halfHeight;
  if (shape === 'circle') {
    const circleRadius = Math.min(halfWidth, halfHeight);
    context.arc(centerX, centerY, circleRadius, 0, Math.PI * 2);
  } else if (shape === 'ellipse') {
    context.ellipse(centerX, centerY, halfWidth, halfHeight, 0, 0, Math.PI * 2);
  } else if (shape === 'triangle') {
    context.moveTo(centerX, top);
    context.lineTo(left + width, top + height);
    context.lineTo(left, top + height);
    context.closePath();
  } else if (shape === 'parallelogram') {
    const offset = width * 0.18;
    context.moveTo(left + offset, top);
    context.lineTo(left + width, top);
    context.lineTo(left + width - offset, top + height);
    context.lineTo(left, top + height);
    context.closePath();
  } else if (shape === 'diamond') {
    context.moveTo(centerX, top);
    context.lineTo(left + width, centerY);
    context.lineTo(centerX, top + height);
    context.lineTo(left, centerY);
    context.closePath();
  } else {
    context.roundRect(left, top, width, height, Math.max(0, Math.min(radius, halfWidth, halfHeight)));
  }
}

function imageMaskPath(context: CanvasRenderingContext2D, layer: ImageLayer) {
  context.beginPath();
  appendImageMaskPath(
    context,
    layer.cropShape || 'rectangle',
    -layer.width / 2,
    -layer.height / 2,
    layer.width,
    layer.height,
    layer.radius,
  );
}

function seededNoise(index: number): number {
  let value = (index + 1) * 16807;
  value = (value ^ (value >>> 13)) * 1274126177;
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function drawTexture(
  context: CanvasRenderingContext2D,
  texture: TextureType,
  color: string,
  opacity: number,
  scale: number,
  width: number,
  height: number,
) {
  if (texture === 'none' || opacity <= 0) return;
  const unit = Math.max(12, scale);
  context.save();
  const textureAlpha = context.globalAlpha * opacity / 100;
  context.globalAlpha = textureAlpha;
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = Math.max(1, unit / 20);

  if (texture === 'grain' || texture === 'paper') {
    const count = Math.min(12000, Math.floor((width * height) / (unit * unit) * (texture === 'paper' ? 11 : 7)));
    for (let index = 0; index < count; index += 1) {
      const x = seededNoise(index * 2) * width;
      const y = seededNoise(index * 2 + 1) * height;
      const size = texture === 'paper' ? seededNoise(index + 5000) * 2.2 + 0.4 : seededNoise(index + 8000) * 1.3 + 0.3;
      context.globalAlpha = textureAlpha * (texture === 'paper' ? 0.3 : 0.55);
      context.fillRect(x, y, size, size);
    }
    if (texture === 'paper') {
      context.globalAlpha = textureAlpha * 0.2;
      for (let y = 0; y < height; y += unit * 0.8) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y + unit * 0.14);
        context.stroke();
      }
    }
  } else if (texture === 'dots') {
    for (let y = unit / 2; y < height; y += unit) {
      for (let x = unit / 2; x < width; x += unit) {
        context.beginPath();
        context.arc(x, y, Math.max(1.5, unit * 0.08), 0, Math.PI * 2);
        context.fill();
      }
    }
  } else if (texture === 'grid') {
    for (let x = 0; x <= width; x += unit) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let y = 0; y <= height; y += unit) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
  } else if (texture === 'diagonal') {
    for (let offset = -height; offset < width + height; offset += unit) {
      context.beginPath();
      context.moveTo(offset, 0);
      context.lineTo(offset - height, height);
      context.stroke();
    }
  } else if (texture === 'waves') {
    for (let y = 0; y < height + unit; y += unit) {
      context.beginPath();
      for (let x = 0; x <= width; x += unit / 4) {
        const py = y + Math.sin((x / unit) * Math.PI * 2) * unit * 0.18;
        if (x === 0) context.moveTo(x, py);
        else context.lineTo(x, py);
      }
      context.stroke();
    }
  }
  context.restore();
}

function drawCoverImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  fit: 'cover' | 'contain' | 'stretch',
  crop?: { x: number; y: number; width: number; height: number },
) {
  const cropX = Math.max(0, Math.min(0.99, crop?.x ?? 0));
  const cropY = Math.max(0, Math.min(0.99, crop?.y ?? 0));
  const cropWidth = Math.max(0.01, Math.min(1 - cropX, crop?.width ?? 1));
  const cropHeight = Math.max(0.01, Math.min(1 - cropY, crop?.height ?? 1));
  const sourceX = image.naturalWidth * cropX;
  const sourceY = image.naturalHeight * cropY;
  const sourceWidth = image.naturalWidth * cropWidth;
  const sourceHeight = image.naturalHeight * cropHeight;
  if (fit === 'stretch') {
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
    return;
  }
  const imageRatio = sourceWidth / sourceHeight;
  const boxRatio = width / height;
  const useWidth = fit === 'cover' ? imageRatio < boxRatio : imageRatio > boxRatio;
  const drawWidth = useWidth ? width : height * imageRatio;
  const drawHeight = useWidth ? width / imageRatio : height;
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function createGradient(context: CanvasRenderingContext2D, document: WallpaperDocument): CanvasGradient {
  const { width, height, background } = document;
  let gradient: CanvasGradient;
  if (background.gradientType === 'radial') {
    gradient = context.createRadialGradient(width * 0.45, height * 0.42, 0, width * 0.5, height * 0.5, Math.max(width, height) * 0.68);
  } else if (background.gradientType === 'conic') {
    gradient = context.createConicGradient((background.gradientAngle * Math.PI) / 180, width / 2, height / 2);
  } else {
    const angle = ((background.gradientAngle - 90) * Math.PI) / 180;
    const length = Math.abs(width * Math.cos(angle)) + Math.abs(height * Math.sin(angle));
    const dx = Math.cos(angle) * length / 2;
    const dy = Math.sin(angle) * length / 2;
    gradient = context.createLinearGradient(width / 2 - dx, height / 2 - dy, width / 2 + dx, height / 2 + dy);
  }
  const colors = background.gradientColors.length >= 2 ? background.gradientColors : ['#111827', '#F9FAFB'];
  colors.forEach((color, index) => gradient.addColorStop(index / (colors.length - 1), color));
  return gradient;
}

function drawBackground(context: CanvasRenderingContext2D, document: WallpaperDocument, cache: ImageCache) {
  const { width, height, background } = document;
  context.fillStyle = background.mode === 'gradient' ? createGradient(context, document) : background.color;
  context.fillRect(0, 0, width, height);
  if (background.mode === 'image' && background.imageSrc) {
    const image = cache.get(background.imageSrc);
    if (image?.complete && image.naturalWidth > 0) {
      const adjustments = background.adjustments || DEFAULT_IMAGE_ADJUSTMENTS;
      context.save();
      context.filter = imageFilter({ ...adjustments, brightness: adjustments.brightness * background.imageBrightness / 100 }, background.imageBlur);
      const bleed = (background.imageBlur + adjustments.blur) * 2;
      drawCoverImage(context, image, -bleed, -bleed, width + bleed * 2, height + bleed * 2, background.imageFit);
      context.restore();
      drawWarmthOverlay(context, adjustments.warmth, 0, 0, width, height);
      drawTexture(context, adjustments.grain > 0 ? 'grain' : 'none', '#FFFFFF', adjustments.grain, 34, width, height);
    }
  }
  drawTexture(context, background.texture, background.textureColor, background.textureOpacity, background.textureScale, width, height);
}

function drawText(context: CanvasRenderingContext2D, layer: Extract<EditorLayer, { type: 'text' }>, fillOverride?: string | CanvasGradient) {
  const lines: Array<Array<{ glyph: string; index: number }>> = [[]];
  Array.from(layer.text).forEach((glyph, index) => {
    if (glyph === '\n') lines.push([]);
    else lines[lines.length - 1].push({ glyph, index });
  });
  const styleFor = (index: number) => ({
    color: layer.characterStyles?.[index]?.color || layer.color,
    backgroundColor: layer.characterStyles?.[index]?.backgroundColor,
    fontSize: layer.characterStyles?.[index]?.fontSize || layer.fontSize,
    fontFamily: layer.characterStyles?.[index]?.fontFamily || layer.fontFamily,
    fontWeight: layer.characterStyles?.[index]?.fontWeight || layer.fontWeight,
    fontStyle: layer.characterStyles?.[index]?.fontStyle || 'normal',
    underline: Boolean(layer.characterStyles?.[index]?.underline),
    letterSpacing: layer.characterStyles?.[index]?.letterSpacing ?? layer.letterSpacing,
  });
  const measured = lines.map((line) => {
    const glyphs = line.map((item) => {
      const style = styleFor(item.index);
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
      return { ...item, style, width: context.measureText(item.glyph).width };
    });
    return {
      glyphs,
      width: glyphs.reduce((sum, item, index) => sum + item.width + (index < glyphs.length - 1 ? item.style.letterSpacing : 0), 0),
      height: Math.max(layer.fontSize, ...glyphs.map((item) => item.style.fontSize)) * layer.lineHeight,
    };
  });
  const totalHeight = measured.reduce((sum, line) => sum + line.height, 0);
  let y = -totalHeight / 2;
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.strokeStyle = layer.stroke;
  context.lineWidth = layer.strokeWidth;
  measured.forEach((line) => {
    const centerY = y + line.height / 2;
    let x = layer.align === 'left' ? -layer.width / 2 : layer.align === 'right' ? layer.width / 2 - line.width : -line.width / 2;
    line.glyphs.forEach((item) => {
      context.font = `${item.style.fontStyle} ${item.style.fontWeight} ${item.style.fontSize}px ${item.style.fontFamily}`;
      if (!fillOverride && item.style.backgroundColor) {
        context.fillStyle = item.style.backgroundColor;
        context.fillRect(x - 1, centerY - item.style.fontSize * 0.58, item.width + item.style.letterSpacing + 2, item.style.fontSize * 1.16);
      }
      context.fillStyle = fillOverride || item.style.color;
      if (!fillOverride && layer.strokeWidth > 0) context.strokeText(item.glyph, x, centerY);
      context.fillText(item.glyph, x, centerY);
      if (!fillOverride && item.style.underline) {
        context.strokeStyle = item.style.color;
        context.lineWidth = Math.max(1, item.style.fontSize / 18);
        context.beginPath();
        context.moveTo(x, centerY + item.style.fontSize * 0.48);
        context.lineTo(x + item.width, centerY + item.style.fontSize * 0.48);
        context.stroke();
        context.strokeStyle = layer.stroke;
        context.lineWidth = layer.strokeWidth;
      }
      x += item.width + item.style.letterSpacing;
    });
    y += line.height;
  });
}

function drawDecoration(context: CanvasRenderingContext2D, decoration: DecorationKind, width: number, height: number, primary: string, secondary: string, strokeWidth: number) {
  context.strokeStyle = primary;
  context.fillStyle = primary;
  context.lineWidth = strokeWidth;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const r = Math.min(width, height) / 2;
  if (decoration === 'sparkle') {
    context.beginPath();
    context.moveTo(0, -height / 2);
    context.bezierCurveTo(r * 0.12, -r * 0.15, r * 0.18, -r * 0.08, width / 2, 0);
    context.bezierCurveTo(r * 0.18, r * 0.08, r * 0.12, r * 0.15, 0, height / 2);
    context.bezierCurveTo(-r * 0.12, r * 0.15, -r * 0.18, r * 0.08, -width / 2, 0);
    context.bezierCurveTo(-r * 0.18, -r * 0.08, -r * 0.12, -r * 0.15, 0, -height / 2);
    context.fill();
  } else if (decoration === 'flower') {
    for (let index = 0; index < 6; index += 1) {
      context.save();
      context.rotate(index * Math.PI / 3);
      context.beginPath();
      context.ellipse(0, -height * 0.24, width * 0.16, height * 0.28, 0, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
    context.fillStyle = secondary;
    context.beginPath();
    context.arc(0, 0, r * 0.22, 0, Math.PI * 2);
    context.fill();
  } else if (decoration === 'leaf') {
    context.beginPath();
    context.moveTo(-width / 2, height / 2);
    context.bezierCurveTo(-width * 0.38, -height * 0.4, width * 0.28, -height * 0.52, width / 2, -height / 2);
    context.bezierCurveTo(width * 0.4, height * 0.18, width * 0.08, height * 0.42, -width / 2, height / 2);
    context.fill();
    context.strokeStyle = secondary;
    context.beginPath();
    context.moveTo(-width * 0.34, height * 0.34);
    context.lineTo(width * 0.34, -height * 0.34);
    context.stroke();
  } else if (decoration === 'orbit') {
    context.beginPath();
    context.ellipse(0, 0, width * 0.45, height * 0.22, -0.35, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = secondary;
    context.beginPath();
    context.arc(0, 0, r * 0.22, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = primary;
    context.beginPath();
    context.arc(width * 0.34, -height * 0.18, r * 0.09, 0, Math.PI * 2);
    context.fill();
  } else if (decoration === 'rainbow') {
    const colors = [primary, secondary, primary];
    colors.forEach((color, index) => {
      context.strokeStyle = color;
      context.lineWidth = Math.max(strokeWidth, height * 0.12);
      context.beginPath();
      context.arc(0, height * 0.34, width * (0.42 - index * 0.1), Math.PI, 0);
      context.stroke();
    });
  } else {
    context.fillStyle = primary;
    roundedRectPath(context, -width / 2, -height / 2, width, height, height * 0.12);
    context.fill();
    context.save();
    roundedRectPath(context, -width / 2, -height / 2, width, height, height * 0.12);
    context.clip();
    context.globalAlpha *= 0.35;
    context.strokeStyle = secondary;
    for (let x = -width * 0.65; x < width * 0.65; x += width * 0.16) {
      context.beginPath();
      context.moveTo(x, -height / 2);
      context.lineTo(x + height, height / 2);
      context.stroke();
    }
    context.restore();
  }
}

function sampleStampPoints(points: BrushPoint[], step: number): BrushPoint[] {
  if (points.length <= 1) return points;
  const sampled: BrushPoint[] = [points[0]];
  let remaining = Math.max(2, step);
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    if (distance <= 0) continue;
    let cursor = remaining;
    while (cursor <= distance) {
      const progress = cursor / distance;
      sampled.push({
        x: start.x + (end.x - start.x) * progress,
        y: start.y + (end.y - start.y) * progress,
        angle: Math.atan2(end.y - start.y, end.x - start.x),
      });
      cursor += step;
    }
    remaining = cursor - distance;
  }
  return sampled;
}

function brushPaint(context: CanvasRenderingContext2D, points: BrushPoint[], settings: BrushSettings): string | CanvasGradient {
  if (settings.kind !== 'gradient' || settings.gradientColors.length < 2) return settings.color;
  let minX = points[0].x;
  let maxX = points[0].x;
  points.forEach((point) => {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
  });
  const gradient = context.createLinearGradient(minX, 0, Math.max(minX + 1, maxX), 0);
  settings.gradientColors.forEach((color, index) => gradient.addColorStop(index / (settings.gradientColors.length - 1), color));
  return gradient;
}

export function drawBrushStroke(
  context: CanvasRenderingContext2D,
  points: BrushPoint[],
  settings: BrushSettings,
  cache: ImageCache,
) {
  if (points.length === 0) return;
  context.save();
  context.globalAlpha *= settings.opacity / 100;
  if (settings.kind === 'solid' || settings.kind === 'gradient') {
    const paint = brushPaint(context, points, settings);
    if (settings.texture === 'spray') {
      context.fillStyle = paint;
      const sampled = sampleStampPoints(points, Math.max(2, settings.size * 0.12));
      sampled.forEach((point, pointIndex) => {
        for (let dot = 0; dot < 14; dot += 1) {
          const seed = pointIndex * 19 + dot;
          const angle = seededNoise(seed) * Math.PI * 2;
          const radius = Math.sqrt(seededNoise(seed + 7000)) * settings.size * 0.52;
          const dotSize = Math.max(0.7, seededNoise(seed + 14000) * settings.size * 0.055);
          context.beginPath();
          context.arc(point.x + Math.cos(angle) * radius, point.y + Math.sin(angle) * radius, dotSize, 0, Math.PI * 2);
          context.fill();
        }
      });
    } else if (settings.texture === 'chalk') {
      context.strokeStyle = paint;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      for (let pass = 0; pass < 7; pass += 1) {
        context.globalAlpha = settings.opacity / 100 * (0.1 + seededNoise(pass + 300) * 0.08);
        context.lineWidth = settings.size * (0.55 + seededNoise(pass + 900) * 0.4);
        const offsetX = (seededNoise(pass + 1200) - 0.5) * settings.size * 0.22;
        const offsetY = (seededNoise(pass + 1800) - 0.5) * settings.size * 0.22;
        context.beginPath();
        points.forEach((point, index) => index === 0 ? context.moveTo(point.x + offsetX, point.y + offsetY) : context.lineTo(point.x + offsetX, point.y + offsetY));
        context.stroke();
      }
    } else {
      context.strokeStyle = paint;
      context.fillStyle = paint;
      context.lineWidth = settings.size;
      context.lineCap = settings.texture === 'marker' ? 'square' : 'round';
      context.lineJoin = 'round';
      if (settings.texture === 'marker') context.globalAlpha *= 0.72;
      if (points.length === 1) {
        context.beginPath();
        context.arc(points[0].x, points[0].y, settings.size / 2, 0, Math.PI * 2);
        context.fill();
      } else {
        context.beginPath();
        points.forEach((point, index) => index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y));
        context.stroke();
      }
    }
  } else {
    const stamps = sampleStampPoints(points, settings.size * Math.max(0.08, settings.spacing / 100));
    const image = settings.imageSrc ? cache.get(settings.imageSrc) : undefined;
    stamps.forEach((point) => {
      context.save();
      context.translate(point.x, point.y);
      const rotation = (settings.stampRotation * Math.PI) / 180 + (settings.stampOrientation === 'follow' ? point.angle : 0);
      context.rotate(rotation);
      if (settings.distortWithDirection) context.transform(1.22, 0, Math.sin(point.angle) * 0.28, 0.82, 0, 0);
      if (settings.kind === 'image' && image?.complete && image.naturalWidth > 0) {
        const ratio = image.naturalWidth / image.naturalHeight;
        const width = ratio >= 1 ? settings.size : settings.size * ratio;
        const height = ratio >= 1 ? settings.size / ratio : settings.size;
        context.drawImage(image, -width / 2, -height / 2, width, height);
      } else if (settings.kind === 'emoji') {
        context.font = `${settings.size}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(settings.emoji || '✨', 0, 0);
      }
      context.restore();
    });
  }
  context.restore();
}

function drawLayerContent(context: CanvasRenderingContext2D, layer: EditorLayer, cache: ImageCache, softness = 0) {
  if (layer.type !== 'image' && softness > 0) context.filter = `blur(${softness}px)`;
  if (layer.type === 'shape') {
    shapePath(context, layer.shape, layer.width, layer.height, layer.radius);
    context.fillStyle = layer.fill;
    context.fill();
    if (layer.strokeWidth > 0) {
      context.strokeStyle = layer.stroke;
      context.lineWidth = layer.strokeWidth;
      context.stroke();
    }
  } else if (layer.type === 'text') {
    drawText(context, layer);
  } else if (layer.type === 'decoration') {
    drawDecoration(context, layer.decoration, layer.width, layer.height, layer.color, layer.secondaryColor, layer.strokeWidth);
  } else if (layer.type === 'paint') {
    drawBrushStroke(context, layer.points, layer, cache);
  } else {
    const image = cache.get(layer.src);
    const adjustments = layer.adjustments || DEFAULT_IMAGE_ADJUSTMENTS;
    const effects = layer.effects || DEFAULT_LAYER_EFFECTS;
    imageMaskPath(context, layer);
    context.fillStyle = effects.shadowEnabled && effects.shadowType === 'outer'
      ? shadowColor(effects.shadowColor, Math.max(18, effects.shadowOpacity))
      : 'rgba(0,0,0,0.01)';
    context.fill();
    context.shadowColor = 'transparent';
    context.save();
    imageMaskPath(context, layer);
    context.clip();
    context.filter = imageFilter(adjustments, softness);
    if (image?.complete && image.naturalWidth > 0) drawCoverImage(context, image, -layer.width / 2, -layer.height / 2, layer.width, layer.height, 'stretch', layer.crop);
    else {
      context.fillStyle = '#D1D5DB';
      context.fillRect(-layer.width / 2, -layer.height / 2, layer.width, layer.height);
    }
    context.filter = 'none';
    drawWarmthOverlay(context, adjustments.warmth, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
    if (adjustments.grain > 0) {
      context.save();
      context.translate(-layer.width / 2, -layer.height / 2);
      drawTexture(context, 'grain', '#FFFFFF', adjustments.grain, 28, layer.width, layer.height);
      context.restore();
    }
    context.restore();
    if (layer.strokeWidth > 0) {
      context.strokeStyle = layer.stroke;
      context.lineWidth = layer.strokeWidth;
      imageMaskPath(context, layer);
      context.stroke();
    }
  }
}

function shadowColor(color: string, opacity: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const value = Number.parseInt(match[1], 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${Math.max(0, Math.min(1, opacity / 100))})`;
}

function drawInnerShadow(context: CanvasRenderingContext2D, layer: EditorLayer) {
  const effects = layer.effects || DEFAULT_LAYER_EFFECTS;
  if (!effects.shadowEnabled || effects.shadowType !== 'inner') return;
  const angle = effects.shadowAngle * Math.PI / 180;
  context.save();
  if (layer.type === 'shape') shapePath(context, layer.shape, layer.width, layer.height, layer.radius);
  else if (layer.type === 'image') imageMaskPath(context, layer);
  else roundedRectPath(context, -layer.width / 2, -layer.height / 2, layer.width, layer.height, 0);
  context.clip();
  context.shadowColor = shadowColor(effects.shadowColor, effects.shadowOpacity);
  context.shadowBlur = effects.shadowBlur;
  context.shadowOffsetX = Math.cos(angle) * effects.shadowDistance;
  context.shadowOffsetY = Math.sin(angle) * effects.shadowDistance;
  context.strokeStyle = 'rgba(0,0,0,0.01)';
  context.lineWidth = Math.max(2, effects.shadowBlur * 1.5);
  if (layer.type === 'shape') shapePath(context, layer.shape, layer.width, layer.height, layer.radius);
  else if (layer.type === 'image') imageMaskPath(context, layer);
  else roundedRectPath(context, -layer.width / 2, -layer.height / 2, layer.width, layer.height, 0);
  context.stroke();
  context.restore();
}

function applyLayerTransform(context: CanvasRenderingContext2D, layer: EditorLayer) {
  const effects = layer.effects || DEFAULT_LAYER_EFFECTS;
  context.translate(layer.x, layer.y);
  context.rotate((layer.rotation * Math.PI) / 180);
  context.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
  const rotateX = effects.rotateX * Math.PI / 180;
  const rotateY = effects.rotateY * Math.PI / 180;
  const depth = effects.perspective / 100;
  context.transform(
    Math.max(0.12, Math.cos(rotateY)),
    -Math.sin(rotateX) * Math.sin(rotateY) * depth,
    Math.sin(rotateY) * depth,
    Math.max(0.12, Math.cos(rotateX)),
    0,
    0,
  );
}

function automaticEdgeColor(layer: EditorLayer): string {
  if (layer.type === 'shape') return layer.strokeWidth > 0 ? layer.stroke : layer.fill;
  if (layer.type === 'image') return layer.strokeWidth > 0 ? layer.stroke : layer.dominantColor || '#596273';
  if (layer.type === 'text') return layer.strokeWidth > 0 ? layer.stroke : layer.color;
  if (layer.type === 'decoration') return layer.color;
  return layer.color;
}

function drawThicknessSilhouette(context: CanvasRenderingContext2D, layer: EditorLayer, paint: string | CanvasGradient, cache: ImageCache) {
  context.fillStyle = paint;
  if (layer.type === 'shape') {
    shapePath(context, layer.shape, layer.width, layer.height, layer.radius);
    context.fill();
  } else if (layer.type === 'image') {
    imageMaskPath(context, layer);
    context.fill();
  } else if (layer.type === 'text') {
    drawText(context, layer, paint);
  } else if (layer.type === 'decoration') {
    const color = typeof paint === 'string' ? paint : layer.color;
    drawDecoration(context, layer.decoration, layer.width, layer.height, color, color, layer.strokeWidth);
  } else {
    roundedRectPath(context, -layer.sourceWidth / 2, -layer.sourceHeight / 2, layer.sourceWidth, layer.sourceHeight, layer.size / 2);
    context.fill();
  }
  void cache;
}

function drawLayerThickness(context: CanvasRenderingContext2D, layer: EditorLayer, cache: ImageCache) {
  const effects = layer.effects || DEFAULT_LAYER_EFFECTS;
  if (effects.thickness <= 0) return;
  const directionX = Math.abs(effects.rotateY) > 1 ? -Math.sign(effects.rotateY) : 0.72;
  const directionY = Math.abs(effects.rotateX) > 1 ? Math.sign(effects.rotateX) : 0.42;
  let paint: string | CanvasGradient = effects.thicknessColorMode === 'auto' ? automaticEdgeColor(layer) : effects.thicknessColor;
  if (effects.thicknessColorMode === 'gradient' && effects.thicknessGradientColors.length >= 2) {
    const gradient = context.createLinearGradient(0, 0, directionX * effects.thickness, directionY * effects.thickness);
    effects.thicknessGradientColors.forEach((color, index) => gradient.addColorStop(index / (effects.thicknessGradientColors.length - 1), color));
    paint = gradient;
  }
  const step = Math.max(1, effects.thickness / 48);
  for (let depth = effects.thickness; depth > 0; depth -= step) {
    context.save();
    context.translate(directionX * depth, directionY * depth);
    drawThicknessSilhouette(context, layer, paint, cache);
    context.restore();
  }
}

function drawLayer(context: CanvasRenderingContext2D, layer: EditorLayer, cache: ImageCache) {
  if (!layer.visible) return;
  const effects = layer.effects || DEFAULT_LAYER_EFFECTS;
  context.save();
  context.globalAlpha = layer.type === 'paint' ? 1 : layer.opacity / 100;
  context.globalCompositeOperation = layer.type === 'image' ? layer.blendMode || 'source-over' : 'source-over';
  applyLayerTransform(context, layer);
  if (layer.type === 'paint') context.scale(layer.width / layer.sourceWidth, layer.height / layer.sourceHeight);

  drawLayerThickness(context, layer, cache);

  if (effects.reflectionEnabled) {
    const localHeight = layer.type === 'paint' ? layer.sourceHeight : layer.height;
    context.save();
    context.translate(0, localHeight + effects.reflectionDistance);
    context.scale(1, -1);
    context.globalAlpha *= effects.reflectionOpacity / 100;
    drawLayerContent(context, layer, cache, effects.edgeSoftness + effects.reflectionBlur);
    context.restore();
  }

  if (effects.shadowEnabled && effects.shadowType === 'outer') {
    const angle = effects.shadowAngle * Math.PI / 180;
    context.shadowColor = shadowColor(effects.shadowColor, effects.shadowOpacity);
    context.shadowBlur = effects.shadowBlur;
    context.shadowOffsetX = Math.cos(angle) * effects.shadowDistance;
    context.shadowOffsetY = Math.sin(angle) * effects.shadowDistance;
  }
  drawLayerContent(context, layer, cache, effects.edgeSoftness);
  context.shadowColor = 'transparent';
  drawInnerShadow(context, layer);
  context.restore();
}

function drawBorder(context: CanvasRenderingContext2D, document: WallpaperDocument) {
  const { border, width, height } = document;
  if (border.style === 'none' || border.width <= 0) return;
  const inset = border.inset + border.width / 2;
  const boxWidth = width - inset * 2;
  const boxHeight = height - inset * 2;
  context.save();
  context.globalAlpha = border.opacity / 100;
  context.strokeStyle = border.color;
  context.fillStyle = border.color;
  context.lineWidth = border.width;
  if (border.style === 'dashed') context.setLineDash([border.width * 2.2, border.width * 1.45]);
  if (border.style === 'film') {
    const holeWidth = border.width * 1.25;
    const gap = holeWidth * 1.7;
    for (let x = border.inset; x < width - border.inset - holeWidth; x += gap) {
      roundedRectPath(context, x, border.inset, holeWidth, border.width * 0.68, border.width * 0.12);
      context.fill();
      roundedRectPath(context, x, height - border.inset - border.width * 0.68, holeWidth, border.width * 0.68, border.width * 0.12);
      context.fill();
    }
  } else if (border.style === 'corners') {
    const length = Math.min(width, height) * 0.12;
    const left = border.inset;
    const right = width - border.inset;
    const top = border.inset;
    const bottom = height - border.inset;
    context.beginPath();
    context.moveTo(left, top + length); context.lineTo(left, top); context.lineTo(left + length, top);
    context.moveTo(right - length, top); context.lineTo(right, top); context.lineTo(right, top + length);
    context.moveTo(right, bottom - length); context.lineTo(right, bottom); context.lineTo(right - length, bottom);
    context.moveTo(left + length, bottom); context.lineTo(left, bottom); context.lineTo(left, bottom - length);
    context.stroke();
  } else {
    roundedRectPath(context, inset, inset, boxWidth, boxHeight, border.radius);
    context.stroke();
    if (border.style === 'double') {
      const secondaryInset = inset + border.width * 1.8;
      context.lineWidth = Math.max(2, border.width * 0.36);
      roundedRectPath(context, secondaryInset, secondaryInset, width - secondaryInset * 2, height - secondaryInset * 2, border.radius);
      context.stroke();
    }
  }
  context.restore();
}

export function renderWallpaper(context: CanvasRenderingContext2D, document: WallpaperDocument, cache: ImageCache) {
  context.clearRect(0, 0, document.width, document.height);
  drawBackground(context, document, cache);
  document.layers.forEach((layer) => drawLayer(context, layer, cache));
  drawBorder(context, document);
}

export function inverseRotatePoint(point: Point, layer: EditorLayer): Point {
  const angle = (-layer.rotation * Math.PI) / 180;
  const dx = point.x - layer.x;
  const dy = point.y - layer.y;
  const rotatedX = dx * Math.cos(angle) - dy * Math.sin(angle);
  const rotatedY = dx * Math.sin(angle) + dy * Math.cos(angle);
  const effects = layer.effects || DEFAULT_LAYER_EFFECTS;
  const rotateX = effects.rotateX * Math.PI / 180;
  const rotateY = effects.rotateY * Math.PI / 180;
  const depth = effects.perspective / 100;
  const a = Math.max(0.12, Math.cos(rotateY));
  const b = -Math.sin(rotateX) * Math.sin(rotateY) * depth;
  const c = Math.sin(rotateY) * depth;
  const d = Math.max(0.12, Math.cos(rotateX));
  const determinant = a * d - b * c || 1;
  return {
    x: (layer.flipX ? -1 : 1) * (d * rotatedX - c * rotatedY) / determinant,
    y: (layer.flipY ? -1 : 1) * (-b * rotatedX + a * rotatedY) / determinant,
  };
}

export function layerContainsPoint(layer: EditorLayer, point: Point): boolean {
  const local = inverseRotatePoint(point, layer);
  if (layer.type === 'paint') {
    const sourcePoint = {
      x: local.x * layer.sourceWidth / layer.width,
      y: local.y * layer.sourceHeight / layer.height,
    };
    const threshold = layer.size * 0.65;
    if (layer.points.length === 1) return Math.hypot(sourcePoint.x - layer.points[0].x, sourcePoint.y - layer.points[0].y) <= threshold;
    for (let index = 1; index < layer.points.length; index += 1) {
      const start = layer.points[index - 1];
      const end = layer.points[index];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const lengthSquared = dx * dx + dy * dy;
      const progress = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((sourcePoint.x - start.x) * dx + (sourcePoint.y - start.y) * dy) / lengthSquared));
      const nearestX = start.x + dx * progress;
      const nearestY = start.y + dy * progress;
      if (Math.hypot(sourcePoint.x - nearestX, sourcePoint.y - nearestY) <= threshold) return true;
    }
    return false;
  }
  return Math.abs(local.x) <= layer.width / 2 && Math.abs(local.y) <= layer.height / 2;
}

export function layerCorner(layer: EditorLayer, horizontal: -1 | 1, vertical: -1 | 1): Point {
  return layerLocalToWorld(layer, { x: horizontal * layer.width / 2, y: vertical * layer.height / 2 });
}

export function layerLocalToWorld(layer: EditorLayer, point: Point): Point {
  const effects = layer.effects || DEFAULT_LAYER_EFFECTS;
  const rotateX = effects.rotateX * Math.PI / 180;
  const rotateY = effects.rotateY * Math.PI / 180;
  const depth = effects.perspective / 100;
  const x = point.x * (layer.flipX ? -1 : 1);
  const y = point.y * (layer.flipY ? -1 : 1);
  const transformedX = Math.max(0.12, Math.cos(rotateY)) * x + Math.sin(rotateY) * depth * y;
  const transformedY = -Math.sin(rotateX) * Math.sin(rotateY) * depth * x + Math.max(0.12, Math.cos(rotateX)) * y;
  const angle = (layer.rotation * Math.PI) / 180;
  return {
    x: layer.x + transformedX * Math.cos(angle) - transformedY * Math.sin(angle),
    y: layer.y + transformedX * Math.sin(angle) + transformedY * Math.cos(angle),
  };
}

export function rectangleRadiusInset(layer: EditorLayer, displayScale: number): number {
  if (layer.type !== 'shape' || layer.shape !== 'rectangle') return 0;
  return Math.min(layer.width / 2, Math.max(layer.radius, 28 / displayScale));
}

export function drawSnapGuides(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  guides: { x?: number; y?: number },
  displayScale: number,
) {
  if (guides.x === undefined && guides.y === undefined) return;
  context.save();
  context.strokeStyle = '#F59E0B';
  context.lineWidth = Math.max(0.25, 1.25 / displayScale);
  context.setLineDash([7 / displayScale, 4 / displayScale]);
  if (guides.x !== undefined) {
    context.beginPath();
    context.moveTo(guides.x, 0);
    context.lineTo(guides.x, height);
    context.stroke();
  }
  if (guides.y !== undefined) {
    context.beginPath();
    context.moveTo(0, guides.y);
    context.lineTo(width, guides.y);
    context.stroke();
  }
  context.restore();
}

export function drawImageCropOverlay(
  context: CanvasRenderingContext2D,
  layer: ImageLayer,
  cache: ImageCache,
  displayScale: number,
) {
  const image = cache.get(layer.src);
  if (!image?.complete || image.naturalWidth <= 0) return;
  const crop = layer.crop || { x: 0, y: 0, width: 1, height: 1 };
  const left = -layer.width / 2 + crop.x * layer.width;
  const top = -layer.height / 2 + crop.y * layer.height;
  const width = crop.width * layer.width;
  const height = crop.height * layer.height;
  const handleRadius = Math.max(1, 6 / displayScale);
  const cropShape = layer.cropShape || 'rectangle';
  context.save();
  applyLayerTransform(context, layer);
  context.beginPath();
  context.rect(-layer.width / 2, -layer.height / 2, layer.width, layer.height);
  context.clip();
  context.globalAlpha = layer.opacity / 100;
  context.filter = imageFilter(layer.adjustments || DEFAULT_IMAGE_ADJUSTMENTS);
  context.drawImage(image, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
  context.filter = 'none';
  context.globalAlpha = 1;
  context.beginPath();
  context.rect(-layer.width / 2, -layer.height / 2, layer.width, layer.height);
  appendImageMaskPath(context, cropShape, left, top, width, height, layer.radius);
  context.fillStyle = 'rgba(0,0,0,0.58)';
  context.fill('evenodd');
  context.strokeStyle = '#FFFFFF';
  context.lineWidth = Math.max(0.25, 1.5 / displayScale);
  context.setLineDash([6 / displayScale, 4 / displayScale]);
  context.beginPath();
  appendImageMaskPath(context, cropShape, left, top, width, height, layer.radius);
  context.stroke();
  context.setLineDash([]);
  context.save();
  context.beginPath();
  appendImageMaskPath(context, cropShape, left, top, width, height, layer.radius);
  context.clip();
  context.globalAlpha = 0.55;
  for (let index = 1; index < 3; index += 1) {
    context.beginPath();
    context.moveTo(left + width * index / 3, top);
    context.lineTo(left + width * index / 3, top + height);
    context.moveTo(left, top + height * index / 3);
    context.lineTo(left + width, top + height * index / 3);
    context.stroke();
  }
  context.restore();
  context.globalAlpha = 1;
  context.fillStyle = '#FFFFFF';
  context.strokeStyle = '#2563EB';
  [[left, top], [left + width, top], [left + width, top + height], [left, top + height]].forEach(([x, y]) => {
    context.beginPath();
    context.arc(x, y, handleRadius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  });
  context.restore();
}

export function drawSelection(context: CanvasRenderingContext2D, layer: EditorLayer, displayScale: number) {
  if (!layer.visible) return;
  const lineWidth = Math.max(0.25, 1.5 / displayScale);
  const radius = Math.max(1, 6 / displayScale);
  const rotateDistance = Math.max(4, 28 / displayScale);
  context.save();
  applyLayerTransform(context, layer);
  context.strokeStyle = '#3B82F6';
  context.fillStyle = '#FFFFFF';
  context.lineWidth = lineWidth;
  context.setLineDash([6 / displayScale, 4 / displayScale]);
  context.strokeRect(-layer.width / 2, -layer.height / 2, layer.width, layer.height);
  context.setLineDash([]);
  const points: Point[] = [
    { x: -layer.width / 2, y: -layer.height / 2 },
    { x: layer.width / 2, y: -layer.height / 2 },
    { x: layer.width / 2, y: layer.height / 2 },
    { x: -layer.width / 2, y: layer.height / 2 },
  ];
  points.forEach((point) => {
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  });
  context.beginPath();
  context.moveTo(0, -layer.height / 2);
  context.lineTo(0, -layer.height / 2 - rotateDistance);
  context.stroke();
  context.beginPath();
  context.arc(0, -layer.height / 2 - rotateDistance, radius, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  if (layer.type === 'shape' && layer.shape === 'rectangle') {
    context.fillStyle = '#F59E0B';
    context.strokeStyle = '#FFFFFF';
    context.beginPath();
    context.arc(layer.width / 2 - rectangleRadiusInset(layer, displayScale), -layer.height / 2, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
  context.restore();
}
