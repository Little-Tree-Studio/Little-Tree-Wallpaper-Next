import { useState, useEffect } from 'react';
import {
  Card, Button, Input, Badge, Modal, Spinner, Label, Chip,
} from '@heroui/react';
import {
  FolderPlus, Pencil, Trash2, ImageIcon,
  RefreshCw, FolderOutput, Import, Globe,
} from 'lucide-react';
import {
  getFavorites, removeFavorite, updateFavorite,
  createFavoriteFolder, setWallpaper, downloadFile,
  exportFavorites, selectLocalImage, getLocalImageBase64,
} from '@/api/backend';
import { useImageViewer } from '@/components/ImageViewer/context';
import type { FavoriteItem, FavoriteFolder } from '@/types';

export default function Favorite() {
  const [data, setData] = useState<{ folders: FavoriteFolder[]; items: FavoriteItem[] }>({ folders: [], items: [] });
  const [activeFolder, setActiveFolder] = useState('default');
  const [loading, setLoading] = useState(false);
  const [editingItem, setEditingItem] = useState<FavoriteItem | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editTags, setEditTags] = useState('');
  const [localB64Map, setLocalB64Map] = useState<Record<string, string>>({});
  const { openViewer } = useImageViewer();

  const refresh = async () => {
    setLoading(true);
    const d = await getFavorites();
    setData(d);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    const loadLocalImages = async () => {
      const toLoad = data.items.filter(
        (it) => it.local_path && !localB64Map[it.local_path],
      );
      if (toLoad.length === 0) return;
      const results = await Promise.all(
        toLoad.map(async (item) => {
          if (!item.local_path) return null;
          const b64 = await getLocalImageBase64(item.local_path);
          return b64 ? { path: item.local_path, b64 } : null;
        }),
      );
      const newMap: Record<string, string> = {};
      for (const result of results) {
        if (result) newMap[result.path] = result.b64;
      }
      if (Object.keys(newMap).length > 0) {
        setLocalB64Map((prev) => ({ ...prev, ...newMap }));
      }
    };
    loadLocalImages();
  }, [data.items]);

  const filteredItems = activeFolder === 'all'
    ? data.items
    : data.items.filter((it) => it.folder_id === activeFolder);

  const handleDelete = async (id: string) => {
    await removeFavorite(id);
    refresh();
  };

  const handleSaveEdit = async () => {
    if (!editingItem) return;
    await updateFavorite({ ...editingItem, title: editTitle, tags: editTags.split(/[,，]/).map((t) => t.trim()).filter(Boolean) });
    setEditingItem(null);
    refresh();
  };

  const handleLocalize = async (item: FavoriteItem) => {
    if (!item.preview_url) return;
    const path = await downloadFile(item.preview_url, `${item.title}.jpg`);
    if (path) {
      await updateFavorite({ ...item, local_path: path });
      refresh();
    }
  };

  const isLocalized = (item: FavoriteItem): boolean => {
    return !!item.local_path || (!!item.preview_url && item.preview_url.startsWith('data:image'));
  };

  const getItemSrc = (it: FavoriteItem) => {
    return localB64Map[it.local_path || ''] || it.preview_url || it.local_path || '';
  };

  const handleOpenViewer = (item: FavoriteItem) => {
    const items = filteredItems.map((it) => ({
      src: getItemSrc(it),
      title: it.title,
      source_url: it.source_url,
      source_type: it.source_type,
      local_path: it.local_path,
      preview_url: it.preview_url,
    }));
    const index = filteredItems.findIndex((it) => it.id === item.id);
    openViewer(items, Math.max(0, index));
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="text-2xl font-bold">收藏</h1>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onPress={refresh}><RefreshCw size={14} /> 刷新</Button>
        <Button size="sm" variant="secondary" onPress={async () => { const path = await selectLocalImage(); if (path) { /* add local */ } }}><FolderPlus size={14} /> 添加本地</Button>
        <Button size="sm" variant="secondary" onPress={async () => { const path = await exportFavorites(activeFolder === 'all' ? undefined : activeFolder); alert(`导出到: ${path}`); }}><FolderOutput size={14} /> 导出</Button>
        <Button size="sm" variant="ghost" onPress={async () => { /* import dialog */ }}><Import size={14} /> 导入</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {[{ id: 'all', name: '全部' }, ...data.folders].map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={activeFolder === f.id ? 'primary' : 'ghost'}
            onPress={() => setActiveFolder(f.id)}
          >
            {f.name}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onPress={async () => { const name = prompt('文件夹名称'); if (name) { await createFavoriteFolder(name); refresh(); } }}><FolderPlus size={14} /> 新建</Button>
      </div>

      {loading ? <div className="py-10"><Spinner size="sm" /></div> : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredItems.map((item) => (
            <Card key={item.id} className="overflow-hidden">
              <div className="relative h-[160px] w-full overflow-hidden bg-surface-secondary">
                <img
                  src={getItemSrc(item)}
                  alt={item.title}
                  className="h-full w-full cursor-pointer object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  onClick={() => handleOpenViewer(item)}
                />
                {isLocalized(item) && (
                  <Chip size="sm" color="success" variant="primary" className="absolute top-2 right-2">
                    <Chip.Label>本地</Chip.Label>
                  </Chip>
                )}
              </div>
              <Card.Header className="pb-1">
                <Card.Title className="text-sm">{item.title}</Card.Title>
              </Card.Header>
              <Card.Content className="pt-0">
                <div className="flex flex-wrap gap-1">
                  {item.tags.map((t) => <Badge key={t} size="sm" variant="secondary">{t}</Badge>)}
                </div>
                <div className="mt-1 text-xs text-muted">来源: {item.source_type}</div>
              </Card.Content>
              <Card.Footer className="flex flex-wrap gap-1">
                <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onPress={() => item.local_path && setWallpaper(item.local_path)}><ImageIcon size={12} /> 壁纸</Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onPress={() => { setEditingItem(item); setEditTitle(item.title); setEditTags(item.tags.join(', ')); }}><Pencil size={12} /></Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" isDisabled={isLocalized(item)} onPress={() => handleLocalize(item)}><Globe size={12} /> 本地化</Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-danger" onPress={() => handleDelete(item.id)}><Trash2 size={12} /></Button>
              </Card.Footer>
            </Card>
          ))}
        </div>
      )}

      {filteredItems.length === 0 && !loading && (
        <div className="py-20 text-center text-muted">此文件夹暂无收藏</div>
      )}

      {editingItem && (
        <Modal isOpen onOpenChange={(open) => !open && setEditingItem(null)}>
          <div className="p-6">
            <h3 className="mb-4 text-lg font-bold">编辑收藏</h3>
            <div className="space-y-3">
              <div>
                <Label className="text-sm">标题</Label>
                <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
              </div>
              <div>
                <Label className="text-sm">标签 (用逗号分隔)</Label>
                <Input value={editTags} onChange={(e) => setEditTags(e.target.value)} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onPress={() => setEditingItem(null)}>取消</Button>
                <Button onPress={handleSaveEdit}>保存</Button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
