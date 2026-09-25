import type { FavoriteItem } from '@/types';
import type { HistoryItem } from '@/api/backend';

export function favoriteImageUrl(item: FavoriteItem, preview = false): string {
  const embedded = [item.preview_url, item.source_url]
    .find((url) => url?.trimStart().toLowerCase().startsWith('data:image/'))?.trimStart();
  return embedded || (preview ? item.preview_url || item.source_url : item.source_url || item.preview_url) || '';
}

export function sameWallpaperPath(left: string, right: string): boolean {
  // Windows paths are case-insensitive; POSIX filenames are not.
  const normalize = (path: string) => /^[a-z]:[\\/]|^\\\\/i.test(path)
    ? path.replace(/\\/g, '/').toLowerCase()
    : path;
  return !!left && !!right && normalize(left) === normalize(right);
}

export function previousWallpaper(items: HistoryItem[], currentPath: string): HistoryItem | undefined {
  if (!currentPath) return undefined;
  return items.find((item) => item.path
    && !sameWallpaperPath(item.path, currentPath)
    && !sameWallpaperPath(item.original_path || '', currentPath));
}

export function nextFavoriteIndex(length: number, current: number): number {
  if (length < 2) return 0;
  return (current + 1 + Math.floor(Math.random() * (length - 1))) % length;
}
