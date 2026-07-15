import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Description,
  Label,
  ListBox,
  Modal,
  Select,
  Slider,
  Spinner,
  Switch,
  toast,
} from '@heroui/react';
import { Archive, FolderOpen, PackageOpen } from 'lucide-react';
import type { FavoriteExportOptions, FavoriteExportResult } from '@/api/backend';
import type { FavoriteFolder, FavoriteItem } from '@/types';

interface FavoriteTransferModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  activeFolder: string;
  folders: FavoriteFolder[];
  items: FavoriteItem[];
  selectedIds: Set<string>;
  onExport: (options: FavoriteExportOptions) => Promise<FavoriteExportResult>;
}

type ExportScope = FavoriteExportOptions['scope'];

export default function FavoriteTransferModal({
  isOpen,
  onOpenChange,
  activeFolder,
  folders,
  items,
  selectedIds,
  onExport,
}: FavoriteTransferModalProps) {
  const [scope, setScope] = useState<ExportScope>('folder');
  const [includeLocalData, setIncludeLocalData] = useState(true);
  const [compression, setCompression] = useState(true);
  const [compressionLevel, setCompressionLevel] = useState(6);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setScope(selectedIds.size > 0 ? 'selected' : activeFolder === 'all' ? 'all' : 'folder');
    setIncludeLocalData(true);
    setCompression(true);
    setCompressionLevel(6);
  }, [activeFolder, isOpen, selectedIds.size]);

  const scopeItems = useMemo(() => {
    if (scope === 'selected') return items.filter((item) => selectedIds.has(item.id));
    if (scope === 'folder' && activeFolder !== 'all') {
      return items.filter((item) => item.folder_id === activeFolder);
    }
    return items;
  }, [activeFolder, items, scope, selectedIds]);

  const localCount = scopeItems.filter((item) => item.local_path).length;
  const selectedFolder = folders.find((folder) => folder.id === activeFolder);
  const scopeDescription = scope === 'selected'
    ? '只导出批量管理中勾选的收藏'
    : scope === 'folder'
      ? `导出当前文件夹${selectedFolder ? `“${selectedFolder.name}”` : ''}中的全部收藏`
      : '导出所有文件夹和收藏';

  const handleExport = async () => {
    if (scopeItems.length === 0) return;
    setExporting(true);
    try {
      const result = await onExport({
        scope,
        folder_id: scope === 'folder' && activeFolder !== 'all' ? activeFolder : undefined,
        item_ids: scope === 'selected' ? scopeItems.map((item) => item.id) : undefined,
        include_local_data: includeLocalData,
        compression,
        compression_level: compressionLevel,
      });
      const localMessage = includeLocalData
        ? `，已打包 ${result.local_file_count} 个本地文件${result.missing_local_count ? `，${result.missing_local_count} 个文件未找到` : ''}`
        : '';
      toast.success(`已导出 ${result.item_count} 条收藏${localMessage}`, { description: result.path, timeout: 5000 });
      onOpenChange(false);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : '导出收藏失败', { timeout: 0 });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={(open) => !open && !exporting && onOpenChange(false)}>
      <Modal.Container size="sm">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
              <Archive size={20} />
            </Modal.Icon>
            <Modal.Heading>导出收藏</Modal.Heading>
            <p className="text-sm text-muted">选择要保存的内容和归档方式。</p>
          </Modal.Header>
          <Modal.Body>
            <div className="space-y-5">
              <Select
                className="w-full"
                value={scope}
                onChange={(key) => setScope(String(key) as ExportScope)}
                isDisabled={exporting}
              >
                <Label>导出范围</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="selected" textValue="已选收藏" isDisabled={selectedIds.size === 0}>
                      <div className="flex items-center gap-2"><PackageOpen size={14} /> 已选收藏 ({selectedIds.size})</div>
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    <ListBox.Item id="folder" textValue="当前文件夹" isDisabled={activeFolder === 'all'}>
                      <div className="flex items-center gap-2"><FolderOpen size={14} /> 当前文件夹</div>
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    <ListBox.Item id="all" textValue="全部收藏">
                      <div className="flex items-center gap-2"><PackageOpen size={14} /> 全部收藏 ({items.length})</div>
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
              <Description className="-mt-3 text-xs text-muted">{scopeDescription}，共 {scopeItems.length} 条。</Description>

              <Checkbox isSelected={includeLocalData} onChange={setIncludeLocalData} isDisabled={exporting}>
                <Checkbox.Content>
                  <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
                  包含本地化数据
                </Checkbox.Content>
                <Description>将已下载的本地图片一并写入归档，当前范围可用 {localCount} 个。</Description>
              </Checkbox>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">压缩归档</div>
                    <Description>关闭后使用存储模式，文件更快生成。</Description>
                  </div>
                  <Switch aria-label="压缩归档" isSelected={compression} onChange={setCompression} isDisabled={exporting}>
                    <Switch.Content>
                      <Switch.Control><Switch.Thumb /></Switch.Control>
                    </Switch.Content>
                  </Switch>
                </div>
                {compression && (
                  <div>
                    <Slider
                      minValue={1}
                      maxValue={9}
                      step={1}
                      value={compressionLevel}
                      onChange={(value) => setCompressionLevel(Number(value))}
                      isDisabled={exporting}
                    >
                      <Label>压缩级别</Label>
                      <Slider.Output />
                      <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
                    </Slider>
                    <Description>1 更快，9 更小，默认使用 6。</Description>
                  </div>
                )}
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" onPress={() => onOpenChange(false)} isDisabled={exporting}>取消</Button>
            <Button onPress={handleExport} isDisabled={scopeItems.length === 0 || exporting} isPending={exporting}>
              {({ isPending }) => <>{isPending && <Spinner color="current" size="sm" />} {isPending ? '导出中...' : '开始导出'}</>}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
