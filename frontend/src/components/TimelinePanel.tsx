import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Chip, Label, SearchField, Skeleton } from '@heroui/react';
import { ArrowLeft, Image as ImageIcon, RefreshCw } from 'lucide-react';
import { listTimelineTopics, queryTimelineWallpapers } from '@/api/backend';
import { useImageViewer } from '@/components/ImageViewer';
import { logError } from '@/lib/log';
import type {
  TimelineTopicSummary,
  TimelineWallpaperMetadata,
  WallpaperItem,
} from '@/types';

type TimelineSection = 'topics' | 'latest' | 'trending' | 'random';
const PAGE_TOTAL = 300;

const SECTION_COPY: Record<TimelineSection, { title: string; description: string }> = {
  topics: { title: '专题', description: '按主题浏览拾光整理的壁纸图集' },
  latest: { title: '最新', description: '按更新时间浏览近期收录的壁纸' },
  trending: { title: '趋势', description: '浏览近期热度较高的壁纸' },
  random: { title: '随缘', description: '从拾光图库中随机发现壁纸' },
};

function TimelineGridSkeleton({ topics = false }: { topics?: boolean }) {
  return (
    <div className={`grid gap-4 ${topics ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'}`}>
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

function timelineMetadata(item: WallpaperItem): TimelineWallpaperMetadata {
  return item.metadata as TimelineWallpaperMetadata;
}

function formatReleasedAt(value: string): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10);
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

export default function TimelinePanel({ active }: { active: boolean }) {
  const { openViewer } = useImageViewer();
  const [section, setSection] = useState<TimelineSection>('topics');
  const [selectedTopic, setSelectedTopic] = useState<TimelineTopicSummary | null>(null);
  const [topics, setTopics] = useState<TimelineTopicSummary[]>([]);
  const [topicSearch, setTopicSearch] = useState('');
  const [wallpapers, setWallpapers] = useState<WallpaperItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState('');
  const cursorRef = useRef<number | null>(null);
  const seedRef = useRef(Date.now());
  const wallpapersRef = useRef<WallpaperItem[]>([]);
  const requestControllerRef = useRef<AbortController | null>(null);

  const filteredTopics = useMemo(() => {
    const keyword = topicSearch.trim().toLocaleLowerCase();
    if (!keyword) return topics;
    return topics.filter((topic) => (
      topic.title.toLocaleLowerCase().includes(keyword)
      || topic.description.toLocaleLowerCase().includes(keyword)
    ));
  }, [topicSearch, topics]);

  const loadTopics = useCallback(async (refresh = false) => {
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setLoading(true);
    setError('');
    try {
      const items = await listTimelineTopics(refresh, controller.signal);
      if (controller.signal.aborted) return;
      setTopics(items);
    } catch (reason) {
      if (controller.signal.aborted) return;
      logError('Timeline topics load failed', reason);
      setError(reason instanceof Error ? reason.message : '拾光专题加载失败');
      if (refresh) setTopics([]);
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  const loadWallpapers = useCallback(async (reset: boolean, refresh = false) => {
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    if (reset) {
      wallpapersRef.current = [];
      cursorRef.current = null;
      setWallpapers([]);
      setHasMore(false);
      setLoadingMore(false);
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    setError('');

    const mode = selectedTopic ? 'topic' : section;
    const seed = reset ? Date.now() : seedRef.current;
    const cursor = reset ? null : cursorRef.current;
    if (reset) seedRef.current = seed;

    try {
      const page = await queryTimelineWallpapers(
        mode as 'latest' | 'trending' | 'random' | 'topic',
        cursor,
        selectedTopic?.id || '',
        seed,
        refresh,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const current = reset ? [] : wallpapersRef.current;
      const seen = new Set(current.map((item) => item.id));
      const additions = page.items.filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
      const merged = [
        ...current,
        ...additions,
      ].slice(0, PAGE_TOTAL);
      wallpapersRef.current = merged;
      setWallpapers(merged);
      cursorRef.current = page.next_cursor;
      seedRef.current = page.seed;
      setHasMore(page.has_more && merged.length < PAGE_TOTAL);
    } catch (reason) {
      if (controller.signal.aborted) return;
      logError('Timeline wallpapers load failed', reason);
      setError(reason instanceof Error ? reason.message : '拾光壁纸加载失败');
      if (reset) setWallpapers([]);
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [section, selectedTopic]);

  useEffect(() => {
    if (!active) {
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    if (section === 'topics' && !selectedTopic) {
      if (topics.length === 0) void loadTopics();
      return;
    }
    setWallpapers([]);
    cursorRef.current = null;
    setHasMore(true);
    void loadWallpapers(true);
  }, [active, section, selectedTopic, topics.length, loadTopics, loadWallpapers]);

  useEffect(() => () => requestControllerRef.current?.abort(), []);

  const changeSection = (nextSection: TimelineSection) => {
    if (nextSection === section && !selectedTopic) return;
    requestControllerRef.current?.abort();
    setSection(nextSection);
    setSelectedTopic(null);
    wallpapersRef.current = [];
    setWallpapers([]);
    cursorRef.current = null;
    setLoading(false);
    setLoadingMore(false);
    setError('');
  };

  const openTopic = (topic: TimelineTopicSummary) => {
    requestControllerRef.current?.abort();
    setSelectedTopic(topic);
    wallpapersRef.current = [];
    setWallpapers([]);
    cursorRef.current = null;
    setLoading(false);
    setLoadingMore(false);
    setError('');
  };

  const backToTopics = () => {
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setSelectedTopic(null);
    wallpapersRef.current = [];
    setWallpapers([]);
    cursorRef.current = null;
    setLoading(false);
    setLoadingMore(false);
    setError('');
  };

  const openWallpaperViewer = (startIndex: number) => {
    openViewer(wallpapers.map((item) => {
      const metadata = timelineMetadata(item);
      return {
        src: item.image_url,
        preview_url: item.preview_url || item.image_url,
        title: item.title,
        description: item.description,
        source_url: metadata.original_image_url || item.image_url,
        source_page_url: metadata.source_page_url || metadata.gallery_url,
        source_type: item.source_id,
        source_name: item.source_name,
        copyright: metadata.copyright,
        tags: metadata.tags,
      };
    }), startIndex);
  };

  const heading = selectedTopic
    ? { title: selectedTopic.title, description: selectedTopic.description || '拾光壁纸专题图集' }
    : SECTION_COPY[section];
  const showingTopics = section === 'topics' && !selectedTopic;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            {selectedTopic && (
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                aria-label="返回拾光专题"
                onPress={backToTopics}
              >
                <ArrowLeft size={16} />
              </Button>
            )}
            <div className="min-w-0">
              <h2 className="text-base font-semibold">{heading.title}</h2>
              <p className="text-sm text-muted">{heading.description}</p>
            </div>
          </div>
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            aria-label="刷新拾光壁纸"
            isDisabled={loading || loadingMore}
            onPress={() => showingTopics ? loadTopics(true) : loadWallpapers(true, true)}
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>

        <div className="flex flex-wrap gap-2" aria-label="拾光壁纸内容类型">
          <Button size="sm" variant={section === 'topics' ? 'primary' : 'secondary'} onPress={() => changeSection('topics')}>专题</Button>
          <Button size="sm" variant={section === 'latest' ? 'primary' : 'secondary'} onPress={() => changeSection('latest')}>最新</Button>
          <Button size="sm" variant={section === 'trending' ? 'primary' : 'secondary'} onPress={() => changeSection('trending')}>趋势</Button>
          <Button size="sm" variant={section === 'random' ? 'primary' : 'secondary'} onPress={() => changeSection('random')}>随缘</Button>
        </div>

        {showingTopics && topics.length > 0 && (
          <SearchField
            className="w-full sm:w-72"
            name="timeline-topic-search"
            value={topicSearch}
            onChange={setTopicSearch}
          >
            <Label className="sr-only">查找拾光专题</Label>
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="查找专题" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
        )}
      </div>

      {loading && (showingTopics ? topics.length === 0 : wallpapers.length === 0) ? (
        <TimelineGridSkeleton topics={showingTopics} />
      ) : error && (showingTopics ? topics.length === 0 : wallpapers.length === 0) ? (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{showingTopics ? '无法加载拾光专题' : '无法加载拾光壁纸'}</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : showingTopics ? (
        filteredTopics.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted">没有找到匹配的专题</div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {filteredTopics.map((topic) => (
              <Card key={topic.id} className="gap-0 overflow-hidden p-0">
                <button
                  type="button"
                  className="group relative aspect-[4/3] w-full overflow-hidden bg-surface-secondary text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={() => openTopic(topic)}
                  aria-label={`浏览专题：${topic.title}`}
                >
                  <img
                    src={topic.preview_url}
                    alt={topic.title}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                </button>
                <Card.Header className="gap-1 p-3">
                  <Card.Title className="line-clamp-1 text-sm">{topic.title}</Card.Title>
                  {topic.description && <Card.Description className="line-clamp-2 text-xs">{topic.description}</Card.Description>}
                </Card.Header>
              </Card>
            ))}
          </div>
        )
      ) : wallpapers.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted">当前列表暂无壁纸</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {wallpapers.map((item, index) => {
            const metadata = timelineMetadata(item);
            const releasedAt = formatReleasedAt(metadata.released_at);
            const topics = metadata.topics || [];
            return (
              <Card key={`${item.id}-${index}`} className="gap-0 overflow-hidden p-0">
                <button
                  type="button"
                  className="group relative aspect-[4/3] w-full overflow-hidden bg-surface-secondary text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={() => openWallpaperViewer(index)}
                  aria-label={`查看壁纸：${item.title}`}
                >
                  <img
                    src={item.preview_url || item.image_url}
                    alt={item.title}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                  {topics.length > 0 && (
                    <div className="absolute right-2 top-2 flex max-w-[calc(100%-1rem)] items-center gap-1">
                      <Chip size="sm" variant="primary" className="min-w-0">
                        <Chip.Label className="truncate">{topics[0]}</Chip.Label>
                      </Chip>
                      {topics.length > 1 && <Chip size="sm" variant="primary">+{topics.length - 1}</Chip>}
                    </div>
                  )}
                </button>
                <Card.Header className="gap-1 p-4 pb-2">
                  <Card.Title className="line-clamp-2 text-sm leading-5">{item.title}</Card.Title>
                  {item.description && <Card.Description className="line-clamp-2 text-xs">{item.description}</Card.Description>}
                </Card.Header>
                <Card.Footer className="mt-auto flex items-center justify-between gap-2 px-4 pb-4 pt-1">
                  <div className="min-w-0 truncate text-xs text-muted">
                    {item.width && item.height ? `${item.width} × ${item.height}` : '拾光壁纸'}
                    {releasedAt ? ` · ${releasedAt}` : ''}
                  </div>
                  <Button isIconOnly size="sm" variant="ghost" aria-label={`查看 ${item.title}`} onPress={() => openWallpaperViewer(index)}>
                    <ImageIcon size={15} />
                  </Button>
                </Card.Footer>
              </Card>
            );
          })}
        </div>
      )}

      {!showingTopics && wallpapers.length > 0 && hasMore && (
        <div className="flex justify-center pt-2">
          <Button variant="secondary" isPending={loadingMore} onPress={() => loadWallpapers(false)}>
            {loadingMore ? '正在加载' : '加载更多'}
          </Button>
        </div>
      )}

      <p className="border-t border-divider pt-4 text-center text-xs text-muted">
        数据来源于拾光壁纸（gallery.timeline.ink），图片版权归原作者及相关权利人所有。
      </p>
    </div>
  );
}
