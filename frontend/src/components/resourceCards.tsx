import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import HelpOutlineRoundedIcon from '@mui/icons-material/HelpOutlineRounded';
import WallpaperRoundedIcon from '@mui/icons-material/WallpaperRounded';
import {
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';

import { EmptyState } from './shared';
import type { TranslateFn } from '../i18n';
import type { IntelligentMarketSource, WallpaperSource } from '../types';
import {
  getIntelligentMarketHealthColor,
  getIntelligentMarketHealthLabel,
  localizeSourceName,
} from '../utils';

export function SourceSummaryCard({ source, t }: { source: WallpaperSource | null; t: TranslateFn }) {
  if (!source) {
    return <EmptyState title={t('sourceSummary.emptyTitle')} description={t('sourceSummary.emptyDescription')} compact />;
  }

  return (
    <Card>
      <CardContent>
        <Stack spacing={1.5}>
          <Typography variant="h6">{localizeSourceName(source.identifier, source.name, t)}</Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip size="small" label={`v${source.version}`} />
            <Chip size="small" label={t('sourceSummary.apiCount', { count: (source.apis ?? []).length })} />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {source.description || source.details || t('sourceSummary.noDetails')}
          </Typography>
          <Typography variant="body2" color="text.secondary">{t('sourceSummary.identifier', { value: source.identifier })}</Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

export function IntelligentMarketSourceCard({
  source,
  selected,
  t,
  onSelect,
}: {
  source: IntelligentMarketSource;
  selected: boolean;
  t: TranslateFn;
  onSelect: () => void;
}) {
  const healthColor = getIntelligentMarketHealthColor(source.health_status);
  const healthLabel = getIntelligentMarketHealthLabel(source.health_status, t);

  return (
    <Card
      onClick={onSelect}
      sx={{
        height: '100%',
        cursor: 'pointer',
        borderColor: selected
          ? 'primary.main'
          : source.health_status === 'unhealthy'
            ? 'error.light'
            : 'divider',
        boxShadow: selected
          ? (theme) => `0 20px 40px ${alpha(theme.palette.primary.main, 0.18)}`
          : 'none',
        background: (theme) => source.health_status === 'unhealthy'
          ? `linear-gradient(180deg, ${alpha(theme.palette.error.light, 0.08)}, ${alpha(theme.palette.background.paper, 0.94)})`
          : `linear-gradient(180deg, ${alpha(theme.palette.primary.light, selected ? 0.14 : 0.06)}, ${alpha(theme.palette.background.paper, 0.96)})`,
        transition: 'transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease',
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: (theme) => `0 18px 36px ${alpha(theme.palette.common.black, 0.12)}`,
        },
      }}
    >
      <CardContent sx={{ height: '100%' }}>
        <Stack spacing={1.75} sx={{ height: '100%' }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            {source.icon ? (
              <Avatar variant="rounded" src={source.icon} sx={{ width: 52, height: 52 }}>
                <WallpaperRoundedIcon />
              </Avatar>
            ) : (
              <Avatar variant="rounded" sx={{ width: 52, height: 52, bgcolor: 'primary.50', color: 'primary.main' }}>
                <WallpaperRoundedIcon />
              </Avatar>
            )}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle1" noWrap>{source.friendly_name}</Typography>
              <Typography variant="body2" color="text.secondary" noWrap>{source.category}</Typography>
            </Box>
          </Stack>

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              color={healthColor}
              icon={source.health_status === 'healthy'
                ? <CheckCircleRoundedIcon />
                : source.health_status === 'unhealthy'
                  ? <ErrorOutlineRoundedIcon />
                  : <HelpOutlineRoundedIcon />}
              label={healthLabel}
            />
            <Chip size="small" variant="outlined" label={source.method} />
            <Chip size="small" variant="outlined" label={t('resource.im.summary.parameters', { count: source.parameters.filter((param) => param.enabled !== false).length })} />
          </Stack>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              minHeight: 64,
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {source.intro || t('resource.im.summary.noIntro')}
          </Typography>

          <Box sx={{ mt: 'auto' }}>
            <Typography
              variant="caption"
              color={source.health_status === 'unhealthy' ? 'error.main' : 'text.secondary'}
              sx={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {source.health_message || t('resource.im.health.messageFallback')}
            </Typography>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

export function IntelligentMarketSummaryCard({ source, t }: { source: IntelligentMarketSource | null; t: TranslateFn }) {
  if (!source) {
    return <EmptyState title={t('resource.im.emptyTitle')} description={t('resource.im.emptyDescription')} compact />;
  }

  const healthColor = getIntelligentMarketHealthColor(source.health_status);
  const healthLabel = getIntelligentMarketHealthLabel(source.health_status, t);

  return (
    <Card>
      <CardContent>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            {source.icon ? (
              <Avatar variant="rounded" src={source.icon} sx={{ width: 52, height: 52 }}>
                <WallpaperRoundedIcon />
              </Avatar>
            ) : (
              <Avatar variant="rounded" sx={{ width: 52, height: 52, bgcolor: 'primary.50', color: 'primary.main' }}>
                <WallpaperRoundedIcon />
              </Avatar>
            )}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="h6">{source.friendly_name}</Typography>
              <Typography variant="body2" color="text.secondary">{source.file_path}</Typography>
            </Box>
          </Stack>

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip size="small" label={source.category} />
            <Chip size="small" color={healthColor} label={healthLabel} />
            <Chip size="small" variant="outlined" label={`${source.method} · APICORE ${source.api_core_version}`} />
            <Chip size="small" variant="outlined" label={t('resource.im.summary.parameters', { count: source.parameters.filter((param) => param.enabled !== false).length })} />
          </Stack>

          <Typography variant="body2" color="text.secondary">
            {source.intro || t('resource.im.summary.noIntro')}
          </Typography>

          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Stack spacing={0.75}>
              <Typography variant="subtitle2">{t('resource.im.health.title')}</Typography>
              <Typography variant="body2" color={source.health_status === 'unhealthy' ? 'error.main' : 'text.secondary'}>
                {source.health_message || t('resource.im.health.messageFallback')}
              </Typography>
              {source.health_checked_at && (
                <Typography variant="caption" color="text.secondary">
                  {t('resource.im.health.checkedAt', { time: source.health_checked_at })}
                </Typography>
              )}
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Stack spacing={1}>
              <Typography variant="subtitle2">{t('resource.im.summary.endpoint')}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                {source.link}
              </Typography>
            </Stack>
          </Paper>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            {source.html_url && (
              <Button component="a" href={source.html_url} target="_blank" rel="noreferrer" variant="outlined" size="small">
                {t('resource.im.summary.openConfig')}
              </Button>
            )}
            {source.raw_url && (
              <Button component="a" href={source.raw_url} target="_blank" rel="noreferrer" variant="text" size="small">
                {t('resource.im.summary.openRaw')}
              </Button>
            )}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
