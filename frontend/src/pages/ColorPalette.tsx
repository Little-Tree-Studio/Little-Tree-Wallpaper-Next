import { useState, useMemo } from 'react';
import type { Color, ColorSpace } from '@heroui/react';
import {
  Card, Button, ColorArea, ColorSwatch, ColorField, Label, parseColor,
  Select, ListBox,
} from '@heroui/react';
import { ArrowLeft, Copy, Check } from 'lucide-react';
import { useNavigate } from '@/lib/router';

type ColorChannel = 'hue' | 'saturation' | 'brightness' | 'lightness' | 'red' | 'green' | 'blue';

interface ChannelOption {
  id: ColorChannel;
  name: string;
}

const colorSpaces: Array<{ id: ColorSpace; name: string }> = [
  { id: 'rgb', name: 'RGB' },
  { id: 'hsl', name: 'HSL' },
  { id: 'hsb', name: 'HSB' },
];

const channelsBySpace: Record<ColorSpace, ChannelOption[]> = {
  hsb: [
    { id: 'hue', name: '色相' },
    { id: 'saturation', name: '饱和度' },
    { id: 'brightness', name: '亮度' },
  ],
  hsl: [
    { id: 'hue', name: '色相' },
    { id: 'saturation', name: '饱和度' },
    { id: 'lightness', name: '明度' },
  ],
  rgb: [
    { id: 'red', name: '红' },
    { id: 'green', name: '绿' },
    { id: 'blue', name: '蓝' },
  ],
};

function getDefaultChannels(space: ColorSpace) {
  if (space === 'rgb') return { x: 'blue' as ColorChannel, y: 'green' as ColorChannel };
  if (space === 'hsl') return { x: 'saturation' as ColorChannel, y: 'lightness' as ColorChannel };
  return { x: 'saturation' as ColorChannel, y: 'brightness' as ColorChannel };
}

export default function ColorPalette() {
  const navigate = useNavigate();
  const [color, setColor] = useState<Color>(parseColor('#7C3AED'));
  const [copied, setCopied] = useState<string | null>(null);

  const [colorSpace, setColorSpace] = useState<ColorSpace>('hsb');
  const defaults = getDefaultChannels(colorSpace);
  const [xChannel, setXChannel] = useState<ColorChannel>(defaults.x);
  const [yChannel, setYChannel] = useState<ColorChannel>(defaults.y);

  const channels = channelsBySpace[colorSpace];
  const xChannelOptions = useMemo(() => channels.filter((c) => c.id !== yChannel), [channels, yChannel]);
  const yChannelOptions = useMemo(() => channels.filter((c) => c.id !== xChannel), [channels, xChannel]);

  const handleColorSpaceChange = (key: string | null) => {
    if (!key) return;
    const space = key as ColorSpace;
    setColorSpace(space);
    const d = getDefaultChannels(space);
    setXChannel(d.x);
    setYChannel(d.y);
  };

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // ignore
    }
  };

  const hexValue = color.toString('hex');
  const rgbValue = color.toString('rgb');
  const hslValue = color.toString('hsl');

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-2">
        <Button isIconOnly variant="ghost" onPress={() => navigate('/tools')}>
          <ArrowLeft size={18} />
        </Button>
        <h1 className="text-2xl font-bold">调色盘</h1>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="space-y-4 p-4">
          <Card.Header>
            <Card.Title>颜色选择器</Card.Title>
            <Card.Description>在颜色区域中拖动选择颜色</Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col items-center gap-4">
            {/* Color Space */}
            <Select
              className="w-full"
              selectedKey={colorSpace}
              onSelectionChange={(key) => handleColorSpaceChange(String(key || ''))}
            >
              <Label>颜色空间</Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {colorSpaces.map((space) => (
                    <ListBox.Item key={space.id} id={space.id} textValue={space.name}>
                      {space.name}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>

            {/* Color Area */}
            <ColorArea
              colorSpace={colorSpace}
              value={color}
              xChannel={xChannel}
              yChannel={yChannel}
              onChange={setColor}
              className="h-[200px] w-full rounded-xl"
            >
              <ColorArea.Thumb />
            </ColorArea>

            {/* Channel Selectors */}
            <div className="flex w-full gap-3">
              <Select
                className="flex-1"
                selectedKey={xChannel}
                onSelectionChange={(key) => key && setXChannel(String(key) as ColorChannel)}
              >
                <Label>X 轴</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {xChannelOptions.map((channel) => (
                      <ListBox.Item key={channel.id} id={channel.id} textValue={channel.name}>
                        {channel.name}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>

              <Select
                className="flex-1"
                selectedKey={yChannel}
                onSelectionChange={(key) => key && setYChannel(String(key) as ColorChannel)}
              >
                <Label>Y 轴</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {yChannelOptions.map((channel) => (
                      <ListBox.Item key={channel.id} id={channel.id} textValue={channel.name}>
                        {channel.name}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>

            <ColorField
              className="w-full"
              value={color}
              onChange={(c) => c && setColor(c)}
            >
              <Label>颜色值</Label>
              <ColorField.Group>
                <ColorField.Prefix>
                  <ColorSwatch color={color} size="xs" />
                </ColorField.Prefix>
                <ColorField.Input />
              </ColorField.Group>
            </ColorField>
          </Card.Content>
        </Card>

        <Card className="space-y-4 p-4">
          <Card.Header>
            <Card.Title>颜色信息</Card.Title>
            <Card.Description>点击复制颜色值</Card.Description>
          </Card.Header>
          <Card.Content className="space-y-3">
            <div className="flex items-center gap-3">
              <ColorSwatch color={color} size="lg" />
              <div className="flex-1">
                <div className="text-sm font-medium">预览</div>
                <div className="text-xs text-muted">{hexValue}</div>
              </div>
            </div>

            <CopyRow
              label="HEX"
              value={hexValue}
              copied={copied === 'hex'}
              onCopy={() => handleCopy(hexValue, 'hex')}
            />
            <CopyRow
              label="RGB"
              value={rgbValue}
              copied={copied === 'rgb'}
              onCopy={() => handleCopy(rgbValue, 'rgb')}
            />
            <CopyRow
              label="HSL"
              value={hslValue}
              copied={copied === 'hsl'}
              onCopy={() => handleCopy(hslValue, 'hsl')}
            />
          </Card.Content>
        </Card>
      </div>

      <Card className="p-4">
        <Card.Header>
          <Card.Title>常用颜色</Card.Title>
        </Card.Header>
        <Card.Content>
          <div className="flex flex-wrap gap-2">
            {presetColors.map((c) => (
              <Button
                key={c}
                isIconOnly
                variant="ghost"
                className="h-10 w-10 rounded-lg border border-border transition-transform hover:scale-110"
                style={{ backgroundColor: c }}
                onPress={() => setColor(parseColor(c))}
                aria-label={c}
              />
            ))}
          </div>
        </Card.Content>
      </Card>
    </div>
  );
}

function CopyRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-surface-secondary px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted w-10">{label}</span>
        <code className="text-sm">{value}</code>
      </div>
      <Button
        isIconOnly
        variant="ghost"
        size="sm"
        onPress={onCopy}
        aria-label={`复制 ${label}`}
      >
        {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
      </Button>
    </div>
  );
}

const presetColors = [
  '#EF4444', '#F97316', '#F59E0B', '#84CC16', '#22C55E',
  '#10B981', '#14B8A6', '#06B6D4', '#0EA5E9', '#3B82F6',
  '#6366F1', '#8B5CF6', '#A855F7', '#D946EF', '#EC4899',
  '#F43F5E', '#000000', '#374151', '#9CA3AF', '#FFFFFF',
];
