import { useMemo, useState } from 'react';
import { Button, SearchField, toast } from '@heroui/react';
import { ArrowLeft, Copy } from 'lucide-react';
import { useNavigate } from '@/lib/router';
import colorsData from '@/data/zhongguose-colors.json';

interface ZhongguoColor {
  name: string;
  pinyin: string;
  hex: string;
  rgb: [number, number, number];
}

const colors = colorsData as ZhongguoColor[];

const classicalFont = '"Kaiti SC","STKaiti","KaiTi","Noto Serif SC","Source Han Serif SC","SimSun",serif';

function foregroundFor(rgb: [number, number, number]): string {
  const [r, g, b] = rgb;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 160 ? 'rgba(60, 40, 20, 0.88)' : 'rgba(255, 248, 238, 0.94)';
}

function colorToChineseCount(n: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n < 10) return digits[n];
  if (n < 20) return n === 10 ? '十' : `十${digits[n % 10]}`;
  if (n < 100) {
    const ten = Math.floor(n / 10);
    const rest = n % 10;
    return `${digits[ten]}十${rest ? digits[rest] : ''}`;
  }
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  if (rest === 0) return `${digits[hundred]}百`;
  if (rest < 10) return `${digits[hundred]}百零${digits[rest]}`;
  return `${digits[hundred]}百${colorToChineseCount(rest)}`;
}

export default function ZhongguoseColors() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return colors;
    return colors.filter(
      (c) =>
        c.name.includes(query.trim()) ||
        c.pinyin.toLowerCase().includes(q) ||
        c.hex.toLowerCase().includes(q),
    );
  }, [query]);

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`已复制 ${label}`, { timeout: 1500 });
    } catch {
      toast.danger('复制失败', { timeout: 1500 });
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button isIconOnly variant="ghost" onPress={() => navigate('/tools')}>
          <ArrowLeft size={18} />
        </Button>
        <h1 className="text-2xl font-bold" style={{ fontFamily: classicalFont }}>
          中国传统色
        </h1>
        <div className="ms-auto flex w-full items-center gap-3 sm:w-auto">
          <SearchField name="zhongguose-search" value={query} onChange={setQuery} fullWidth aria-label="搜索色名、拼音或 HEX" className="sm:w-64">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="搜索色名 / 拼音 / HEX" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <div
            className="relative flex h-14 w-8 shrink-0 -rotate-1 items-center justify-center bg-[#A03024] text-[#FBF3E4] shadow-md select-none"
            style={{ borderRadius: '5px 4px 6px 4px / 4px 6px 4px 5px' }}
            aria-hidden
          >
            <span
              className="absolute inset-[2px]"
              style={{
                border: '1.5px solid rgba(251, 243, 228, 0.85)',
                borderRadius: '4px 5px 3px 5px / 5px 3px 5px 4px',
              }}
            />
            <span
              className="absolute inset-[5px] bg-[#A03024]"
              style={{ borderRadius: '2px 3px 4px 2px / 3px 2px 3px 4px' }}
            />
            <span
              className="relative text-[11px] leading-none font-bold"
              style={{ writingMode: 'vertical-rl', fontFamily: classicalFont }}
            >
              中国色
            </span>
          </div>
        </div>
      </div>

      <p className="text-sm text-muted" style={{ fontFamily: classicalFont }}>
        凡{colorToChineseCount(filtered.length)}色 · 点击色卡展卷查看详情
      </p>

      {filtered.length === 0 ? (
        <p className="py-16 text-center text-muted" style={{ fontFamily: classicalFont }}>
          未寻得相符之色
        </p>
      ) : (
        <div
          className="flex flex-wrap justify-center gap-x-4 gap-y-6 sm:justify-start"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedKey(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setSelectedKey(null);
          }}
        >
          {filtered.map((color) => {
            const key = `${color.name}-${color.hex}`;
            const expanded = selectedKey === key;
            const fg = foregroundFor(color.rgb);
            const rgbText = `rgb(${color.rgb[0]}, ${color.rgb[1]}, ${color.rgb[2]})`;
            return (
              <button
                key={key}
                type="button"
                title={expanded ? undefined : `${color.name} · ${color.pinyin} · ${color.hex}`}
                aria-expanded={expanded}
                onClick={() => setSelectedKey(expanded ? null : key)}
                className={`group flex h-64 cursor-pointer flex-row items-stretch overflow-hidden rounded-[6px] p-0 ring-1 transition-[width,transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  expanded
                    ? 'w-64 shadow-xl ring-black/20'
                    : 'w-16 shadow-sm ring-black/10 hover:-translate-y-1.5 hover:shadow-xl active:translate-y-0'
                }`}
                style={{ backgroundColor: color.hex, color: fg }}
              >
                <span className="flex w-16 shrink-0 items-center justify-center py-4">
                  <span
                    className={`leading-none select-none ${expanded ? 'text-[19px] tracking-[0.4em]' : 'text-[15px] tracking-[0.35em]'}`}
                    style={{
                      writingMode: 'vertical-rl',
                      fontFamily: classicalFont,
                      transition: 'font-size 300ms cubic-bezier(0.22,1,0.36,1), letter-spacing 300ms cubic-bezier(0.22,1,0.36,1)',
                    }}
                  >
                    {color.name}
                  </span>
                </span>
                <span
                  className="flex w-8 shrink-0 items-center justify-center border-s border-current/15 py-6 transition-opacity duration-200"
                  style={{
                    opacity: expanded ? 1 : 0,
                    transitionDelay: expanded ? '120ms' : '0ms',
                  }}
                >
                  <span
                    className="text-[11px] leading-none italic select-none"
                    style={{
                      writingMode: 'vertical-rl',
                      fontFamily: 'Georgia, "Times New Roman", "Noto Serif", serif',
                      letterSpacing: '0.14em',
                      opacity: 0.85,
                    }}
                  >
                    {color.pinyin}
                  </span>
                </span>
                <span
                  className="flex min-w-0 flex-1 flex-col justify-center gap-3.5 pe-4 ps-3.5 text-start"
                  style={{ pointerEvents: expanded ? 'auto' : 'none' }}
                >
                  {([
                    { label: 'HEX', display: color.hex, copyText: color.hex, delay: 200 },
                    { label: 'RGB', display: color.rgb.join(' · '), copyText: rgbText, delay: 280 },
                  ] as const).map((item) => (
                    <span
                      key={item.label}
                      className="flex flex-col gap-1.5 transition-[opacity,transform] duration-300 ease-out"
                      style={{
                        opacity: expanded ? 1 : 0,
                        transform: expanded ? 'translateY(0)' : 'translateY(6px)',
                        transitionDelay: expanded ? `${item.delay}ms` : '0ms',
                      }}
                    >
                      <span
                        className="text-[10px] font-medium tracking-[0.3em] opacity-60 select-none"
                        style={{ fontFamily: 'Georgia, "Noto Serif", serif' }}
                      >
                        {item.label}
                      </span>
                      <span
                        role="button"
                        tabIndex={expanded ? 0 : -1}
                        className="flex w-fit cursor-pointer items-center gap-1.5 rounded-[3px] px-2 py-1 font-mono text-xs whitespace-nowrap ring-1 ring-current/25 transition-colors hover:bg-current/10 active:bg-current/15"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopy(item.copyText, `${color.name} ${item.copyText}`);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            handleCopy(item.copyText, `${color.name} ${item.copyText}`);
                          }
                        }}
                      >
                        {item.display} <Copy size={11} className="opacity-70" />
                      </span>
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
