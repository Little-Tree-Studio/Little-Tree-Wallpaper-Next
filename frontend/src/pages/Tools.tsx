import { Card } from '@heroui/react';
import type { ElementType } from 'react';
import { ArrowRight, Clock3, Image, Palette, Settings2, SwatchBook, Tags, Wrench } from 'lucide-react';
import { useNavigate } from '@/lib/router';

interface ToolItem {
  id: string;
  title: string;
  description: string;
  icon: ElementType;
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
    id: 'image-editor',
    title: '图片编辑',
    description: '裁剪、调整和导出图片，快速制作适合桌面的壁纸',
    icon: Image,
    path: '/image-editor',
  },
  {
    id: 'zhongguose',
    title: '中国传统色',
    description: '五百二十六种中国传统色，竖排色卡，点击复制 HEX 色值',
    icon: SwatchBook,
    path: '/tools/zhongguose',
  },
  {
    id: 'history',
    title: '壁纸历史',
    description: '查看最近使用过的壁纸，快速恢复或重新应用',
    icon: Clock3,
    path: '/history',
  },
  {
    id: 'tags',
    title: '标签管理',
    description: '整理壁纸标签，让收藏和资源查找更加高效',
    icon: Tags,
    path: '/tags',
  },
  {
    id: 'source-management',
    title: '壁纸来源管理',
    description: '管理在线和本地壁纸来源，控制资源展示内容',
    icon: Settings2,
    path: '/resource/source-management',
  },
];

export default function Tools() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Wrench size={22} className="text-primary" />
          <h1 className="text-2xl font-bold">常用工具</h1>
        </div>
        <p className="mt-1 text-sm text-muted">快速访问壁纸制作、整理和管理功能。</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((tool) => {
          const Icon = tool.icon;
          return (
            <Card
              key={tool.id}
              className="cursor-pointer transition-[transform,box-shadow] duration-150 ease-out hover:shadow-md hover:scale-[1.02] active:scale-[0.98]"
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
