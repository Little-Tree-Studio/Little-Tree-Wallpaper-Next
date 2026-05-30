import FavoriteRoundedIcon from '@mui/icons-material/FavoriteRounded';
import WallpaperRoundedIcon from '@mui/icons-material/WallpaperRounded';
import {
  Avatar,
  Box,
  Button,
  Card,
  CardActionArea,
  CardActions,
  CardContent,
  CardMedia,
  Chip,
  Grid,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import type React from 'react';

import { EmptyState } from './shared';
import type { TranslateFn } from '../i18n';
import type { FavoriteItem, WallpaperItem } from '../types';
import {
  formatBingQualityLabel,
  formatFileSize,
  formatTimestamp,
  isLocalWallpaperItem,
  localizeSourceName,
  resolveImageSource,
  truncateMiddle,
} from '../utils';

export function FeaturedWallpaperCard({
  t,
  item,
  onPreview,
  onSetWallpaper,
  onDownload,
  onToggleFavorite,
  isFavorite,
}: {
  t: TranslateFn;
  item: WallpaperItem;
  onPreview: (item: WallpaperItem) => void;
  onSetWallpaper: (item: WallpaperItem) => void;
  onDownload: (item: WallpaperItem) => void;
  onToggleFavorite: (item: WallpaperItem) => void;
  isFavorite: (item: WallpaperItem) => boolean;
}) {
  const theme = useTheme();
  const qualityLabel = typeof item.metadata?.quality === 'string' ? formatBingQualityLabel(item.metadata.quality, t) : null;

  return (
    <Card sx={{ overflow: 'hidden' }}>
      <Grid container>
        <Grid size={{ xs: 12, lg: 7 }}>
          <CardActionArea onClick={() => onPreview(item)} sx={{ height: '100%' }}>
            <CardMedia
              component="img"
              image={resolveImageSource(item.preview_url || item.image_url)}
              alt={item.title}
              sx={{
                minHeight: { xs: 260, md: 360, lg: '100%' },
                maxHeight: { xs: 360, lg: 520 },
                objectFit: 'cover',
              }}
            />
          </CardActionArea>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <CardContent sx={{ height: '100%', p: { xs: 2.5, md: 3 }, display: 'flex' }}>
            <Stack spacing={2.5} sx={{ width: '100%' }}>
              <Stack spacing={1.25}>
                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                  <Chip size="small" color="primary" variant="outlined" label={localizeSourceName(item.source_id, item.source_name, t)} />
                  <IconButton color={isFavorite(item) ? 'secondary' : 'default'} onClick={() => onToggleFavorite(item)}>
                    <FavoriteRoundedIcon />
                  </IconButton>
                </Stack>
                <Typography variant="h4" sx={{ lineHeight: 1.1 }}>
                  {item.title}
                </Typography>
                <Typography variant="body1" color="text.secondary">
                  {item.description || t('featuredWallpaper.fallbackDescription')}
                </Typography>
              </Stack>

              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {item.width && item.height && <Chip size="small" label={`${item.width} × ${item.height}`} />}
                {qualityLabel && <Chip size="small" label={qualityLabel} variant="outlined" />}
                <Chip size="small" label={t('featuredWallpaper.todayLabel')} variant="outlined" sx={{ borderColor: alpha(theme.palette.primary.main, 0.28) }} />
              </Stack>

              <Box sx={{ flex: 1 }} />

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                <Button variant="contained" size="large" onClick={() => onSetWallpaper(item)}>
                  {t('gallery.setWallpaper')}
                </Button>
                <Button variant="outlined" size="large" onClick={() => onDownload(item)}>
                  {t('gallery.download')}
                </Button>
                <Button size="large" onClick={() => onPreview(item)}>
                  {t('common.preview')}
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Grid>
      </Grid>
    </Card>
  );
}

export function WallpaperGallery({
  t,
  items,
  onPreview,
  onSetWallpaper,
  onDownload,
  onToggleFavorite,
  isFavorite,
  compact = false,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: {
  t: TranslateFn;
  items: WallpaperItem[];
  onPreview: (item: WallpaperItem) => void;
  onSetWallpaper: (item: WallpaperItem) => void;
  onDownload: (item: WallpaperItem) => void;
  onToggleFavorite: (item: WallpaperItem) => void;
  isFavorite: (item: WallpaperItem) => boolean;
  compact?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
}) {
  if (items.length === 0) {
    return <EmptyState title={emptyTitle ?? t('gallery.emptyTitle')} description={emptyDescription ?? t('gallery.emptyDescription')} action={emptyAction} compact />;
  }

  return (
    <Grid container spacing={2}>
      {items.map((item) => (
        <Grid key={item.id} size={{ xs: 12, sm: compact ? 12 : 6, xl: compact ? 12 : 4 }}>
          <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <CardActionArea onClick={() => onPreview(item)}>
              <CardMedia component="img" height={compact ? 180 : 220} image={resolveImageSource(item.preview_url || item.image_url)} alt={item.title} sx={{ objectFit: 'cover' }} />
              <CardContent>
                <Stack spacing={1.25}>
                  <Typography variant="h6" noWrap>
                    {item.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {localizeSourceName(item.source_id, item.source_name, t)}
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {item.width && item.height && <Chip size="small" label={`${item.width} × ${item.height}`} />}
                    {item.description && <Chip size="small" label={t('gallery.hasDescription')} variant="outlined" />}
                  </Stack>
                </Stack>
              </CardContent>
            </CardActionArea>
            <CardActions sx={{ px: 2, pb: 2, pt: 0 }}>
              <Button size="small" variant="contained" onClick={() => onSetWallpaper(item)}>
                {t('gallery.setWallpaper')}
              </Button>
              <Button size="small" onClick={() => onDownload(item)}>
                {t('gallery.download')}
              </Button>
              <Box sx={{ flex: 1 }} />
              <IconButton color={isFavorite(item) ? 'secondary' : 'default'} onClick={() => onToggleFavorite(item)}>
                <FavoriteRoundedIcon />
              </IconButton>
            </CardActions>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
}

export function FavoritesGallery({
  t,
  items,
  folders,
  onPreview,
  onSetWallpaper,
  onDownload,
  onToggleFavorite,
  onMoveItem,
  onLocalizeItem,
  onResetLocalization,
  isFavorite,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: {
  t: TranslateFn;
  items: FavoriteItem[];
  folders: { id: string; name: string }[];
  onPreview: (item: WallpaperItem) => void;
  onSetWallpaper: (item: WallpaperItem) => void;
  onDownload: (item: WallpaperItem) => void;
  onToggleFavorite: (item: WallpaperItem) => void;
  onMoveItem: (itemId: string, folderId: string) => void;
  onLocalizeItem: (itemId: string) => void;
  onResetLocalization: (itemId: string) => void;
  isFavorite: (item: WallpaperItem) => boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
}) {
  const theme = useTheme();

  if (items.length === 0) {
    return <EmptyState title={emptyTitle ?? t('favorites.emptyTitle')} description={emptyDescription ?? t('favorites.emptyDescription')} action={emptyAction} compact />;
  }

  return (
    <Grid container spacing={2}>
      {items.map((item) => {
        const localized = Boolean(item.localized || item.localization_status === 'completed');
        const localizedFileSize = formatFileSize(item.localization_file_size);
        const canLocalize = item.can_localize !== false;

        return (
        <Grid key={item.id} size={{ xs: 12, md: 6, xl: 4 }}>
          <Card
            sx={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              border: `1px solid ${alpha(theme.palette.divider, 0.8)}`,
              background: localized
                ? `linear-gradient(180deg, ${alpha(theme.palette.success.light, 0.12)}, ${alpha(theme.palette.background.paper, 0.92)})`
                : theme.palette.background.paper,
            }}
          >
            <CardActionArea onClick={() => onPreview(item)}>
              <CardMedia component="img" height={220} image={resolveImageSource(item.preview_url || item.image_url)} alt={item.title} sx={{ objectFit: 'cover' }} />
              <CardContent>
                <Stack spacing={1.25}>
                  <Typography variant="h6" noWrap>
                    {item.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {localizeSourceName(item.source_id, item.source_name, t)}
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {item.width && item.height && <Chip size="small" label={`${item.width} × ${item.height}`} />}
                    {localized && <Chip size="small" color="success" variant="outlined" label={t('favorites.localizedTag')} />}
                    {item.localization_status === 'pending' && <Chip size="small" color="warning" variant="outlined" label={t('favorites.localizationPendingTag')} />}
                    {item.localization_status === 'failed' && <Chip size="small" color="error" variant="outlined" label={t('favorites.localizationFailedTag')} />}
                    {item.tags && item.tags.length > 0 && <Chip size="small" variant="outlined" label={t('favorites.tagsCount', { count: item.tags.length })} />}
                  </Stack>
                  {item.local_path && (
                    <Typography variant="caption" color="text.secondary">
                      {t('favorites.localizationSource')}: {truncateMiddle(item.local_path, 42)}
                    </Typography>
                  )}
                  {item.localization_updated_at && (
                    <Typography variant="caption" color="text.secondary">
                      {t('favorites.localizationUpdatedAt', { time: formatTimestamp(item.localization_updated_at) ?? item.localization_updated_at })}
                    </Typography>
                  )}
                  {localizedFileSize && (
                    <Typography variant="caption" color="text.secondary">
                      {t('favorites.localizationFileSize', { size: localizedFileSize })}
                    </Typography>
                  )}
                  {item.localization_status === 'failed' && item.localization_message && (
                    <Typography variant="caption" color="error.main">
                      {t('favorites.localizationFailedMessage', { message: item.localization_message })}
                    </Typography>
                  )}
                </Stack>
              </CardContent>
            </CardActionArea>
            <CardActions sx={{ px: 2, pb: 2, pt: 0 }}>
              <Stack spacing={1.25} sx={{ width: '100%' }}>
                <TextField
                  select
                  size="small"
                  fullWidth
                  label={t('favorites.folderLabel')}
                  value={item.folder_id}
                  onChange={(event) => void onMoveItem(item.id, event.target.value)}
                >
                  {folders.map((folder) => (
                    <MenuItem key={folder.id} value={folder.id}>
                      {folder.name}
                    </MenuItem>
                  ))}
                </TextField>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Button size="small" variant="contained" onClick={() => onSetWallpaper(item)}>
                    {t('gallery.setWallpaper')}
                  </Button>
                  {canLocalize && (
                    <Button size="small" variant="outlined" onClick={() => onLocalizeItem(item.id)}>
                      {localized ? t('favorites.relocalizeAction') : t('favorites.localizeAction')}
                    </Button>
                  )}
                  {canLocalize && localized && (
                    <Button size="small" color="warning" onClick={() => onResetLocalization(item.id)}>
                      {t('favorites.resetLocalizationAction')}
                    </Button>
                  )}
                  <Button size="small" onClick={() => onDownload(item)}>
                    {t('gallery.download')}
                  </Button>
                  <Box sx={{ flex: 1 }} />
                  <IconButton color={isFavorite(item) ? 'secondary' : 'default'} onClick={() => onToggleFavorite(item)}>
                    <FavoriteRoundedIcon />
                  </IconButton>
                </Stack>
              </Stack>
            </CardActions>
          </Card>
        </Grid>
        );
      })}
    </Grid>
  );
}
