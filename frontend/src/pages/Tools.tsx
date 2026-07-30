import { Card } from '@heroui/react';
import { Palette, ArrowRight, MonitorPlay } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface ToolItem {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  path: string;
}

const tools: ToolItem[] = [
  {
    id: 'color-palette',
    title: '调色盘',
    description: '使用 ColorArea 组件选择颜色，支持 RGB、HSL、HSB 等多种颜色空间',
    icon: Palette,
    path: '/tools/color-palette',
  },
  {
    id: 'dynamic-wallpaper',
    title: '动态壁纸调试台',
    description: '探测 Windows WorkerW，加载本地视频并观察桌面宿主状态',
    icon: MonitorPlay,
    path: '/tools/dynamic-wallpaper',
  },
];

export default function Tools() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">工具</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((tool) => {
          const Icon = tool.icon;
          return (
            <Card
              key={tool.id}
              className="cursor-pointer transition-all hover:shadow-md hover:scale-[1.02]"
              variant="secondary"
              onClick={() => navigate(tool.path)}
            >
              <Card.Header>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                    <Icon size={22} />
                  </div>
                  <div>
                    <Card.Title>{tool.title}</Card.Title>
                    <Card.Description className="line-clamp-2">{tool.description}</Card.Description>
                  </div>
                </div>
              </Card.Header>
              <Card.Footer className="flex justify-end">
                <span className="flex items-center gap-1 text-sm text-primary">
                  进入 <ArrowRight size={14} />
                </span>
              </Card.Footer>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
