import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import {
  drawSelection,
  drawBrushStroke,
  drawImageCropOverlay,
  drawSnapGuides,
  inverseRotatePoint,
  layerContainsPoint,
  layerCorner,
  layerLocalToWorld,
  rectangleRadiusInset,
  renderWallpaper,
} from './renderer';
import type {
  CanvasHandle,
  CanvasInteraction,
  BrushPoint,
  BrushSettings,
  EditorLayer,
  ImageLayer,
  Point,
  WallpaperDocument,
} from './types';

export interface EditorCanvasHandle {
  exportBlob: (type: 'image/png' | 'image/jpeg', quality?: number) => Promise<Blob>;
}

interface EditorCanvasProps {
  document: WallpaperDocument;
  selectedId: string | null;
  zoom: number;
  showGrid: boolean;
  snapToGuides: boolean;
  isPanningMode: boolean;
  canvasTool: 'move' | 'hand' | 'brush';
  brushSettings: BrushSettings;
  cropEditingId: string | null;
  onSelect: (id: string | null) => void;
  onOpenProperties: (id: string) => void;
  onLayerClick: (id: string | null, bounds: { left: number; top: number; right: number; bottom: number } | null) => void;
  onLayerInteractionStart: () => void;
  onDuplicateForDrag: (layer: EditorLayer) => EditorLayer;
  onCommitBrushStroke: (points: BrushPoint[], settings: BrushSettings) => void;
  onLiveCropChange: (id: string, crop: NonNullable<ImageLayer['crop']>) => void;
  onCommitCrop: (id: string, original: NonNullable<ImageLayer['crop']>) => void;
  onLiveLayerChange: (layer: EditorLayer) => void;
  onCommitInteraction: (original: EditorLayer, duplicated?: boolean) => void;
}

function pointDistance(first: Point, second: Point): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function rotatePoint(local: Point, layer: EditorLayer): Point {
  return layerLocalToWorld(layer, local);
}

function findHandle(layer: EditorLayer, point: Point, scale: number): CanvasHandle | null {
  const threshold = 12 / scale;
  if (layer.type === 'shape' && layer.shape === 'rectangle') {
    const radiusHandle = rotatePoint({ x: layer.width / 2 - rectangleRadiusInset(layer, scale), y: -layer.height / 2 }, layer);
    if (pointDistance(radiusHandle, point) <= threshold) return 'radius';
  }
  const corners: Array<{ handle: CanvasHandle; point: Point }> = [
    { handle: 'nw', point: layerCorner(layer, -1, -1) },
    { handle: 'ne', point: layerCorner(layer, 1, -1) },
    { handle: 'se', point: layerCorner(layer, 1, 1) },
    { handle: 'sw', point: layerCorner(layer, -1, 1) },
  ];
  const corner = corners.find((item) => pointDistance(item.point, point) <= threshold);
  if (corner) return corner.handle;
  const rotate = rotatePoint({ x: 0, y: -layer.height / 2 - 28 / scale }, layer);
  if (pointDistance(rotate, point) <= threshold) return 'rotate';
  return layerContainsPoint(layer, point) ? 'move' : null;
}

const EditorCanvas = forwardRef<EditorCanvasHandle, EditorCanvasProps>(function EditorCanvas({
  document,
  selectedId,
  zoom,
  showGrid,
  snapToGuides,
  isPanningMode,
  canvasTool,
  brushSettings,
  cropEditingId,
  onSelect,
  onOpenProperties,
  onLayerClick,
  onLayerInteractionStart,
  onDuplicateForDrag,
  onCommitBrushStroke,
  onLiveCropChange,
  onCommitCrop,
  onLiveLayerChange,
  onCommitInteraction,
}, forwardedRef) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const imageCacheRef = useRef(new Map<string, HTMLImageElement>());
  const interactionRef = useRef<CanvasInteraction | null>(null);
  const latestInteractionLayerRef = useRef<EditorLayer | null>(null);
  const clickCandidateRef = useRef<{ layer: EditorLayer; clientX: number; clientY: number } | null>(null);
  const brushPointsRef = useRef<BrushPoint[] | null>(null);
  const brushFrameRef = useRef<number | null>(null);
  const cropInteractionRef = useRef<{
    pointerId: number;
    handle: 'move' | 'nw' | 'ne' | 'se' | 'sw';
    start: Point;
    original: NonNullable<ImageLayer['crop']>;
    layer: ImageLayer;
  } | null>(null);
  const [imageRevision, setImageRevision] = useState(0);
  const [snapGuides, setSnapGuides] = useState<{ x?: number; y?: number }>({});
  const displayScale = zoom / 100;
  const selectedLayer = document.layers.find((layer) => layer.id === selectedId) || null;
  const cropLayer = document.layers.find((layer): layer is ImageLayer => layer.id === cropEditingId && layer.type === 'image') || null;

  const renderOverlay = () => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    if (canvas.width !== document.width) canvas.width = document.width;
    if (canvas.height !== document.height) canvas.height = document.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, document.width, document.height);
    if (showGrid) {
      context.save();
      context.strokeStyle = 'rgba(255,255,255,0.3)';
      context.lineWidth = Math.max(1, 1 / displayScale);
      context.setLineDash([5 / displayScale, 5 / displayScale]);
      for (let index = 1; index < 12; index += 1) {
        const x = document.width * index / 12;
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, document.height);
        context.stroke();
      }
      for (let index = 1; index < 8; index += 1) {
        const y = document.height * index / 8;
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(document.width, y);
        context.stroke();
      }
      context.restore();
    }
    if (brushPointsRef.current?.length) drawBrushStroke(context, brushPointsRef.current, brushSettings, imageCacheRef.current);
    drawSnapGuides(context, document.width, document.height, snapGuides, displayScale);
    if (cropLayer) drawImageCropOverlay(context, cropLayer, imageCacheRef.current, displayScale);
    else if (selectedLayer) drawSelection(context, selectedLayer, displayScale);
  };

  useEffect(() => {
    const sources = [
      document.background.imageSrc,
      ...document.layers.filter((layer) => layer.type === 'image').map((layer) => layer.src),
      ...document.layers.flatMap((layer) => layer.type === 'paint' && layer.kind === 'image' ? [layer.imageSrc] : []),
      brushSettings.kind === 'image' ? brushSettings.imageSrc : undefined,
    ].filter((source): source is string => Boolean(source));

    sources.forEach((source) => {
      if (imageCacheRef.current.has(source)) return;
      const image = new Image();
      image.onload = () => setImageRevision((revision) => revision + 1);
      image.onerror = () => {
        imageCacheRef.current.delete(source);
        setImageRevision((revision) => revision + 1);
      };
      image.src = source;
      imageCacheRef.current.set(source, image);
    });
  }, [brushSettings.imageSrc, brushSettings.kind, document.background.imageSrc, document.layers]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== document.width) canvas.width = document.width;
    if (canvas.height !== document.height) canvas.height = document.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    renderWallpaper(context, document, imageCacheRef.current);
  }, [document, imageRevision]);

  useEffect(() => {
    renderOverlay();
  }, [brushSettings, cropLayer, displayScale, document.height, document.width, imageRevision, selectedLayer, showGrid, snapGuides]);

  useEffect(() => () => {
    if (brushFrameRef.current !== null) window.cancelAnimationFrame(brushFrameRef.current);
  }, []);

  useImperativeHandle(forwardedRef, () => ({
    exportBlob: async (type, quality) => {
      const sources = [
        document.background.imageSrc,
        ...document.layers.filter((layer) => layer.type === 'image').map((layer) => layer.src),
        ...document.layers.flatMap((layer) => layer.type === 'paint' && layer.kind === 'image' ? [layer.imageSrc] : []),
      ].filter((source): source is string => Boolean(source));
      await Promise.all(sources.map(async (source) => {
        let image = imageCacheRef.current.get(source);
        if (!image) {
          image = new Image();
          image.src = source;
          imageCacheRef.current.set(source, image);
        }
        if (image.complete) {
          if (image.naturalWidth <= 0) throw new Error('项目中的图片无法读取');
          return;
        }
        await new Promise<void>((resolve, reject) => {
          image!.addEventListener('load', () => resolve(), { once: true });
          image!.addEventListener('error', () => reject(new Error('项目中的图片加载失败')), { once: true });
        });
      }));
      const exportCanvas = window.document.createElement('canvas');
      exportCanvas.width = document.width;
      exportCanvas.height = document.height;
      const context = exportCanvas.getContext('2d');
      if (!context) throw new Error('无法创建导出画布');
      renderWallpaper(context, document, imageCacheRef.current);
      return new Promise<Blob>((resolve, reject) => {
        exportCanvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('图片编码失败'));
        }, type, quality);
      });
    },
  }), [document]);

  const toCanvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * document.width / bounds.width,
      y: (event.clientY - bounds.top) * document.height / bounds.height,
    };
  };

  const getLayerClientBounds = (layer: EditorLayer, canvas: HTMLCanvasElement) => {
    const canvasBounds = canvas.getBoundingClientRect();
    const corners = [
      layerLocalToWorld(layer, { x: -layer.width / 2, y: -layer.height / 2 }),
      layerLocalToWorld(layer, { x: layer.width / 2, y: -layer.height / 2 }),
      layerLocalToWorld(layer, { x: layer.width / 2, y: layer.height / 2 }),
      layerLocalToWorld(layer, { x: -layer.width / 2, y: layer.height / 2 }),
    ];
    const clientXs = corners.map((point) => canvasBounds.left + point.x / document.width * canvasBounds.width);
    const clientYs = corners.map((point) => canvasBounds.top + point.y / document.height * canvasBounds.height);
    return { left: Math.min(...clientXs), top: Math.min(...clientYs), right: Math.max(...clientXs), bottom: Math.max(...clientYs) };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    setSnapGuides({});
    const point = toCanvasPoint(event);
    if (cropLayer && event.button === 0) {
      onLayerInteractionStart();
      const local = inverseRotatePoint(point, cropLayer);
      const crop = cropLayer.crop || { x: 0, y: 0, width: 1, height: 1 };
      const left = -cropLayer.width / 2 + crop.x * cropLayer.width;
      const top = -cropLayer.height / 2 + crop.y * cropLayer.height;
      const right = left + crop.width * cropLayer.width;
      const bottom = top + crop.height * cropLayer.height;
      const threshold = 14 / displayScale;
      const corners = [
        { handle: 'nw' as const, x: left, y: top },
        { handle: 'ne' as const, x: right, y: top },
        { handle: 'se' as const, x: right, y: bottom },
        { handle: 'sw' as const, x: left, y: bottom },
      ];
      const corner = corners.find((item) => Math.hypot(local.x - item.x, local.y - item.y) <= threshold);
      const handle = corner?.handle || (local.x >= left && local.x <= right && local.y >= top && local.y <= bottom ? 'move' : null);
      if (handle) {
        cropInteractionRef.current = { pointerId: event.pointerId, handle, start: local, original: { ...crop }, layer: structuredClone(cropLayer) };
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      return;
    }
    if (canvasTool === 'brush' && event.button === 0) {
      if (brushSettings.kind === 'image' && !brushSettings.imageSrc) return;
      onLayerInteractionStart();
      const points = [{ ...point, angle: 0 }];
      brushPointsRef.current = points;
      renderOverlay();
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (selectedLayer && !selectedLayer.locked) {
      const handle = selectedLayer.visible ? findHandle(selectedLayer, point, displayScale) : null;
      if (handle && handle !== 'move') {
        onLayerInteractionStart();
        interactionRef.current = { handle, start: point, original: structuredClone(selectedLayer) };
        latestInteractionLayerRef.current = structuredClone(selectedLayer);
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }

    const target = [...document.layers].reverse().find((layer) => layer.visible && layerContainsPoint(layer, point));
    if (!target) onLayerClick(null, null);
    const dragTarget = target && !target.locked && (event.ctrlKey || event.metaKey)
      ? onDuplicateForDrag(target)
      : target;
    onSelect(dragTarget?.id || null);
    if (dragTarget) {
      clickCandidateRef.current = { layer: structuredClone(dragTarget), clientX: event.clientX, clientY: event.clientY };
    }
    if (dragTarget && !dragTarget.locked) {
      interactionRef.current = {
        handle: 'move',
        start: point,
        original: structuredClone(dragTarget),
        duplicated: dragTarget !== target,
      };
      latestInteractionLayerRef.current = structuredClone(dragTarget);
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = {
      x: (event.clientX - bounds.left) * document.width / bounds.width,
      y: (event.clientY - bounds.top) * document.height / bounds.height,
    };
    const target = [...document.layers].reverse().find((layer) => layer.visible && layerContainsPoint(layer, point));
    if (target && (target.type === 'image' || target.type === 'shape' || target.type === 'text')) {
      onSelect(target.id);
      onOpenProperties(target.id);
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const clickCandidate = clickCandidateRef.current;
    if (clickCandidate && Math.hypot(event.clientX - clickCandidate.clientX, event.clientY - clickCandidate.clientY) > 5) {
      clickCandidateRef.current = null;
      onLayerInteractionStart();
    }
    const cropInteraction = cropInteractionRef.current;
    if (cropInteraction && cropInteraction.pointerId === event.pointerId) {
      const point = toCanvasPoint(event);
      const local = inverseRotatePoint(point, cropInteraction.layer);
      const deltaX = (local.x - cropInteraction.start.x) / cropInteraction.layer.width;
      const deltaY = (local.y - cropInteraction.start.y) / cropInteraction.layer.height;
      const original = cropInteraction.original;
      let left = original.x;
      let top = original.y;
      let right = original.x + original.width;
      let bottom = original.y + original.height;
      if (cropInteraction.handle === 'move') {
        const width = original.width;
        const height = original.height;
        left = Math.max(0, Math.min(1 - width, original.x + deltaX));
        top = Math.max(0, Math.min(1 - height, original.y + deltaY));
        right = left + width;
        bottom = top + height;
      } else {
        if (cropInteraction.handle === 'nw' || cropInteraction.handle === 'sw') left = Math.max(0, Math.min(right - 0.01, original.x + deltaX));
        if (cropInteraction.handle === 'ne' || cropInteraction.handle === 'se') right = Math.min(1, Math.max(left + 0.01, original.x + original.width + deltaX));
        if (cropInteraction.handle === 'nw' || cropInteraction.handle === 'ne') top = Math.max(0, Math.min(bottom - 0.01, original.y + deltaY));
        if (cropInteraction.handle === 'sw' || cropInteraction.handle === 'se') bottom = Math.min(1, Math.max(top + 0.01, original.y + original.height + deltaY));
      }
      onLiveCropChange(cropInteraction.layer.id, { x: left, y: top, width: right - left, height: bottom - top });
      return;
    }
    const brushPoints = brushPointsRef.current;
    if (brushPoints) {
      const point = toCanvasPoint(event);
      const previous = brushPoints[brushPoints.length - 1];
      if (Math.hypot(point.x - previous.x, point.y - previous.y) < Math.max(0.75, 1.5 / displayScale)) return;
      const next = [...brushPoints, { ...point, angle: Math.atan2(point.y - previous.y, point.x - previous.x) }];
      brushPointsRef.current = next;
      if (brushFrameRef.current === null) {
        brushFrameRef.current = window.requestAnimationFrame(() => {
          brushFrameRef.current = null;
          renderOverlay();
        });
      }
      return;
    }
    const interaction = interactionRef.current;
    if (!interaction) return;
    const point = toCanvasPoint(event);
    const original = interaction.original;
    let next: EditorLayer;
    if (interaction.handle === 'move') {
      let x = original.x + point.x - interaction.start.x;
      let y = original.y + point.y - interaction.start.y;
      let guideX: number | undefined;
      let guideY: number | undefined;
      if (snapToGuides && !event.altKey) {
        const threshold = 16 / displayScale;
        const xGuides = [
          { position: original.width / 2, line: 0 },
          { position: document.width / 2, line: document.width / 2 },
          { position: document.width - original.width / 2, line: document.width },
        ];
        const yGuides = [
          { position: original.height / 2, line: 0 },
          { position: document.height / 2, line: document.height / 2 },
          { position: document.height - original.height / 2, line: document.height },
        ];
        document.layers.forEach((layer) => {
          if (layer.id !== original.id && layer.visible) {
            xGuides.push({ position: layer.x, line: layer.x });
            yGuides.push({ position: layer.y, line: layer.y });
          }
        });
        const closeX = xGuides.find((guide) => Math.abs(guide.position - x) <= threshold);
        const closeY = yGuides.find((guide) => Math.abs(guide.position - y) <= threshold);
        if (closeX) { x = closeX.position; guideX = closeX.line; }
        if (closeY) { y = closeY.position; guideY = closeY.line; }
      }
      setSnapGuides({ x: guideX, y: guideY });
      next = {
        ...original,
        x,
        y,
      };
    } else if (interaction.handle === 'rotate') {
      const angle = Math.atan2(point.y - original.y, point.x - original.x) * 180 / Math.PI + 90;
      next = { ...original, rotation: event.shiftKey ? Math.round(angle / 15) * 15 : Math.round(angle) };
    } else if (interaction.handle === 'radius' && original.type === 'shape' && original.shape === 'rectangle') {
      const local = inverseRotatePoint(point, original);
      next = {
        ...original,
        radius: Math.round(Math.max(0, Math.min(Math.min(original.width, original.height) / 2, original.width / 2 - local.x))),
      };
    } else {
      const horizontal = interaction.handle === 'ne' || interaction.handle === 'se' ? 1 : -1;
      const vertical = interaction.handle === 'sw' || interaction.handle === 'se' ? 1 : -1;
      if (event.altKey) {
        const local = inverseRotatePoint(point, original);
        let width = Math.max(24, Math.abs(local.x) * 2);
        let height = Math.max(24, Math.abs(local.y) * 2);
        if (event.shiftKey || (original.type === 'image' && original.aspectRatioLocked)) {
          const ratio = original.type === 'image' ? original.sourceAspectRatio || original.width / original.height : original.width / original.height;
          if (width / height > ratio) height = width / ratio;
          else width = height * ratio;
        }
        onLiveLayerChange({ ...original, width: Math.round(width), height: Math.round(height) });
        return;
      }
      const opposite = layerCorner(original, horizontal === 1 ? -1 : 1, vertical === 1 ? -1 : 1);
      const angle = (original.rotation * Math.PI) / 180;
      const dx = point.x - opposite.x;
      const dy = point.y - opposite.y;
      let width = Math.max(24, Math.abs(dx * Math.cos(angle) + dy * Math.sin(angle)));
      let height = Math.max(24, Math.abs(-dx * Math.sin(angle) + dy * Math.cos(angle)));
      if (event.shiftKey || (original.type === 'image' && original.aspectRatioLocked)) {
        const ratio = original.type === 'image' ? original.sourceAspectRatio || original.width / original.height : original.width / original.height;
        if (width / height > ratio) height = width / ratio;
        else width = height * ratio;
      }
      const localCenterX = horizontal * width / 2;
      const localCenterY = vertical * height / 2;
      next = {
        ...original,
        x: opposite.x + localCenterX * Math.cos(angle) - localCenterY * Math.sin(angle),
        y: opposite.y + localCenterX * Math.sin(angle) + localCenterY * Math.cos(angle),
        width: Math.round(width),
        height: Math.round(height),
      };
    }
    latestInteractionLayerRef.current = next;
    onLiveLayerChange(next);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const cropInteraction = cropInteractionRef.current;
    if (cropInteraction && cropInteraction.pointerId === event.pointerId) {
      cropInteractionRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      onCommitCrop(cropInteraction.layer.id, cropInteraction.original);
      return;
    }
    const brushPoints = brushPointsRef.current;
    if (brushPoints) {
      brushPointsRef.current = null;
      if (brushFrameRef.current !== null) {
        window.cancelAnimationFrame(brushFrameRef.current);
        brushFrameRef.current = null;
      }
      renderOverlay();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      onCommitBrushStroke(brushPoints, brushSettings);
      return;
    }
    const interaction = interactionRef.current;
    const clickCandidate = clickCandidateRef.current;
    clickCandidateRef.current = null;
    if (clickCandidate) onLayerClick(clickCandidate.layer.id, getLayerClientBounds(clickCandidate.layer, event.currentTarget));
    if (!interaction) return;
    const finalLayer = latestInteractionLayerRef.current || interaction.original;
    latestInteractionLayerRef.current = null;
    interactionRef.current = null;
    setSnapGuides({});
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onCommitInteraction(interaction.original, interaction.duplicated);
    if (!clickCandidate) onLayerClick(finalLayer.id, getLayerClientBounds(finalLayer, event.currentTarget));
  };

  return (
    <div
      className="relative touch-none shadow-2xl"
      style={{ width: `${document.width * displayScale}px`, height: `${document.height * displayScale}px` }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
      <canvas
        ref={overlayRef}
        aria-label="壁纸编辑画布"
        className="absolute inset-0 block h-full w-full outline-none"
        style={{ cursor: isPanningMode ? 'grab' : canvasTool === 'brush' ? 'crosshair' : interactionRef.current ? 'grabbing' : selectedLayer?.locked ? 'default' : 'move' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      />
    </div>
  );
});

export default EditorCanvas;
