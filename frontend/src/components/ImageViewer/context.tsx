import { createContext, useContext, useState, useCallback } from 'react';

export interface ImageViewerItem {
  src: string;
  title?: string;
  description?: string;
  source_url?: string;
  source_type?: string;
  local_path?: string | null;
  preview_url?: string;
}

export interface ImageViewerOptions {
  /** 禁用“设为壁纸”按钮（例如主页已提供该入口） */
  disableSetWallpaper?: boolean;
}

interface ImageViewerContextValue {
  isOpen: boolean;
  items: ImageViewerItem[];
  currentIndex: number;
  options: ImageViewerOptions;
  openViewer: (items: ImageViewerItem[], startIndex?: number, options?: ImageViewerOptions) => void;
  closeViewer: () => void;
  goNext: () => void;
  goPrev: () => void;
  goTo: (index: number) => void;
}

const ImageViewerContext = createContext<ImageViewerContextValue | null>(null);

export function useImageViewer() {
  const ctx = useContext(ImageViewerContext);
  if (!ctx) throw new Error('useImageViewer must be used within ImageViewerProvider');
  return ctx;
}

export function ImageViewerProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<ImageViewerItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [options, setOptions] = useState<ImageViewerOptions>({});

  const openViewer = useCallback(
    (newItems: ImageViewerItem[], startIndex = 0, opts: ImageViewerOptions = {}) => {
      setItems(newItems);
      setCurrentIndex(Math.max(0, Math.min(startIndex, newItems.length - 1)));
      setOptions(opts);
      setIsOpen(true);
    },
    [],
  );

  const closeViewer = useCallback(() => {
    setIsOpen(false);
    setOptions({});
  }, []);

  const goNext = useCallback(() => {
    setCurrentIndex((i) => (i + 1) % items.length);
  }, [items.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => (i - 1 + items.length) % items.length);
  }, [items.length]);

  const goTo = useCallback((index: number) => {
    setCurrentIndex(Math.max(0, Math.min(index, items.length - 1)));
  }, [items.length]);

  return (
    <ImageViewerContext.Provider
      value={{ isOpen, items, currentIndex, options, openViewer, closeViewer, goNext, goPrev, goTo }}
    >
      {children}
    </ImageViewerContext.Provider>
  );
}
