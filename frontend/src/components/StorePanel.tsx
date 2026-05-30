import PaletteRoundedIcon from '@mui/icons-material/PaletteRounded';
import WallpaperRoundedIcon from '@mui/icons-material/WallpaperRounded';
import WidgetsRoundedIcon from '@mui/icons-material/WidgetsRounded';
import {
  Avatar,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  Stack,
  Typography,
} from '@mui/material';

import { EmptyState } from './shared';
import type { TranslateFn } from '../i18n';
import type { StoreResource } from '../types';

export function StorePanel({ tab, payload, resources, loading, onInstall, onDetail, t }: {
  tab: number;
  payload: Record<string, unknown> | undefined;
  resources: StoreResource[];
  loading: boolean;
  onInstall: (resource: StoreResource) => void;
  onDetail: (resource: StoreResource) => void;
  t: TranslateFn;
}) {
  if (loading) {
    return (
      <Stack spacing={2} alignItems="center" sx={{ py: 6 }}>
        <CircularProgress />
        <Typography color="text.secondary">{t('store.loading')}</Typography>
      </Stack>
    );
  }

  if (resources.length > 0) {
    return (
      <Grid container spacing={2}>
        {resources.map((resource) => {
          const iconUrl = resource.icon_url || null;
          return (
            <Grid key={resource.id} size={{ xs: 12, md: 6, xl: 4 }}>
              <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <CardContent sx={{ flex: 1 }}>
                  <Stack spacing={1.5}>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      {iconUrl ? (
                        <Avatar variant="rounded" src={iconUrl} sx={{ width: 48, height: 48 }}>
                          <WidgetsRoundedIcon />
                        </Avatar>
                      ) : (
                        <Avatar variant="rounded" sx={{ width: 48, height: 48, bgcolor: 'primary.50', color: 'primary.main' }}>
                          {resource.type === 'theme' ? <PaletteRoundedIcon /> : resource.type === 'wallpaper_source' ? <WallpaperRoundedIcon /> : <WidgetsRoundedIcon />}
                        </Avatar>
                      )}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="h6" noWrap>{resource.name}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          v{resource.version}{resource.author ? ` · ${resource.author.name}` : ''}
                        </Typography>
                      </Box>
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}>
                      {resource.summary || t('store.noDescription')}
                    </Typography>
                    {resource.tags && resource.tags.length > 0 && (
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {resource.tags.slice(0, 3).map((tag) => (
                          <Chip key={tag} size="small" variant="outlined" label={tag} />
                        ))}
                      </Stack>
                    )}
                  </Stack>
                </CardContent>
                <CardActions sx={{ px: 2, pb: 2, pt: 0 }}>
                  <Button size="small" variant="contained" onClick={() => onInstall(resource)}>
                    {t('common.install')}
                  </Button>
                  <Button size="small" onClick={() => onDetail(resource)}>
                    {t('store.detail.title')}
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    );
  }

  if (!payload) {
    return <EmptyState title={t('store.waitingTitle')} description={t('store.waitingDescription')} compact />;
  }

  return <EmptyState title={t('store.emptyTitle')} description={t('store.emptyDescription')} compact />;
}
