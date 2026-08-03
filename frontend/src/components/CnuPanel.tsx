import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from '@/lib/router';
import { Alert, Button, Card, Chip, Label, ListBox, Select, Skeleton } from '@heroui/react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { queryCnuSelected, queryCnuWorks } from '@/api/backend';
import { logError } from '@/lib/log';
import type { CnuWorkSummary } from '@/types';

type CnuSection = 'selected' | 'inspiration' | 'discovery';
type CnuOrder = 'hot' | 'recommend' | 'recent';

const CATEGORIES: Record<Exclude<CnuSection, 'selected'>, Array<{ id: string; name: string }>> = {
  inspiration: [
    { id: '0', name: '全部分类' }, { id: '220', name: '时尚大片' }, { id: '222', name: '时装发布' },
    { id: '9', name: '潮流趋势' }, { id: '118', name: '时尚摄影' }, { id: '8', name: '婚纱摄影' },
    { id: '120', name: '广告摄影' }, { id: '111', name: '人像摄影' }, { id: '110', name: '人文摄影' },
    { id: '226', name: '风光摄影' }, { id: '242', name: '生态摄影' }, { id: '243', name: '观念摄影' },
    { id: '6', name: '当代艺术' }, { id: '14', name: '插画设计' }, { id: '12', name: '平面设计' },
  ],
  discovery: [
    { id: '0', name: '全部分类' }, { id: '111', name: '人像摄影' }, { id: '112', name: '情侣写真' },
    { id: '113', name: '儿童摄影' }, { id: '237', name: '模特展示' }, { id: '118', name: '时尚摄影' },
    { id: '120', name: '广告摄影' }, { id: '44', name: '艺术摄影' }, { id: '243', name: '观念摄影' },
    { id: '110', name: '街头人文' }, { id: '226', name: '风光摄影' }, { id: '227', name: '建筑摄影' },
    { id: '242', name: '生态摄影' }, { id: '114', name: '宠物摄影' },
  ],
};

const SECTION_COPY: Record<CnuSection, { title: string; description: string }> = {
  selected: { title: '每日精选', description: 'CNU 编辑精选的视觉作品' },
  inspiration: { title: '灵感', description: '杂志、摄影与视觉创意灵感' },
  discovery: { title: '原创', description: 'CNU 创作者发布的原创摄影作品' },
};

function CnuGridSkeleton() {
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
  section: CnuSection;
  order: CnuOrder;
  categoryId: string;
  works: CnuWorkSummary[];
  page: number;
  hasMore: boolean;
  scrollY: number;
}

let _panelCache: PanelCache | null = null;

function getScrollTop(): number {
  const container = document.querySelector('[class*="scroll-shadow--vertical"]');
  return container ? container.scrollTop : window.scrollY;
}

function setScrollTop(y: number): void {
  const container = document.querySelector('[class*="scroll-shadow--vertical"]');
  if (container) container.scrollTop = y;
  else window.scrollTo({ top: y });
}

export default function CnuPanel({ active }: { active: boolean }) {
  const navigate = useNavigate();
  const [section, setSection] = useState<CnuSection>(_panelCache?.section ?? 'selected');
  const [order, setOrder] = useState<CnuOrder>(_panelCache?.order ?? 'recent');
  const [categoryId, setCategoryId] = useState(_panelCache?.categoryId ?? '0');
  const [works, setWorks] = useState<CnuWorkSummary[]>(_panelCache?.works ?? []);
  const [page, setPage] = useState(_panelCache?.page ?? 1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(_panelCache?.hasMore ?? true);
  const [error, setError] = useState('');

  const skipReloadRef = useRef(Boolean(_panelCache && _panelCache.works.length > 0));
  const stateRef = useRef({ section, order, categoryId, works, page, hasMore });
  stateRef.current = { section, order, categoryId, works, page, hasMore };

  const loadPage = useCallback(async (nextPage: number, refresh = false) => {
    if (nextPage === 1) setLoading(true);
    else setLoadingMore(true);
    setError('');
    try {
      const pageSize = section === 'selected' ? 16 : 40;
      const items = section === 'selected'
        ? await queryCnuSelected(nextPage, pageSize, refresh)
        : await queryCnuWorks(section, order, categoryId, nextPage, pageSize, refresh);
      setWorks((current) => nextPage === 1 ? items : [...current, ...items]);
      setPage(nextPage);
      setHasMore(items.length >= pageSize);
    } catch (reason) {
      logError('CNU work list load failed', reason);
      setError(reason instanceof Error ? reason.message : 'CNU 作品加载失败');
      if (nextPage === 1) setWorks([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [section, order, categoryId]);

  useEffect(() => {
    if (!active) return;
    if (skipReloadRef.current) {
      skipReloadRef.current = false;
      const cachedY = _panelCache?.scrollY ?? 0;
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
      _panelCache = { ...stateRef.current, scrollY: getScrollTop() };
    };
  }, []);

  const changeSection = (nextSection: CnuSection) => {
    setSection(nextSection);
    setCategoryId('0');
    setOrder(nextSection === 'discovery' ? 'hot' : 'recent');
  };

  const categories = section === 'selected' ? [] : CATEGORIES[section];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{SECTION_COPY[section].title}</h2>
            <p className="text-sm text-muted">{SECTION_COPY[section].description}</p>
          </div>
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            aria-label="刷新 CNU 作品"
            isDisabled={loading || loadingMore}
            onPress={() => loadPage(1, true)}
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-2" aria-label="CNU 内容来源">
            <Button size="sm" variant={section === 'selected' ? 'primary' : 'secondary'} onPress={() => changeSection('selected')}>每日精选</Button>
            <Button size="sm" variant={section === 'inspiration' ? 'primary' : 'secondary'} onPress={() => changeSection('inspiration')}>灵感</Button>
            <Button size="sm" variant={section === 'discovery' ? 'primary' : 'secondary'} onPress={() => changeSection('discovery')}>原创</Button>
          </div>

          {section !== 'selected' && (
            <>
              <div className="flex flex-wrap gap-2" aria-label="CNU 排序方式">
                <Button size="sm" variant={order === 'hot' ? 'primary' : 'ghost'} onPress={() => setOrder('hot')}>24 小时热门</Button>
                {section === 'discovery' && (
                  <Button size="sm" variant={order === 'recommend' ? 'primary' : 'ghost'} onPress={() => setOrder('recommend')}>推荐</Button>
                )}
                <Button size="sm" variant={order === 'recent' ? 'primary' : 'ghost'} onPress={() => setOrder('recent')}>24 小时最新</Button>
              </div>

              <Select
                className="w-40"
                aria-label="作品分类"
                value={categoryId}
                onChange={(value) => value && setCategoryId(String(value))}
              >
                <Label className="sr-only">作品分类</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {categories.map((category) => (
                      <ListBox.Item key={category.id} id={category.id} textValue={category.name}>
                        {category.name}<ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </>
          )}
        </div>
      </div>

      {loading && works.length === 0 ? (
        <CnuGridSkeleton />
      ) : error && works.length === 0 ? (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Title>无法加载 CNU 作品</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : works.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted">当前条件下暂无作品</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {works.map((work) => (
            <Card key={`${section}-${order}-${categoryId}-${work.id}`} className="gap-0 overflow-hidden p-0">
              <button
                type="button"
                className="group relative aspect-[4/3] w-full overflow-hidden bg-surface-secondary text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onClick={() => navigate(`/resource/cnu/${work.id}`)}
                aria-label={`查看作品：${work.title}`}
              >
                <img
                  src={work.preview_url}
                  alt={work.title}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                />
              </button>
              <Card.Header className="gap-2 p-4 pb-2">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <Card.Title className="line-clamp-2 min-w-0 text-sm leading-5">{work.title}</Card.Title>
                  {work.work_type && <Chip size="sm" variant="soft" className="shrink-0">{work.work_type}</Chip>}
                </div>
                {work.description && <Card.Description className="line-clamp-2 text-xs">{work.description}</Card.Description>}
              </Card.Header>
              <Card.Footer className="mt-auto flex items-center justify-between gap-2 px-4 pb-4 pt-1">
                <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
                  <span className="truncate">{work.author || 'CNU'}</span>
                  {work.category && work.category !== work.work_type && <span>· {work.category}</span>}
                  {work.selected_date && <span>· {work.selected_date}</span>}
                </div>
                <Button isIconOnly size="sm" variant="ghost" aria-label={`进入 ${work.title} 详情`} onPress={() => navigate(`/resource/cnu/${work.id}`)}>
                  <ArrowRight size={15} />
                </Button>
              </Card.Footer>
            </Card>
          ))}
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
        数据来源于 CNU 视觉联盟（www.cnu.cc），作品版权归原作者及相关权利人所有。
      </p>
    </div>
  );
}
