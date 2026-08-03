import { useCallback, useEffect, useRef, useState } from 'react';
import type { DateValue } from '@internationalized/date';
import { parseDate, today } from '@internationalized/date';
import { useNavigate } from '@/lib/router';
import { Alert, Button, Calendar, Card, DateField, DatePicker, Label, Skeleton } from '@heroui/react';
import { ArrowRight, RefreshCw, Eye, Bookmark, Search } from 'lucide-react';
import { queryPixivelRanking } from '@/api/backend';
import { logError } from '@/lib/log';
import type { PixivelWorkSummary } from '@/types';

type RankMode = 'day' | 'week' | 'month' | 'day_male' | 'day_female';

const MODES: Array<{ id: RankMode; label: string }> = [
  { id: 'day', label: '日榜' },
  { id: 'week', label: '周榜' },
  { id: 'month', label: '月榜' },
  { id: 'day_male', label: '男性日榜' },
  { id: 'day_female', label: '女性日榜' },
];

const MODE_COPY: Record<string, { title: string; description: string }> = {
  day: { title: 'Pixiv 日榜', description: '每日热度最高的插画作品' },
  week: { title: 'Pixiv 周榜', description: '本周最受欢迎的插画作品' },
  month: { title: 'Pixiv 月榜', description: '本月最受欢迎的插画作品' },
  day_male: { title: 'Pixiv 男性向日榜', description: '男性用户偏好的每日热门作品' },
  day_female: { title: 'Pixiv 女性向日榜', description: '女性用户偏好的每日热门作品' },
};

function PixivelGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <Card key={index} className="gap-3 overflow-hidden p-0">
          <Skeleton className="aspect-[4/3] w-full rounded-none" />
          <div className="space-y-2 px-4 pb-4">
            <Skeleton className="h-5 w-4/5 rounded" />
            <Skeleton className="h-4 w-2/5 rounded" />
          </div>
        </Card>
      ))}
    </div>
  );
}

interface PanelCache {
  mode: RankMode;
  works: PixivelWorkSummary[];
  page: number;
  hasMore: boolean;
  scrollY: number;
  updatedAt: number;
  rankingDate: string;
}

let _panelCache: PanelCache | null = null;
const PANEL_CACHE_TTL_MS = 10 * 60 * 1000;

function getScrollTop(): number {
  const container = document.querySelector('[class*="scroll-shadow--vertical"]');
  return container ? container.scrollTop : window.scrollY;
}

function setScrollTop(y: number): void {
  const container = document.querySelector('[class*="scroll-shadow--vertical"]');
  if (container) container.scrollTop = y;
  else window.scrollTo({ top: y });
}

export default function PixivelPanel({ active }: { active: boolean }) {
  const navigate = useNavigate();
  const latestRankingDate = today('Asia/Tokyo').subtract({ days: 1 });
  const initialCacheRef = useRef(
    _panelCache && Date.now() - _panelCache.updatedAt <= PANEL_CACHE_TTL_MS ? _panelCache : null
  );
  const initialCache = initialCacheRef.current;
  const [mode, setMode] = useState<RankMode>(initialCache?.mode ?? 'day');
  const [works, setWorks] = useState<PixivelWorkSummary[]>(initialCache?.works ?? []);
  const [page, setPage] = useState(initialCache?.page ?? 1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(initialCache?.hasMore ?? true);
  const [rankingDate, setRankingDate] = useState(() =>
    parseDate(initialCache?.rankingDate ?? latestRankingDate.toString())
  );
  const [error, setError] = useState('');

  const skipReloadRef = useRef(Boolean(initialCache && initialCache.works.length > 0));
  const updatedAtRef = useRef(initialCache?.updatedAt ?? 0);
  const requestControllerRef = useRef<AbortController | null>(null);
  const stateRef = useRef({ mode, works, page, hasMore, rankingDate: rankingDate.toString() });
  stateRef.current = { mode, works, page, hasMore, rankingDate: rankingDate.toString() };

  const loadPage = useCallback(async (nextPage: number, refresh = false) => {
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    if (nextPage === 1) setLoading(true);
    else setLoadingMore(true);
    setError('');
    try {
      const pageSize = 30;
      const items = await queryPixivelRanking(
        mode,
        nextPage,
        pageSize,
        refresh,
        rankingDate.toString(),
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setWorks((current) => (nextPage === 1 ? items : [...current, ...items]));
      if (nextPage === 1) updatedAtRef.current = Date.now();
      setPage(nextPage);
      setHasMore(items.length >= pageSize);
    } catch (reason) {
      if (controller.signal.aborted) return;
      logError('Pixivel ranking load failed', reason);
      setError(reason instanceof Error ? reason.message : 'Pixiv 排行榜加载失败');
      if (nextPage === 1) setWorks([]);
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [mode, rankingDate]);

  useEffect(() => {
    if (!active) {
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    if (skipReloadRef.current) {
      skipReloadRef.current = false;
      const cachedY = initialCache?.scrollY ?? 0;
      requestAnimationFrame(() => setScrollTop(cachedY));
      return;
    }
    setWorks([]);
    setPage(1);
    setHasMore(true);
    loadPage(1);
  }, [active, loadPage]);

  useEffect(() => {
    return () => {
      requestControllerRef.current?.abort();
      _panelCache = { ...stateRef.current, scrollY: getScrollTop(), updatedAt: updatedAtRef.current };
    };
  }, []);

  const changeMode = (nextMode: RankMode) => {
    requestControllerRef.current?.abort();
    if (nextMode === mode) {
      void loadPage(1, true);
      return;
    }
    setMode(nextMode);
    setWorks([]);
    setPage(1);
    setHasMore(true);
    updatedAtRef.current = 0;
  };

  const changeRankingDate = (value: DateValue | null) => {
    if (!value) return;
    requestControllerRef.current?.abort();
    setRankingDate(parseDate(value.toString()));
    setWorks([]);
    setPage(1);
    setHasMore(true);
    updatedAtRef.current = 0;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{MODE_COPY[mode].title}</h2>
            <p className="text-sm text-muted">
              {MODE_COPY[mode].description}{mode.startsWith('day') ? ' · 暂不支持当日榜单查看' : ''}
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center justify-end gap-1 sm:w-auto">
            <DatePicker
              className="w-[154px] shrink-0"
              maxValue={latestRankingDate}
              name="pixiv-ranking-date"
              value={rankingDate}
              onChange={changeRankingDate}
            >
              <Label className="sr-only">榜单日期</Label>
              <DateField.Group fullWidth variant="secondary">
                <DateField.Input>{(segment) => <DateField.Segment segment={segment} />}</DateField.Input>
                <DateField.Suffix>
                  <DatePicker.Trigger aria-label="选择 Pixiv 榜单日期">
                    <DatePicker.TriggerIndicator />
                  </DatePicker.Trigger>
                </DateField.Suffix>
              </DateField.Group>
              <DatePicker.Popover
                className="w-[292px] max-w-[calc(100vw-32px)] p-2"
                placement="bottom end"
              >
                <Calendar aria-label="Pixiv 榜单日期" maxValue={latestRankingDate}>
                  <Calendar.Header>
                    <Calendar.YearPickerTrigger>
                      <Calendar.YearPickerTriggerHeading />
                      <Calendar.YearPickerTriggerIndicator />
                    </Calendar.YearPickerTrigger>
                    <Calendar.NavButton slot="previous" />
                    <Calendar.NavButton slot="next" />
                  </Calendar.Header>
                  <Calendar.Grid>
                    <Calendar.GridHeader>
                      {(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}
                    </Calendar.GridHeader>
                    <Calendar.GridBody>{(date) => <Calendar.Cell date={date} />}</Calendar.GridBody>
                  </Calendar.Grid>
                  <Calendar.YearPickerGrid>
                    <Calendar.YearPickerGridBody>
                      {({ year }) => <Calendar.YearPickerCell year={year} />}
                    </Calendar.YearPickerGridBody>
                  </Calendar.YearPickerGrid>
                </Calendar>
              </DatePicker.Popover>
            </DatePicker>
            <Button size="sm" variant="secondary" onPress={() => navigate('/search?source=pixiv&api=1')}>
              <Search size={15} /> 前往搜索
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label="刷新 Pixiv 排行榜"
              isDisabled={loading || loadingMore}
              onPress={() => loadPage(1, true)}
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2" aria-label="Pixiv 榜单类型">
          {MODES.map((m) => (
            <Button
              key={m.id}
              size="sm"
              variant={mode === m.id ? 'primary' : 'secondary'}
              onPress={() => changeMode(m.id)}
            >
              {m.label}
            </Button>
          ))}
        </div>
      </div>

      {loading && works.length === 0 ? (
        <PixivelGridSkeleton />
      ) : error && works.length === 0 ? (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Title>无法加载 Pixiv 排行榜</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : works.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted">当前榜单暂无作品</div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {works.map((work) => (
            <Card key={`${mode}-${work.id}`} className="gap-0 overflow-hidden p-0">
              <button
                type="button"
                className="group relative aspect-[4/3] w-full overflow-hidden bg-surface-secondary text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onClick={() => navigate(`/resource/pixivel/${work.id}`)}
                aria-label={`查看作品：${work.title}`}
              >
                <img
                  src={work.preview_url}
                  alt={work.title}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                />
                {work.page_count > 1 && (
                  <span className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-xs text-white backdrop-blur-sm">
                    <Bookmark size={12} /> {work.page_count}P
                  </span>
                )}
              </button>
              <Card.Header className="gap-2 p-4 pb-2">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <Card.Title className="line-clamp-2 min-w-0 text-sm leading-5">{work.title}</Card.Title>
                </div>
              </Card.Header>
              <Card.Footer className="mt-auto flex items-center justify-between gap-2 px-4 pb-4 pt-1">
                <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
                  <span className="truncate">{work.author || 'Pixiv'}</span>
                  {work.total_bookmarks !== null && (
                    <span className="flex items-center gap-1">
                      <Bookmark size={12} /> {work.total_bookmarks}
                    </span>
                  )}
                  {work.total_view !== null && (
                    <span className="flex items-center gap-1">
                      <Eye size={12} /> {work.total_view}
                    </span>
                  )}
                </div>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  aria-label={`进入 ${work.title} 详情`}
                  onPress={() => navigate(`/resource/pixivel/${work.id}`)}
                >
                  <ArrowRight size={15} />
                </Button>
              </Card.Footer>
            </Card>
            ))}
          </div>
        </div>
      )}

      {works.length > 0 && hasMore && (
        <div className="flex justify-center pt-2">
          <Button variant="secondary" isPending={loadingMore} onPress={() => loadPage(page + 1)}>
            {loadingMore ? '正在加载' : '加载更多'}
          </Button>
        </div>
      )}

      <p className="border-t border-divider pt-4 text-center text-xs text-muted">
        数据来源于 Pixiv（通过 HibiAPI 镜像），作品版权归原作者及相关权利人所有。
      </p>
    </div>
  );
}
