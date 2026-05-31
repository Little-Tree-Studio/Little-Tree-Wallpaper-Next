import { useState } from 'react';
import { Card, Button, Input, Spinner, Badge } from '@heroui/react';
import { Search, ImageIcon, Heart, Download, Copy, CheckSquare, Square } from 'lucide-react';
import { sniffImages, setWallpaper, downloadFile, copyToClipboard, addFavorite } from '@/api/backend';
import type { SniffedImage } from '@/types';

export default function Sniff() {
  const [url, setUrl] = useState('');
  const [images, setImages] = useState<SniffedImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const handleSniff = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setSelected(new Set());
    try {
      const result = await sniffImages(url.trim());
      setImages(result);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const selectedImages = images.filter((img) => selected.has(img.id));

  const handleSetWallpaper = async (img: SniffedImage) => {
    const path = await downloadFile(img.url, img.filename);
    if (path) await setWallpaper(path);
  };

  const handleFavoriteSelected = async () => {
    for (const img of selectedImages) {
      await addFavorite({
        folder_id: 'default', title: img.filename, description: '', tags: [],
        preview_url: img.url, local_path: null,
        source_type: 'sniff', source_url: img.url,
      });
    }
    setSelected(new Set());
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-bold">嗅探</h1>
      <p className="text-sm text-muted">从网页中提取图片</p>

      <div className="flex gap-2">
        <Input
          placeholder="输入 URL..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSniff()}
          fullWidth
        />
        <Button onPress={handleSniff} isPending={loading}><Search size={16} /> 开始嗅探</Button>
        <Button variant="ghost" onPress={() => { setUrl(''); setImages([]); setSelected(new Set()); }}>清空</Button>
      </div>

      {selected.size > 0 && (
        <Card className="p-3">
          <div className="flex items-center gap-4">
            <Badge>已选择 {selected.size} 张</Badge>
            <Button size="sm" variant="secondary" onPress={handleFavoriteSelected}><Heart size={14} /> 批量收藏</Button>
            <Button size="sm" variant="ghost" onPress={() => {
              const urls = selectedImages.map((i) => i.url).join('\n');
              copyToClipboard(urls);
            }}><Copy size={14} /> 复制链接</Button>
          </div>
        </Card>
      )}

      {loading && <div className="flex justify-center py-10"><Spinner size="sm" /></div>}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {images.map((img) => {
          const isSel = selected.has(img.id);
          return (
            <div
              key={img.id}
              className={`group relative cursor-pointer overflow-hidden rounded-xl border-2 transition-all ${isSel ? 'border-primary' : 'border-transparent'}`}
              onClick={() => toggleSelect(img.id)}
            >
              <img
                src={img.url}
                alt={img.filename}
                className="aspect-square w-full object-cover"
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; }}
              />
              <div className="absolute top-2 left-2">
                {isSel ? <CheckSquare className="text-primary" size={20} /> : <Square className="text-white/70" size={20} />}
              </div>
              <div className="absolute inset-x-0 bottom-0 flex gap-1 bg-black/60 p-1 opacity-0 transition-opacity group-hover:opacity-100">
                <span onClick={(e) => { e.stopPropagation(); }}>
                  <Button size="sm" variant="tertiary" className="h-7 min-w-0 px-2 text-xs" onPress={() => handleSetWallpaper(img)}><ImageIcon size={12} /> 壁纸</Button>
                </span>
                <span onClick={(e) => { e.stopPropagation(); }}>
                  <Button size="sm" variant="tertiary" className="h-7 min-w-0 px-2 text-xs" onPress={() => addFavorite({ folder_id: 'default', title: img.filename, description: '', tags: [], preview_url: img.url, local_path: null, source_type: 'sniff', source_url: img.url })}><Heart size={12} /></Button>
                </span>
                <span onClick={(e) => { e.stopPropagation(); }}>
                  <Button size="sm" variant="tertiary" className="h-7 min-w-0 px-2 text-xs" onPress={() => downloadFile(img.url, img.filename)}><Download size={12} /></Button>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {!loading && images.length === 0 && url && (
        <div className="py-10 text-center text-muted">未找到图片</div>
      )}
    </div>
  );
}
