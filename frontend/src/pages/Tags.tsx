import { useNavigate } from '@/lib/router';
import { Tag, ArrowLeft } from 'lucide-react';
import { Button } from '@heroui/react';
import TagManager from '@/components/TagManager';

export default function Tags() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center gap-2">
        <Button isIconOnly size="sm" variant="ghost" onPress={() => navigate('/favorite')} aria-label="返回收藏">
          <ArrowLeft size={18} />
        </Button>
        <div className="flex items-center gap-2">
          <Tag size={20} />
          <h1 className="text-2xl font-bold">标签管理</h1>
        </div>
      </div>
      <p className="text-sm text-muted">管理收藏标签，重命名或删除不再使用的标签。</p>
      <TagManager />
    </div>
  );
}
