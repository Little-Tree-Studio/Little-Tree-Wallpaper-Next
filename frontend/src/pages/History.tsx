import { useState, useEffect } from 'react';
import { Card, Button } from '@heroui/react';
import { ArrowLeft, Image as ImageIcon, Clock } from 'lucide-react';
import { getHistory, setWallpaper } from '@/api/backend';

export default function History() {
  const [history, setHistory] = useState<{ path: string; title: string; reason: string; time: string }[]>([]);

  useEffect(() => {
    getHistory().then((h) => setHistory(h));
  }, []);

  const reasonText = (r: string) => {
    const map: Record<string, string> = { startup: '启动更换', refresh: '手动刷新', set: '手动设置' };
    return map[r] || r;
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <Button isIconOnly variant="ghost" onPress={() => window.history.back()}><ArrowLeft size={18} /></Button>
        <h1 className="text-2xl font-bold">历史记录</h1>
      </div>

      <div className="space-y-3">
        {history.map((item, idx) => (
          <Card key={idx} className="flex items-center gap-4 p-4">
            <div className="h-[80px] w-[120px] shrink-0 overflow-hidden rounded-lg bg-surface-secondary">
              <img
                src={`file://${item.path}`}
                alt={item.title}
                className="h-full w-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            </div>
            <div className="flex-1">
              <div className="font-medium">{item.title}</div>
              <div className="text-xs text-muted">原因: {reasonText(item.reason)}</div>
              <div className="text-xs text-muted">时间: {new Date(item.time).toLocaleString()}</div>
              <div className="text-xs text-muted truncate max-w-md">路径: {item.path}</div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onPress={() => setWallpaper(item.path)}><ImageIcon size={14} /> 设为壁纸</Button>
            </div>
          </Card>
        ))}
      </div>

      {history.length === 0 && (
        <Card className="flex flex-col items-center justify-center py-20">
          <Clock size={48} className="mb-4 text-muted" />
          <p className="text-muted">暂无历史记录</p>
        </Card>
      )}
    </div>
  );
}
