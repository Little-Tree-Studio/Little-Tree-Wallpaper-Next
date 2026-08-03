import { useNavigate } from '@/lib/router';
import { ArrowLeft, SlidersHorizontal } from 'lucide-react';
import { Button } from '@heroui/react';
import WallpaperSourcesPanel from '@/components/WallpaperSourcesPanel';

export default function WallpaperSourceManagement() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center gap-2">
        <Button isIconOnly size="sm" variant="ghost" onPress={() => navigate('/resource?tab=sources')} aria-label="返回壁纸源">
          <ArrowLeft size={18} />
        </Button>
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={20} />
          <h1 className="text-2xl font-bold">壁纸源管理</h1>
        </div>
      </div>
      <p className="text-sm text-muted">导入、创建、导出、启用或删除壁纸源。</p>
      <WallpaperSourcesPanel mode="management" />
    </div>
  );
}
