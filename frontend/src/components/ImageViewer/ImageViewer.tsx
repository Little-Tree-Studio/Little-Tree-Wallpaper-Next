import { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, RotateCw, ZoomIn, ZoomOut, Maximize, Heart, Image as ImageIcon,
  Copy, ChevronLeft, ChevronRight, Save, PanelsTopLeft, ExternalLink,
  ClipboardCopy,
} from 'lucide-react';
import { Button, Spinner, Tooltip, toast } from '@heroui/react';
import { useImageViewer } from './context';
import {
  copyToClipboard, addFavorite, getFavorites, removeFavorite, saveAsWithProgress,
  setWallpaperWithProgress, openWithSystemWithProgress,
  copyImageToClipboardWithProgress, notifyFavoritesChanged,
} from '@/api/backend';
import { safeNameForFile } from '@/lib/download';

interface TooltipIconButtonProps {
  onPress: (e?: any) => void;
  ariaLabel: string;
  tooltip: string;
  className?: string;
  children: React.ReactNode;
}

function stableResourceUrl(value?: string | null): string {
  if (!value) return '';
  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.pathname === '/api/cnu-image' || parsed.pathname === '/api/pixiv-image' || parsed.pathname === '/api/sniff-image') {
      return parsed.searchParams.get('url') || value;
    }
    if (parsed.pathname === '/api/preview') {
      return parsed.searchParams.get('path') || value;
    }
  } catch {
    return value;
  }
  return value;
}

function TooltipIconButton({
  onPress,
  ariaLabel,
  tooltip,
  className,
  children,
}: TooltipIconButtonProps) {
  return (
    <Tooltip delay={0}>
      <Button
        isIconOnly
        variant="ghost"
        className={className ?? 'rounded p-2 text-white/70 hover:bg-white/10 hover:text-white'}
        onPress={onPress}
        aria-label={ariaLabel}
      >
        {children}
      </Button>
      <Tooltip.Content>
        <p>{tooltip}</p>
      </Tooltip.Content>
    </Tooltip>
  );
}

export default function ImageViewer() {
  const { isOpen, items, currentIndex, options, closeViewer, goNext, goPrev, goTo } = useImageViewer();
  const [rotation, setRotation] = useState(0);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [showThumbnails, setShowThumbnails] = useState(true);
  const [isImageLoading, setIsImageLoading] = useState(true);
  const [imageLoadError, setImageLoadError] = useState(false);
  const [favoriteId, setFavoriteId] = useState<string | null>(null);
  const imgContainerRef = useRef<HTMLDivElement>(null);

  const currentItem = items[currentIndex];

  const resetTransform = useCallback(() => {
    setRotation(0);
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    if (isOpen) {
      resetTransform();
      setIsImageLoading(true);
      setImageLoadError(false);
    }
  }, [isOpen, currentIndex, currentItem?.src, resetTransform]);

  useEffect(() => {
    if (!isOpen || !currentItem) return;
    let cancelled = false;
    const sourceUrl = stableResourceUrl(currentItem.source_url || currentItem.src);
    const previewUrl = stableResourceUrl(currentItem.preview_url || currentItem.src);
    const localPath = currentItem.local_path || '';

    setFavoriteId(null);
    getFavorites()
      .then((favorites) => {
        if (cancelled) return;
        const match = favorites.items.find((favorite) => (
          (sourceUrl && stableResourceUrl(favorite.source_url) === sourceUrl)
          || (previewUrl && stableResourceUrl(favorite.preview_url) === previewUrl)
          || (localPath && favorite.local_path === localPath)
        ));
        setFavoriteId(match?.id || null);
      })
      .catch(() => {
        if (!cancelled) setFavoriteId(null);
      });

    return () => { cancelled = true; };
  }, [isOpen, currentItem]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          closeViewer();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          goPrev();
          break;
        case 'ArrowRight':
          e.preventDefault();
          goNext();
          break;
        case '+':
        case '=':
          e.preventDefault();
          setScale((s) => Math.min(s + 0.25, 5));
          break;
        case '-':
          e.preventDefault();
          setScale((s) => Math.max(s - 0.25, 0.25));
          break;
        case 'r':
        case 'R':
          setRotation((r) => (r + 90) % 360);
          break;
        case '0':
          resetTransform();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeViewer, goNext, goPrev, resetTransform]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setScale((s) => Math.max(0.25, Math.min(5, s + delta)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setPanStart({ ...pan });
    }
  }, [scale, pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    setPan({ x: panStart.x + dx, y: panStart.y + dy });
  }, [isDragging, dragStart, panStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      closeViewer();
    }
  }, [closeViewer]);

  const handleRotate = () => {
    setRotation((r) => (r + 90) % 360);
  };

  const handleZoomIn = () => {
    setScale((s) => Math.min(s + 0.25, 5));
  };

  const handleZoomOut = () => {
    setScale((s) => Math.max(s - 0.25, 0.25));
  };

  const handleReset = () => {
    resetTransform();
  };

  const handleSetWallpaper = async () => {
    if (!currentItem) return;
    const url = currentItem.src || currentItem.preview_url || currentItem.source_url;
    if (!url && !currentItem.local_path) {
      toast.danger('没有可用的图片来源', { timeout: 0 });
      return;
    }
    const safeName = safeNameForFile(currentItem.title, 'wallpaper');
    await setWallpaperWithProgress(url || '', `${safeName}.jpg`, currentItem.local_path);
  };

  const handleOpenWithSystem = async () => {
    if (!currentItem) return;
    const url = currentItem.src || currentItem.source_url;
    if (!url && !currentItem.local_path) {
      toast.danger('没有可用的图片来源', { timeout: 0 });
      return;
    }
    const safeName = safeNameForFile(currentItem.title, 'image');
    await openWithSystemWithProgress(url || '', `${safeName}.jpg`, currentItem.local_path);
  };

  const handleFavorite = async () => {
    if (!currentItem) return;
    try {
      if (favoriteId) {
        await removeFavorite(favoriteId);
        setFavoriteId(null);
        notifyFavoritesChanged();
        toast.success('已取消收藏', { timeout: 2500 });
        return;
      }
      const favorite = await addFavorite({
        folder_id: 'default',
        title: currentItem.title || '未命名',
        description: currentItem.description || '',
        tags: currentItem.tags || [],
        preview_url: currentItem.preview_url || currentItem.src,
        local_path: currentItem.local_path || null,
        source_type: currentItem.source_type || 'unknown',
        source_name: currentItem.source_name,
        source_url: currentItem.source_url || currentItem.src,
        source_page_url: currentItem.source_page_url,
      });
      setFavoriteId(favorite.id);
      notifyFavoritesChanged();
      toast.success('已添加到收藏', { timeout: 2500 });
    } catch (error) {
      toast.danger(favoriteId ? '取消收藏失败' : '收藏失败', {
        description: error instanceof Error ? error.message : '请稍后重试',
        timeout: 0,
      });
    }
  };

  const handleSaveAs = async () => {
    if (!currentItem) return;
    const safeName = safeNameForFile(currentItem.title, 'wallpaper');
    const url = currentItem.src || currentItem.source_url;
    if (!url) {
      toast.danger('没有可保存的数据', { timeout: 0 });
      return;
    }
    await saveAsWithProgress(url, `${safeName}.jpg`);
  };

  const handleCopyImage = async () => {
    if (!currentItem) return;
    const url = currentItem.src || currentItem.source_url;
    if (!url) {
      toast.danger('没有可复制的图片', { timeout: 0 });
      return;
    }
    await copyImageToClipboardWithProgress(url);
  };

  const handleCopyUrl = async () => {
    if (!currentItem) return;
    let url = currentItem.source_url;
    if (!url && currentItem.local_path) {
      url = currentItem.local_path;
    }
    if (!url && currentItem.src && !currentItem.src.startsWith('data:')) {
      url = currentItem.src;
    }
    if (url) await copyToClipboard(url);
  };

  if (!isOpen || !currentItem) return null;

  const transformStyle: React.CSSProperties = {
    transform: `translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg) scale(${scale})`,
    transition: isDragging ? 'none' : 'transform 0.2s ease',
    cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
      onClick={handleBackdropClick}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 text-white/80"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 text-sm">
          <span>{currentIndex + 1} / {items.length}</span>
          {currentItem.title && (
            <span className="max-w-[300px] truncate text-white/60">{currentItem.title}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <TooltipIconButton
            onPress={handleCopyUrl}
            ariaLabel="复制链接"
            tooltip="复制链接"
            className="rounded p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
          >
            <Copy size={16} />
          </TooltipIconButton>
          <TooltipIconButton
            onPress={closeViewer}
            ariaLabel="关闭 (Esc)"
            tooltip="关闭 (Esc)"
            className="rounded p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
          >
            <X size={18} />
          </TooltipIconButton>
        </div>
      </div>

      {/* Main image area */}
      <div
        ref={imgContainerRef}
        className="relative flex flex-1 items-center justify-center overflow-hidden"
        onWheel={handleWheel}
        onClick={handleBackdropClick}
      >
        {items.length > 1 && (
          <>
            <TooltipIconButton
              onPress={(e: any) => { e?.stopPropagation?.(); goPrev(); }}
              ariaLabel="上一张 (←)"
              tooltip="上一张 (←)"
              className="absolute left-2 z-10 rounded-full bg-black/40 p-2 text-white/80 hover:bg-black/60 hover:text-white"
            >
              <ChevronLeft size={24} />
            </TooltipIconButton>
            <TooltipIconButton
              onPress={(e: any) => { e?.stopPropagation?.(); goNext(); }}
              ariaLabel="下一张 (→)"
              tooltip="下一张 (→)"
              className="absolute right-2 z-10 rounded-full bg-black/40 p-2 text-white/80 hover:bg-black/60 hover:text-white"
            >
              <ChevronRight size={24} />
            </TooltipIconButton>
          </>
        )}

        {isImageLoading && !imageLoadError && (
          <div
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/70"
            role="status"
            aria-live="polite"
          >
            <Spinner size="lg" color="current" />
            <span className="text-sm">正在加载完整图片</span>
          </div>
        )}

        {imageLoadError && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/70">
            完整图片加载失败
          </div>
        )}

        <img
          key={currentItem.src}
          src={currentItem.src}
          alt={currentItem.title || '图片'}
          className={`select-none transition-opacity duration-200 ${isImageLoading || imageLoadError ? 'opacity-0' : 'opacity-100'}`}
          style={transformStyle}
          onLoad={() => {
            setIsImageLoading(false);
            setImageLoadError(false);
          }}
          onError={() => {
            setIsImageLoading(false);
            setImageLoadError(true);
          }}
          onMouseDown={handleMouseDown}
          onClick={(e) => e.stopPropagation()}
          draggable={false}
        />
      </div>

      {/* Bottom toolbar */}
      <div
        className="flex items-center justify-center gap-1 px-4 py-2 text-white/80"
        onClick={(e) => e.stopPropagation()}
      >
        <TooltipIconButton
          onPress={handleZoomOut}
          ariaLabel="缩小 (-)"
          tooltip="缩小 (-)"
        >
          <ZoomOut size={18} />
        </TooltipIconButton>
        <span className="min-w-[48px] text-center text-xs">{Math.round(scale * 100)}%</span>
        <TooltipIconButton
          onPress={handleZoomIn}
          ariaLabel="放大 (+)"
          tooltip="放大 (+)"
        >
          <ZoomIn size={18} />
        </TooltipIconButton>
        <div className="mx-2 h-5 w-px bg-white/20" />
        <TooltipIconButton
          onPress={handleRotate}
          ariaLabel="旋转 (R)"
          tooltip="旋转 (R)"
        >
          <RotateCw size={18} />
        </TooltipIconButton>
        <TooltipIconButton
          onPress={handleReset}
          ariaLabel="重置 (0)"
          tooltip="重置 (0)"
        >
          <Maximize size={18} />
        </TooltipIconButton>
        <div className="mx-2 h-5 w-px bg-white/20" />
        {!options.disableSetWallpaper && (
          <TooltipIconButton
            onPress={handleSetWallpaper}
            ariaLabel="设为壁纸"
            tooltip="设为壁纸"
          >
            <ImageIcon size={18} />
          </TooltipIconButton>
        )}
        <TooltipIconButton
          onPress={handleOpenWithSystem}
          ariaLabel="使用系统默认打开"
          tooltip="使用系统默认打开"
        >
          <ExternalLink size={18} />
        </TooltipIconButton>
          <TooltipIconButton
            onPress={handleFavorite}
            ariaLabel={favoriteId ? '取消收藏' : '收藏'}
            tooltip={favoriteId ? '取消收藏' : '收藏'}
            className={favoriteId
              ? 'rounded p-2 text-danger hover:bg-white/10 hover:text-danger'
              : undefined}
          >
            <Heart size={18} fill={favoriteId ? 'currentColor' : 'none'} />
          </TooltipIconButton>
        <TooltipIconButton
          onPress={handleSaveAs}
          ariaLabel="另存为"
          tooltip="另存为"
        >
          <Save size={18} />
        </TooltipIconButton>
        <TooltipIconButton
          onPress={handleCopyImage}
          ariaLabel="复制图片"
          tooltip="复制图片"
        >
          <ClipboardCopy size={18} />
        </TooltipIconButton>
        {items.length > 1 && (
          <>
            <div className="mx-2 h-5 w-px bg-white/20" />
            <TooltipIconButton
              onPress={() => setShowThumbnails((v) => !v)}
              ariaLabel="切换缩略图"
              tooltip={showThumbnails ? '隐藏缩略图' : '显示缩略图'}
              className={`rounded p-2 hover:bg-white/10 ${showThumbnails ? 'text-white' : 'text-white/50'}`}
            >
              <PanelsTopLeft size={18} />
            </TooltipIconButton>
          </>
        )}
      </div>

      {/* Copyright */}
      {currentItem.copyright && (
        <div
          className="px-4 py-1.5 text-center text-xs text-white/50"
          onClick={(e) => e.stopPropagation()}
        >
          {currentItem.copyright}
        </div>
      )}

      {/* Thumbnails */}
      {showThumbnails && items.length > 1 && (
        <div
          className="flex gap-2 overflow-x-auto px-4 pb-3"
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((item, idx) => (
            <Tooltip key={idx} delay={0}>
              <Button
                variant="ghost"
                onPress={() => goTo(idx)}
                className={`relative h-auto shrink-0 overflow-hidden rounded p-0 transition-all ${
                  idx === currentIndex
                    ? 'ring-2 ring-primary'
                    : 'opacity-60 hover:opacity-100'
                }`}
              >
                <img
                  src={item.preview_url || item.src}
                  alt={item.title || ''}
                  className="h-14 w-24 object-cover"
                  loading="lazy"
                />
              </Button>
              <Tooltip.Content>
                <p>{item.title ? `${idx + 1}. ${item.title}` : `第 ${idx + 1} 张`}</p>
              </Tooltip.Content>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  );
}
