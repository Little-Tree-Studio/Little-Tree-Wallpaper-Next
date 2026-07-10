import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Button, Input, Modal, Label, Chip, Badge, Card, EmptyState,
} from '@heroui/react';
import {
  Plus, Pencil, Trash2, AlertTriangle, Tag,
} from 'lucide-react';
import { getFavorites, ensureTag, renameTag, deleteTag } from '@/api/backend';
import type { FavoriteItem } from '@/types';

export const SYSTEM_TAGS = ['Bing', 'Windows聚焦'];

interface TagInfo {
  name: string;
  count: number;
  isSystem: boolean;
}

interface TagManagerProps {
  onRefresh?: () => void;
}

export default function TagManager({ onRefresh }: TagManagerProps) {
  const [items, setItems] = useState<FavoriteItem[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deleteConfirmTag, setDeleteConfirmTag] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const d = await getFavorites();
    setItems(d.items);
    setAllTags(d.all_tags || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const tagInfos = useMemo<TagInfo[]>(() => {
    const map = new Map<string, number>();
    for (const tag of allTags) {
      map.set(tag, 0);
    }
    for (const item of items) {
      for (const tag of item.tags) {
        map.set(tag, (map.get(tag) || 0) + 1);
      }
    }
    for (const sys of SYSTEM_TAGS) {
      if (!map.has(sys)) {
        map.set(sys, 0);
      }
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count, isSystem: SYSTEM_TAGS.includes(name) }))
      .sort((a, b) => {
        if (a.isSystem && !b.isSystem) return -1;
        if (!a.isSystem && b.isSystem) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [items, allTags]);

  const filteredTags = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tagInfos;
    return tagInfos.filter((t) => t.name.toLowerCase().includes(q));
  }, [tagInfos, search]);

  const handleCreateTag = async () => {
    const name = newTagName.trim();
    if (!name) return;
    if (tagInfos.some((t) => t.name === name)) {
      alert('标签已存在');
      return;
    }
    if (SYSTEM_TAGS.includes(name)) {
      alert('不能使用系统标签名称');
      return;
    }
    await ensureTag(name);
    setNewTagName('');
    await refresh();
    onRefresh?.();
  };

  const openEdit = (name: string) => {
    setEditingTag(name);
    setEditName(name);
  };

  const closeEdit = () => {
    setEditingTag(null);
    setEditName('');
  };

  const handleRenameTag = async () => {
    if (!editingTag) return;
    const newName = editName.trim();
    if (!newName || newName === editingTag) {
      closeEdit();
      return;
    }
    if (tagInfos.some((t) => t.name === newName)) {
      alert('标签名已存在');
      return;
    }
    setLoading(true);
    await renameTag(editingTag, newName);
    closeEdit();
    await refresh();
    onRefresh?.();
    setLoading(false);
  };

  const handleDeleteTag = async (name: string) => {
    setLoading(true);
    await deleteTag(name);
    setDeleteConfirmTag(null);
    await refresh();
    onRefresh?.();
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Tag size={14} />
          共 {tagInfos.length} 个标签，{tagInfos.filter((t) => !t.isSystem).length} 个自定义
        </div>
        <div className="flex items-center gap-2">
          <Input
            className="w-full sm:w-48"
            placeholder="搜索标签..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            className="flex-1"
            placeholder="输入新标签名称"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreateTag(); }}
          />
          <Button onPress={handleCreateTag} isDisabled={!newTagName.trim()}>
            <Plus size={14} /> 新建标签
          </Button>
        </div>
      </Card>

      {loading ? (
        <div className="py-10 text-center text-muted">加载中...</div>
      ) : filteredTags.length === 0 ? (
        <div className="py-12">
          <EmptyState>
            <div className="flex flex-col items-center gap-2 text-muted">
              <Tag size={32} />
              <p>{search ? '未找到匹配标签' : '暂无标签'}</p>
            </div>
          </EmptyState>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredTags.map((tag) => (
            <Card key={tag.name} className="flex flex-row items-center justify-between p-3">
              <div className="flex items-center gap-3 min-w-0">
                <Chip size="sm" color={tag.isSystem ? 'warning' : 'default'} variant={tag.isSystem ? 'soft' : 'secondary'}>
                  <Chip.Label className="truncate max-w-[140px]" title={tag.name}>{tag.name}</Chip.Label>
                </Chip>
                <Badge size="sm" variant="soft">{tag.count}</Badge>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!tag.isSystem ? (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      isIconOnly
                      aria-label="编辑"
                      onPress={() => openEdit(tag.name)}
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      isIconOnly
                      aria-label="删除"
                      className="text-danger"
                      onPress={() => setDeleteConfirmTag(tag.name)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </>
                ) : (
                  <Chip size="sm" color="warning" variant="soft">
                    <Chip.Label>系统</Chip.Label>
                  </Chip>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal.Backdrop isOpen={!!editingTag} onOpenChange={(open) => !open && closeEdit()}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>重命名标签</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="space-y-3">
                <Label className="block text-sm">标签名称</Label>
                <Input
                  autoFocus
                  placeholder="输入新名称"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleRenameTag(); }}
                />
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={closeEdit}>取消</Button>
              <Button onPress={handleRenameTag}>保存</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <Modal.Backdrop isOpen={!!deleteConfirmTag} onOpenChange={(open) => !open && setDeleteConfirmTag(null)}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Icon className="bg-danger-soft text-danger">
                <AlertTriangle size={20} />
              </Modal.Icon>
              <Modal.Heading>确认删除</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p>确定要删除标签 <strong>{deleteConfirmTag}</strong> 吗？</p>
              <p className="text-sm text-muted">删除后会自动从所有已使用该标签的收藏中同步移除，操作不可恢复。</p>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={() => setDeleteConfirmTag(null)}>取消</Button>
              <Button variant="danger" onPress={() => deleteConfirmTag && handleDeleteTag(deleteConfirmTag)}>删除</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
