import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Key } from '@heroui/react';
import {
  Card, Button, Input, Drawer, Spinner, Label, Chip,
  ListBox, Modal, Autocomplete, useFilter, EmptyState,
  SearchField, Tag as HeroTag, TagGroup, TextArea, Select,
  TextField, Checkbox, Toolbar, ButtonGroup, Separator, FieldError, Description, toast,
} from '@heroui/react';
import TagList from '@/components/TagList';
import TagManager from '@/components/TagManager';
import {
  Plus, Pencil, Trash2, ImageIcon, FolderPlus,
  RefreshCw, FolderOutput, Import, Globe, Settings2, Tag,
  AlertTriangle, FolderOpen, FolderInput, X, CheckSquare, FilePenLine,
} from 'lucide-react';
import {
  getFavorites, removeFavorite, updateFavorite,
  createFavoriteFolder, updateFavoriteFolder, deleteFavoriteFolder, setWallpaper, downloadWithProgress,
  exportFavorites, pickAndImportFavorites, selectLocalImage, localPreviewUrl,
  FAVORITES_CHANGED_EVENT,
} from '@/api/backend';
import { useImageViewer } from '@/components/ImageViewer/context';
import type { FavoriteFolder, FavoriteItem, FavoritesData } from '@/types';
import { safeNameForFile } from '@/lib/download';
import FavoriteTransferModal from '@/components/FavoriteTransferModal';

export default function Favorite() {
  const navigate = useNavigate();
  const [data, setData] = useState<FavoritesData>({ folders: [], items: [], all_tags: [] });
  const [activeFolder, setActiveFolder] = useState('default');
  const [loading, setLoading] = useState(false);
  const [editingItem, setEditingItem] = useState<FavoriteItem | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editFolderId, setEditFolderId] = useState('default');
  const [editSelectedTagKeys, setEditSelectedTagKeys] = useState<Key[]>([]);
  const [showTagManagerModal, setShowTagManagerModal] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [tagSearchText, setTagSearchText] = useState('');
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchMoveModal, setShowBatchMoveModal] = useState(false);
  const [batchMoveFolderId, setBatchMoveFolderId] = useState('');
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderDescription, setNewFolderDescription] = useState('');
  const [createFolderError, setCreateFolderError] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [editingFolder, setEditingFolder] = useState<FavoriteFolder | null>(null);
  const [editFolderName, setEditFolderName] = useState('');
  const [editFolderDescription, setEditFolderDescription] = useState('');
  const [editFolderError, setEditFolderError] = useState('');
  const [savingFolder, setSavingFolder] = useState(false);
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [importing, setImporting] = useState(false);
  const {contains} = useFilter({sensitivity: 'base'});
  const { openViewer } = useImageViewer();

  const allTags = useMemo(() => {
    return (data.all_tags || []).sort();
  }, [data.all_tags]);

  const tagOptions = useMemo(() => {
    return allTags.map((t) => ({ id: t, name: t }));
  }, [allTags]);

  const folderOptions = useMemo(() => {
    return data.folders.map((f) => ({ id: f.id, name: f.name }));
  }, [data.folders]);

  const activeFolderMeta = useMemo(() => {
    return data.folders.find((folder) => folder.id === activeFolder) || null;
  }, [activeFolder, data.folders]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getFavorites();
      setData(d);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(FAVORITES_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(FAVORITES_CHANGED_EVENT, refresh);
  }, [refresh]);

  const filteredItems = activeFolder === 'all'
    ? data.items
    : data.items.filter((it) => it.folder_id === activeFolder);

  const selectedItems = useMemo(() => {
    return filteredItems.filter((it) => selectedIds.has(it.id));
  }, [filteredItems, selectedIds]);

  const allSelected = filteredItems.length > 0 && selectedItems.length === filteredItems.length;
  const someSelected = selectedItems.length > 0 && selectedItems.length < filteredItems.length;

  const openEditDrawer = useCallback((item: FavoriteItem) => {
    setEditingItem(item);
    setEditTitle(item.title);
    setEditDescription(item.description || '');
    setEditFolderId(item.folder_id || 'default');
    setEditSelectedTagKeys(item.tags || []);
    setTagSearchText('');
  }, []);

  const closeEditDrawer = useCallback(() => {
    setEditingItem(null);
    setEditTitle('');
    setEditDescription('');
    setEditFolderId('default');
    setEditSelectedTagKeys([]);
    setTagSearchText('');
  }, []);

  const toggleBatchMode = () => {
    setIsBatchMode((prev) => !prev);
    setSelectedIds(new Set());
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredItems.map((it) => it.id)));
    }
  };

  const handleBatchDelete = async () => {
    if (selectedItems.length === 0) return;
    const ids = Array.from(selectedIds);
    await Promise.all(ids.map((id) => removeFavorite(id)));
    setSelectedIds(new Set());
    setDeleteConfirmId(null);
    setIsBatchMode(false);
    refresh();
  };

  const handleBatchMove = async () => {
    if (selectedItems.length === 0 || !batchMoveFolderId) return;
    await Promise.all(
      selectedItems.map((item) => updateFavorite({ ...item, folder_id: batchMoveFolderId })),
    );
    setBatchMoveFolderId('');
    setShowBatchMoveModal(false);
    setSelectedIds(new Set());
    setIsBatchMode(false);
    refresh();
  };

  const handleBatchExport = async () => {
    if (selectedItems.length === 0) return;
    setShowExportModal(true);
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const result = await pickAndImportFavorites();
      if (!result) return;
      let refreshFailed = false;
      try {
        await refresh();
      } catch {
        refreshFailed = true;
      }
      setSelectedIds(new Set());
      const localMessage = result.restored_local_files
        ? `，恢复 ${result.restored_local_files} 个本地文件`
        : '';
      const duplicateMessage = result.skipped_items ? `，跳过 ${result.skipped_items} 条重复收藏` : '';
      const missingMessage = result.missing_local_files ? `，${result.missing_local_files} 个本地文件未找到` : '';
      const refreshMessage = refreshFailed ? '，列表刷新失败，请手动刷新' : '';
      toast.success(`已导入 ${result.imported_items} 条收藏${localMessage}${duplicateMessage}${missingMessage}${refreshMessage}`, { timeout: 5000 });
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : '导入收藏失败', { timeout: 0 });
    } finally {
      setImporting(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingItem) return;
    const tags = editSelectedTagKeys
      .map((k) => {
        const s = String(k);
        return s.startsWith('__new__') ? s.slice(7) : s;
      })
      .filter(Boolean);
    await updateFavorite({
      ...editingItem,
      title: editTitle,
      description: editDescription,
      folder_id: editFolderId,
      tags,
    });
    closeEditDrawer();
    refresh();
  };

  const handleCreateTag = (name: string) => {
    const key = `__new__${name}`;
    if (!editSelectedTagKeys.some((k) => String(k) === key || String(k) === name)) {
      setEditSelectedTagKeys((prev) => [...prev, key]);
    }
  };

  const handleDelete = async (id: string) => {
    await removeFavorite(id);
    setDeleteConfirmId(null);
    refresh();
  };

  const openCreateFolderModal = () => {
    setNewFolderName('');
    setNewFolderDescription('');
    setCreateFolderError('');
    setShowCreateFolderModal(true);
  };

  const closeCreateFolderModal = () => {
    if (creatingFolder) return;
    setShowCreateFolderModal(false);
    setNewFolderName('');
    setNewFolderDescription('');
    setCreateFolderError('');
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    const description = newFolderDescription.trim();

    if (!name) {
      setCreateFolderError('请输入文件夹名称');
      return;
    }

    if (data.folders.some((folder) => folder.name === name)) {
      setCreateFolderError('已存在同名文件夹');
      return;
    }

    setCreatingFolder(true);
    setCreateFolderError('');
    try {
      const folder = await createFavoriteFolder(name, description || undefined);
      await refresh();
      setActiveFolder(folder.id);
      setShowCreateFolderModal(false);
      setNewFolderName('');
      setNewFolderDescription('');
    } catch (err) {
      setCreateFolderError(err instanceof Error ? err.message : '创建失败，请稍后重试');
    } finally {
      setCreatingFolder(false);
    }
  };

  const openEditFolderModal = (folder: FavoriteFolder) => {
    setEditingFolder(folder);
    setEditFolderName(folder.name);
    setEditFolderDescription(folder.description || '');
    setEditFolderError('');
  };

  const closeEditFolderModal = () => {
    if (savingFolder) return;
    setEditingFolder(null);
    setEditFolderName('');
    setEditFolderDescription('');
    setEditFolderError('');
  };

  const handleSaveFolder = async () => {
    if (!editingFolder) return;

    const name = editFolderName.trim();
    const description = editFolderDescription.trim();

    if (!name) {
      setEditFolderError('请输入文件夹名称');
      return;
    }

    if (data.folders.some((folder) => folder.id !== editingFolder.id && folder.name === name)) {
      setEditFolderError('已存在同名文件夹');
      return;
    }

    setSavingFolder(true);
    setEditFolderError('');
    try {
      await updateFavoriteFolder(editingFolder.id, name, description || undefined);
      await refresh();
      setEditingFolder(null);
      setEditFolderName('');
      setEditFolderDescription('');
    } catch (err) {
      setEditFolderError(err instanceof Error ? err.message : '保存失败，请稍后重试');
    } finally {
      setSavingFolder(false);
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    await deleteFavoriteFolder(folderId);
    setDeletingFolderId(null);
    if (activeFolder === folderId) {
      setActiveFolder('default');
    }
    await refresh();
  };

  const handleLocalize = async (item: FavoriteItem) => {
    const imageUrl = item.source_url || item.preview_url;
    if (!imageUrl) return;
    const filename = `${safeNameForFile(item.title, 'favorite')}.jpg`;
    const path = await downloadWithProgress(imageUrl, filename);
    if (path) {
      await updateFavorite({ ...item, local_path: path });
      refresh();
    }
  };

  const isLocalized = (item: FavoriteItem): boolean => {
    return !!item.local_path;
  };

  const getItemSrc = (it: FavoriteItem) => {
    return (it.local_path && localPreviewUrl(it.local_path)) || it.preview_url || it.local_path || '';
  };

  const handleOpenViewer = (item: FavoriteItem) => {
    const items = filteredItems.map((it) => ({
      src: (it.local_path && localPreviewUrl(it.local_path)) || it.source_url || it.preview_url || '',
      title: it.title,
      source_url: it.source_url,
      source_type: it.source_type,
      source_name: it.source_name,
      local_path: it.local_path,
      preview_url: it.preview_url,
      tags: it.tags,
    }));
    const index = filteredItems.findIndex((it) => it.id === item.id);
    openViewer(items, Math.max(0, index));
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">收藏</h1>
        <div className="flex items-center gap-2">
          <Button size="sm" variant={isBatchMode ? 'primary' : 'ghost'} onPress={toggleBatchMode}>
            {isBatchMode ? <X size={14} /> : <CheckSquare size={14} />}
            {isBatchMode ? '退出管理' : '批量管理'}
          </Button>
          <Button size="sm" variant="secondary" onPress={() => navigate('/tags')}>
            <Tag size={14} /> 标签管理
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onPress={refresh}><RefreshCw size={14} /> 刷新</Button>
        <Button size="sm" variant="secondary" onPress={async () => { const path = await selectLocalImage(); if (path) { /* add local */ } }}><FolderPlus size={14} /> 添加本地</Button>
        <Button size="sm" variant="secondary" onPress={() => setShowExportModal(true)}><FolderOutput size={14} /> 导出</Button>
        <Button size="sm" variant="ghost" onPress={handleImport} isPending={importing}>
          {({ isPending }) => <>{isPending && <Spinner color="current" size="sm" />} <Import size={14} /> {isPending ? '导入中...' : '导入'}</>}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {[{ id: 'all', name: '全部' }, ...data.folders].map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={activeFolder === f.id ? 'primary' : 'ghost'}
            onPress={() => { setActiveFolder(f.id); setSelectedIds(new Set()); }}
          >
            {f.name}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onPress={openCreateFolderModal}><FolderPlus size={14} /> 新建</Button>
      </div>

      {activeFolderMeta && (
        <Card className="p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="text-sm font-medium">{activeFolderMeta.name}</div>
              {activeFolderMeta.description ? (
                <Description className="text-sm text-muted break-words">{activeFolderMeta.description}</Description>
              ) : (
                <Description className="text-sm text-muted">当前收藏夹暂无描述</Description>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" isIconOnly aria-label="编辑收藏夹" onPress={() => openEditFolderModal(activeFolderMeta)}>
                <FilePenLine size={14} />
              </Button>
              {activeFolderMeta.id !== 'default' && (
                <Button
                  size="sm"
                  variant="ghost"
                  isIconOnly
                  aria-label="删除收藏夹"
                  className="text-danger"
                  onPress={() => setDeletingFolderId(activeFolderMeta.id)}
                >
                  <Trash2 size={14} />
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {loading ? <div className="py-10"><Spinner size="sm" /></div> : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredItems.map((item) => {
            const selected = selectedIds.has(item.id);
            return (
              <Card
                key={item.id}
                className={`overflow-hidden transition-shadow ${selected ? 'ring-1 ring-accent ring-inset' : ''}`}
                onClick={() => {
                  if (isBatchMode) {
                    toggleSelection(item.id);
                  } else {
                    handleOpenViewer(item);
                  }
                }}
              >
                <div className="relative h-[160px] w-full overflow-hidden bg-surface-secondary">
                  {isBatchMode && (
                    <div className="absolute top-2 left-2 z-10 pointer-events-none">
                      <Checkbox isSelected={selected} onChange={() => toggleSelection(item.id)} aria-label={`选择 ${item.title}`}>
                        <Checkbox.Content>
                          <Checkbox.Control className="size-5 bg-surface shadow-sm">
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                        </Checkbox.Content>
                      </Checkbox>
                    </div>
                  )}
                  <img
                    src={getItemSrc(item)}
                    alt={item.title}
                    className="h-full w-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  {isLocalized(item) && (
                    <Chip size="sm" color="success" variant="primary" className="absolute top-2 right-2">
                      <Chip.Label>本地</Chip.Label>
                    </Chip>
                  )}
                </div>
                <Card.Header className="pb-0">
                  <Card.Title className="text-sm">{item.title}</Card.Title>
                </Card.Header>
                <Card.Content className="space-y-1 pt-0">
                  <TagList tags={item.tags} max={3} className="pl-1" />
                  {item.description && (
                    <div className="line-clamp-1 text-xs text-muted" title={item.description}>
                      {item.description}
                    </div>
                  )}
                  <div className="text-xs text-muted">来源: {item.source_type}</div>
                </Card.Content>
                {!isBatchMode && (
                  <Card.Footer className="flex flex-wrap gap-1">
                    <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onPress={() => item.local_path && setWallpaper(item.local_path)}><ImageIcon size={12} /> 壁纸</Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onPress={() => openEditDrawer(item)}><Pencil size={12} /> 编辑</Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" isDisabled={isLocalized(item)} onPress={() => handleLocalize(item)}><Globe size={12} /> 本地化</Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-danger" onPress={() => setDeleteConfirmId(item.id)}><Trash2 size={12} /> 删除</Button>
                  </Card.Footer>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {filteredItems.length === 0 && !loading && (
        <div className="py-20 text-center text-muted">此文件夹暂无收藏</div>
      )}

      {isBatchMode && (
        <Toolbar
          isAttached
          aria-label="批量操作"
          className="fixed bottom-16 left-1/2 z-[100] -translate-x-1/2 flex-wrap shadow-lg"
        >
          <ButtonGroup variant="tertiary">
            <Checkbox isSelected={allSelected} isIndeterminate={someSelected} onChange={toggleSelectAll} aria-label={allSelected ? '取消全选' : '全选'}>
              <Checkbox.Content>
                <Checkbox.Control className="size-5 ml-2">
                  <Checkbox.Indicator />
                </Checkbox.Control>
              </Checkbox.Content>
            </Checkbox>
            <Button size="sm" variant="ghost" isDisabled className="text-muted">
              已选 {selectedItems.length} / {filteredItems.length}
            </Button>
          </ButtonGroup>
          <Separator orientation="vertical" />
          <ButtonGroup variant="tertiary">
            <Button size="sm" variant="secondary" isDisabled={selectedItems.length === 0} onPress={() => setShowBatchMoveModal(true)}>
              <FolderInput size={14} /> 移动
            </Button>
            <Button size="sm" variant="secondary" isDisabled={selectedItems.length === 0} onPress={handleBatchExport}>
              <FolderOutput size={14} /> 导出
            </Button>
          </ButtonGroup>
          <Separator orientation="vertical" />
          <ButtonGroup variant="tertiary">
            <Button size="sm" variant="danger" isDisabled={selectedItems.length === 0} onPress={() => { if (selectedItems.length > 0) setDeleteConfirmId('__batch__'); }}>
              <Trash2 size={14} /> 删除
            </Button>
          </ButtonGroup>
          <Separator orientation="vertical" />
          <ButtonGroup variant="tertiary">
            <Button size="sm" variant="ghost" onPress={toggleBatchMode}>
              <X size={14} /> 退出
            </Button>
          </ButtonGroup>
        </Toolbar>
      )}

      <FavoriteTransferModal
        isOpen={showExportModal}
        onOpenChange={setShowExportModal}
        activeFolder={activeFolder}
        folders={data.folders}
        items={data.items}
        selectedIds={selectedIds}
        onExport={exportFavorites}
      />

      <Drawer.Backdrop isOpen={!!editingItem} onOpenChange={(open) => { if (!open) closeEditDrawer(); }}>
        <Drawer.Content placement="right">
          <Drawer.Dialog>
            <Drawer.CloseTrigger />
            <Drawer.Header>
              <Drawer.Heading>编辑收藏</Drawer.Heading>
            </Drawer.Header>
            <Drawer.Body>
              <div className="space-y-5">
                <div className="relative w-full overflow-hidden rounded-lg bg-surface-secondary" style={{ maxHeight: 240 }}>
                  {editingItem && (
                    <img
                      src={getItemSrc(editingItem)}
                      alt={editTitle}
                      className="w-full object-contain"
                      style={{ maxHeight: 240 }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                </div>

                <TextField className="w-full" value={editTitle} onChange={(value) => setEditTitle(String(value))}>
                  <Label>标题</Label>
                  <Input placeholder="输入标题" />
                </TextField>

                <TextField className="w-full" value={editDescription} onChange={(value) => setEditDescription(String(value))}>
                  <Label>描述</Label>
                  <TextArea placeholder="输入描述..." rows={3} />
                </TextField>

                <Select
                  className="w-full"
                  placeholder="选择文件夹"
                  value={editFolderId}
                  onChange={(key) => setEditFolderId(String(key))}
                >
                  <Label>所属文件夹</Label>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {folderOptions.map((f) => (
                        <ListBox.Item key={f.id} id={f.id} textValue={f.name}>
                          <div className="flex items-center gap-2">
                            <FolderOpen size={14} className="text-muted" />
                            {f.name}
                          </div>
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>标签</Label>
                    <Button size="sm" variant="ghost" onPress={() => setShowTagManagerModal(true)}>
                      <Settings2 size={14} /> 管理标签
                    </Button>
                  </div>
                  <Autocomplete
                    allowsEmptyCollection
                    className="w-full"
                    placeholder="选择或搜索标签"
                    selectionMode="multiple"
                    value={editSelectedTagKeys}
                    onChange={(keys) => setEditSelectedTagKeys(keys as Key[])}
                  >
                    <Autocomplete.Trigger>
                      <Autocomplete.Value>
                        {({defaultChildren, isPlaceholder, state}) => {
                          if (isPlaceholder || state.selectedItems.length === 0) {
                            return defaultChildren;
                          }

                          const selectedItemsKeys = state.selectedItems.map((item) => item.key);

                          return (
                            <TagGroup
                              size="sm"
                              onRemove={(keys) => setEditSelectedTagKeys((prev) => prev.filter((key) => !keys.has(key)))}
                            >
                              <TagGroup.List>
                                {selectedItemsKeys.map((selectedItemKey) => {
                                  const raw = String(selectedItemKey);
                                  const label = raw.startsWith('__new__') ? raw.slice(7) : raw;
                                  return (
                                    <HeroTag key={selectedItemKey} id={selectedItemKey}>
                                      {label}
                                    </HeroTag>
                                  );
                                })}
                              </TagGroup.List>
                            </TagGroup>
                          );
                        }}
                      </Autocomplete.Value>
                      <Autocomplete.ClearButton />
                      <Autocomplete.Indicator />
                    </Autocomplete.Trigger>
                    <Autocomplete.Popover>
                      <Autocomplete.Filter filter={contains}>
                        <SearchField autoFocus name="search" variant="secondary" value={tagSearchText} onChange={(value) => setTagSearchText(String(value))}>
                          <SearchField.Group>
                            <SearchField.SearchIcon />
                            <SearchField.Input placeholder="搜索标签..." />
                            <SearchField.ClearButton />
                          </SearchField.Group>
                        </SearchField>
                        <ListBox
                          renderEmptyState={() => (
                            <EmptyState>
                              <div className="flex flex-col items-center gap-2 p-2">
                                <span className="text-sm text-muted">未找到标签 "{tagSearchText}"</span>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  isDisabled={!tagSearchText.trim()}
                                  onPress={() => handleCreateTag(tagSearchText.trim())}
                                >
                                  <Plus size={12} /> 创建 "{tagSearchText.trim() || '新标签'}"
                                </Button>
                              </div>
                            </EmptyState>
                          )}
                        >
                          {tagOptions.map((item) => (
                            <ListBox.Item key={item.id} id={item.id} textValue={item.name}>
                              {item.name}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Autocomplete.Filter>
                    </Autocomplete.Popover>
                  </Autocomplete>
                </div>

                {editingItem && (
                  <div className="rounded-lg bg-surface-secondary p-3 text-xs text-muted space-y-1">
                    <div>来源类型: {editingItem.source_type}</div>
                    {editingItem.local_path && (
                      <div className="break-all" title={editingItem.local_path}>
                        本地路径: {editingItem.local_path}
                      </div>
                    )}
                    <div>创建时间: {new Date(editingItem.created_at).toLocaleString()}</div>
                  </div>
                )}
              </div>
            </Drawer.Body>
            <Drawer.Footer>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onPress={closeEditDrawer}>取消</Button>
                <Button onPress={handleSaveEdit}>保存</Button>
              </div>
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>

      {/* 标签管理 Modal */}
      <Modal.Backdrop isOpen={showTagManagerModal} onOpenChange={(open) => !open && setShowTagManagerModal(false)}>
        <Modal.Container size="cover">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>标签管理</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <TagManager onRefresh={refresh} />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      {/* 新建收藏夹 Modal */}
      <Modal.Backdrop isOpen={showCreateFolderModal} onOpenChange={(open) => { if (!open) closeCreateFolderModal(); }}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
                <FolderPlus size={20} />
              </Modal.Icon>
              <Modal.Heading>新建收藏夹</Modal.Heading>
              <p className="text-sm text-muted">为常用壁纸建立一个独立分组，之后可以在收藏页快速筛选。</p>
            </Modal.Header>
            <Modal.Body>
              <div className="space-y-4">
                <TextField
                  isRequired
                  isInvalid={!!createFolderError}
                  className="w-full"
                  value={newFolderName}
                  onChange={(value) => {
                    setNewFolderName(String(value));
                    if (createFolderError) setCreateFolderError('');
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      handleCreateFolder();
                    }
                  }}
                >
                  <Label>文件夹名称</Label>
                  <Input autoFocus placeholder="例如：自然风景" />
                  {createFolderError ? <FieldError>{createFolderError}</FieldError> : <Description>名称会显示在收藏分类列表中</Description>}
                </TextField>

                <TextField
                  className="w-full"
                  value={newFolderDescription}
                  onChange={(value) => setNewFolderDescription(String(value))}
                >
                  <Label>描述</Label>
                  <TextArea placeholder="可选，用于记录这个收藏夹的用途" rows={3} />
                </TextField>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={closeCreateFolderModal} isDisabled={creatingFolder}>取消</Button>
              <Button onPress={handleCreateFolder} isDisabled={!newFolderName.trim()} isPending={creatingFolder}>
                {({isPending}) => (
                  <>
                    {isPending && <Spinner color="current" size="sm" />}
                    {isPending ? '创建中...' : '创建'}
                  </>
                )}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <Modal.Backdrop isOpen={!!editingFolder} onOpenChange={(open) => { if (!open) closeEditFolderModal(); }}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
                <FilePenLine size={20} />
              </Modal.Icon>
              <Modal.Heading>编辑收藏夹</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="space-y-4">
                <TextField
                  isRequired
                  isInvalid={!!editFolderError}
                  className="w-full"
                  value={editFolderName}
                  onChange={(value) => {
                    setEditFolderName(String(value));
                    if (editFolderError) setEditFolderError('');
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      handleSaveFolder();
                    }
                  }}
                >
                  <Label>文件夹名称</Label>
                  <Input autoFocus placeholder="输入收藏夹名称" />
                  {editFolderError ? <FieldError>{editFolderError}</FieldError> : <Description>可修改展示名称和分类说明</Description>}
                </TextField>

                <TextField
                  className="w-full"
                  value={editFolderDescription}
                  onChange={(value) => setEditFolderDescription(String(value))}
                >
                  <Label>描述</Label>
                  <TextArea placeholder="可选，显示在分类选择下方" rows={3} />
                </TextField>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={closeEditFolderModal} isDisabled={savingFolder}>取消</Button>
              <Button onPress={handleSaveFolder} isDisabled={!editFolderName.trim()} isPending={savingFolder}>
                {({isPending}) => (
                  <>
                    {isPending && <Spinner color="current" size="sm" />}
                    {isPending ? '保存中...' : '保存'}
                  </>
                )}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      {/* 批量移动 Modal */}
      <Modal.Backdrop isOpen={showBatchMoveModal} onOpenChange={(open) => !open && setShowBatchMoveModal(false)}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>批量移动</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="space-y-3">
                <p className="text-sm text-muted">已选择 {selectedItems.length} 条收藏</p>
                <Select
                  className="w-full"
                  placeholder="选择目标文件夹"
                  value={batchMoveFolderId}
                  onChange={(key) => setBatchMoveFolderId(String(key))}
                >
                  <Label>目标文件夹</Label>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {folderOptions.map((f) => (
                        <ListBox.Item key={f.id} id={f.id} textValue={f.name}>
                          <div className="flex items-center gap-2">
                            <FolderOpen size={14} className="text-muted" />
                            {f.name}
                          </div>
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={() => setShowBatchMoveModal(false)}>取消</Button>
              <Button onPress={handleBatchMove} isDisabled={!batchMoveFolderId}>移动</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      {/* 删除确认 Modal */}
      <Modal.Backdrop isOpen={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Icon className="bg-danger-soft text-danger">
                <AlertTriangle size={20} />
              </Modal.Icon>
              <Modal.Heading>确认删除</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {deleteConfirmId === '__batch__' ? (
                <>
                  <p>确定要删除选中的 <strong>{selectedItems.length}</strong> 条收藏吗？</p>
                  <p className="text-sm text-muted">删除后不可恢复。</p>
                </>
              ) : (
                <>
                  <p>确定要删除这条收藏吗？</p>
                  <p className="text-sm text-muted">删除后不可恢复。</p>
                </>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" slot="close" onPress={() => setDeleteConfirmId(null)}>取消</Button>
              <Button variant="danger" onPress={() => {
                if (deleteConfirmId === '__batch__') {
                  handleBatchDelete();
                } else if (deleteConfirmId) {
                  handleDelete(deleteConfirmId);
                }
              }}>删除</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <Modal.Backdrop isOpen={!!deletingFolderId} onOpenChange={(open) => !open && setDeletingFolderId(null)}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Icon className="bg-danger-soft text-danger">
                <AlertTriangle size={20} />
              </Modal.Icon>
              <Modal.Heading>删除收藏夹</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p>确定要删除收藏夹 <strong>{data.folders.find((folder) => folder.id === deletingFolderId)?.name}</strong> 吗？</p>
              <p className="text-sm text-muted">该收藏夹中的项目会自动移动到默认收藏夹，操作不可撤销。</p>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={() => setDeletingFolderId(null)}>取消</Button>
              <Button variant="danger" onPress={() => deletingFolderId && handleDeleteFolder(deletingFolderId)}>删除</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
