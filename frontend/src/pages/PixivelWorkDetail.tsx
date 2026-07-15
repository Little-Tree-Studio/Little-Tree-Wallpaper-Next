import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Card, Chip, Skeleton } from '@heroui/react';
import { ArrowLeft, CalendarDays, ExternalLink, Images, UserRound, Bookmark, Eye } from 'lucide-react';
import { getPixivelWork, openUrl } from '@/api/backend';
import { useImageViewer } from '@/components/ImageViewer';
import { logError } from '@/lib/log';
import type { PixivelWallpaperMetadata, WallpaperItem } from '@/types';

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <Skeleton className="h-9 w-40 rounded" />
      <div className="space-y-3">
        <Skeleton className="h-8 w-3/5 rounded" />
        <Skeleton className="h-4 w-full max-w-2xl rounded" />
        <Skeleton className="h-4 w-4/5 max-w-xl rounded" />
      </div>
      <div className="columns-1 gap-4 sm:columns-2 lg:columns-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton
            key={index}
            className={`mb-4 w-full break-inside-avoid rounded-lg ${index % 3 === 0 ? 'aspect-[3/4]' : index % 3 === 1 ? 'aspect-[4/3]' : 'aspect-square'}`}
          />
        ))}
      </div>
    </div>
  );
}

export default function PixivelWorkDetail() {
  const { workId = '' } = useParams();
  const navigate = useNavigate();
  const { openViewer } = useImageViewer();
  const [images, setImages] = useState<WallpaperItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getPixivelWork(workId)
      .then((items) => {
        if (!cancelled) setImages(items || []);
      })
      .catch((reason) => {
        if (cancelled) return;
        logError('Pixivel work detail load failed', reason);
        setError(reason instanceof Error ? reason.message : '作品详情加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [workId]);

  const metadata = (images[0]?.metadata || {}) as PixivelWallpaperMetadata;
  const baseTitle = images[0]?.title?.replace(/ #1$/, '') || 'Pixiv 作品';
  const description = images[0]?.description || '';
  const viewerItems = useMemo(() => images.map((item) => ({
    src: item.image_url,
    title: item.title,
    description: item.description,
    source_url: item.image_url,
    preview_url: item.preview_url || item.image_url,
    source_type: item.source_id,
    copyright: metadata.author,
    tags: metadata.tags || [],
  })), [images, metadata.author, metadata.tags]);

  if (loading) return <DetailSkeleton />;

  return (
    <div className="mx-auto max-w-7xl space-y-7">
      <Button size="sm" variant="ghost" onPress={() => navigate('/resource?tab=pixivel')}>
        <ArrowLeft size={16} /> 返回资源
      </Button>

      {error ? (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Title>无法加载作品详情</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : images.length === 0 ? (
        <div className="py-14 text-center text-muted">该作品暂无可用图片</div>
      ) : (
        <>
          <header className="border-b border-divider pb-6">
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(260px,0.55fr)] md:items-end">
              <div className="min-w-0 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  {metadata.tags?.slice(0, 3).map((tag) => (
                    <Chip key={tag} size="sm" variant="soft">{tag}</Chip>
                  ))}
                  <Chip size="sm" variant="secondary">
                    <Images size={13} />{images.length} 张作品
                  </Chip>
                </div>
                <h1 className="max-w-4xl text-2xl font-bold leading-tight text-pretty sm:text-3xl">{baseTitle}</h1>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
                  {metadata.author && (
                    <span className="flex items-center gap-1.5">
                      <UserRound size={14} />{metadata.author}
                    </span>
                  )}
                  {metadata.create_date && (
                    <span className="flex items-center gap-1.5">
                      <CalendarDays size={14} />{metadata.create_date.slice(0, 10)}
                    </span>
                  )}
                  {metadata.total_bookmarks !== null && (
                    <span className="flex items-center gap-1.5">
                      <Bookmark size={14} />{metadata.total_bookmarks} 收藏
                    </span>
                  )}
                  {metadata.total_view !== null && (
                    <span className="flex items-center gap-1.5">
                      <Eye size={14} />{metadata.total_view} 浏览
                    </span>
                  )}
                </div>
              </div>
              <div className="space-y-4 md:justify-self-end">
                {description && (
                  <p
                    className="max-w-xl text-sm leading-6 text-muted text-pretty"
                    dangerouslySetInnerHTML={{ __html: description }}
                  />
                )}
                {metadata.detail_url && (
                  <Button size="sm" variant="secondary" onPress={() => openUrl(metadata.detail_url)}>
                    <ExternalLink size={15} /> 来源页面
                  </Button>
                )}
              </div>
            </div>
          </header>

          <div className="columns-1 gap-4 sm:columns-2 lg:columns-3">
            {images.map((item, index) => (
              <Card key={item.id} className="group mb-4 inline-block w-full break-inside-avoid overflow-hidden p-0 align-top">
                <button
                  type="button"
                  className="relative block w-full overflow-hidden bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={() => openViewer(viewerItems, index)}
                  aria-label={`查看第 ${index + 1} 张图片`}
                >
                  <img
                    src={item.preview_url || item.image_url}
                    alt={`${baseTitle}，第 ${index + 1} 张`}
                    loading={index < 2 ? 'eager' : 'lazy'}
                    width={item.width || undefined}
                    height={item.height || undefined}
                    style={item.width && item.height ? { aspectRatio: `${item.width} / ${item.height}` } : undefined}
                    className="block h-auto w-full object-cover transition-transform duration-300 group-hover:scale-[1.015]"
                  />
                  <span className="absolute bottom-2 left-2 flex items-center gap-2 rounded-md bg-black/60 px-2 py-1 text-xs text-white opacity-100 backdrop-blur-sm transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    {item.width && item.height && (
                      <span className="text-white/75">{item.width} × {item.height}</span>
                    )}
                  </span>
                </button>
              </Card>
            ))}
          </div>

          <p className="border-t border-divider pt-4 text-center text-xs text-muted">
            数据来源于 Pixiv（通过 HibiAPI 镜像），作品版权归原作者及相关权利人所有。
          </p>
        </>
      )}
    </div>
  );
}
