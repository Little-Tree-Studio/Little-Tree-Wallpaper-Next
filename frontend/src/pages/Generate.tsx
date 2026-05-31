import { Card } from '@heroui/react';
import { Sparkles } from 'lucide-react';

export default function Generate() {
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-bold">生成</h1>
      <Card className="flex flex-col items-center justify-center py-20">
        <Sparkles size={48} className="mb-4 text-muted" />
        <p className="text-lg text-muted">暂无可用的生成接口</p>
        <p className="mt-2 text-sm text-muted">插件可以注册自定义的图像生成接口</p>
      </Card>
    </div>
  );
}
