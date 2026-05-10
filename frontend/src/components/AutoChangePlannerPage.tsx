import AddRoundedIcon from '@mui/icons-material/AddRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import TimerRoundedIcon from '@mui/icons-material/TimerRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Slider,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';

import type { TranslateFn } from '../i18n';
import type {
  AutoChangeConfig,
  AutoChangeLocalSource,
  AutoChangePlan,
  AutoChangeStrategy,
  BootstrapPayload,
  WallpaperSource,
} from '../types';

type Props = {
  autoChange: BootstrapPayload['runtime']['auto_change'] | null | undefined;
  wallpaperSources: WallpaperSource[];
  t: TranslateFn;
  working: boolean;
  onSave: (config: AutoChangeConfig) => Promise<void> | void;
  onPickLocalFolder: () => Promise<{ path: string } | null>;
  onTriggerNow: (planId?: string) => Promise<void> | void;
};

type SourceOption = {
  value: string;
  label: string;
  description: string;
  kind: 'builtin' | 'ltws' | 'local';
};

type LocalSourceDraft = AutoChangeLocalSource | null;

const STRATEGY_OPTIONS: Array<{ value: AutoChangeStrategy; labelKey: string }> = [
  { value: 'random', labelKey: 'autoChange.strategy.random' },
  { value: 'sequential', labelKey: 'autoChange.strategy.sequential' },
  { value: 'non_repeat_random', labelKey: 'autoChange.strategy.nonRepeatRandom' },
  { value: 'weighted_random', labelKey: 'autoChange.strategy.weightedRandom' },
];

function createPlan(index: number): AutoChangePlan {
  return {
    id: `plan-${Date.now()}-${index}`,
    name: `计划 ${index}`,
    enabled: false,
    trigger: {
      kind: 'interval',
      interval_seconds: 3600,
      time_of_day: '09:00',
    },
    sources: ['favorites', 'bing'],
    selection: {
      mode: 'random',
      avoid_repeats: false,
      source_weights: {},
    },
  };
}

function createLocalSource(path: string): AutoChangeLocalSource {
  const segments = path.split(/[\\/]/).filter(Boolean);
  const name = segments[segments.length - 1] || '本地图片文件夹';
  return {
    id: `local-${Date.now()}`,
    name,
    path,
    enabled: true,
    selection: {
      mode: 'random',
      avoid_repeats: false,
      weights: {},
    },
    item_count: 0,
    items: [],
  };
}

function formatTrigger(plan: AutoChangePlan, t: TranslateFn): string {
  if (plan.trigger.kind === 'schedule') {
    return t('autoChange.trigger.scheduleAt', { time: plan.trigger.time_of_day });
  }
  return t('autoChange.trigger.intervalEvery', { seconds: plan.trigger.interval_seconds });
}

function sourceLabel(
  sourceRef: string,
  localSources: AutoChangeLocalSource[],
  wallpaperSources: WallpaperSource[],
  t: TranslateFn,
): string {
  if (sourceRef === 'favorites') {
    return t('autoChange.source.favorites');
  }
  if (sourceRef === 'bing') {
    return t('autoChange.source.bing');
  }
  if (sourceRef === 'spotlight') {
    return t('autoChange.source.spotlight');
  }
  if (sourceRef.startsWith('local:')) {
    const sourceId = sourceRef.split(':', 2)[1];
    return localSources.find((item) => item.id === sourceId)?.name ?? t('autoChange.source.localFolder');
  }
  if (sourceRef.startsWith('ltws:')) {
    const [, sourceId, apiName] = sourceRef.split(':', 3);
    const source = wallpaperSources.find((item) => item.identifier === sourceId);
    return source ? `${source.name} / ${apiName}` : sourceRef;
  }
  return sourceRef;
}

export function AutoChangePlannerPage({ autoChange, wallpaperSources, t, working, onSave, onPickLocalFolder, onTriggerNow }: Props) {
  const plans = autoChange?.plans ?? [createPlan(1)];
  const localSources = autoChange?.local_sources ?? [];
  const [selectedPlanId, setSelectedPlanId] = useState<string>(plans[0]?.id ?? '');
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  const [sourceWeightDialogOpen, setSourceWeightDialogOpen] = useState(false);
  const [sourceWeightDraft, setSourceWeightDraft] = useState<Record<string, number>>({});
  const [localSourceDialogId, setLocalSourceDialogId] = useState<string | null>(null);
  const [localSourceDraft, setLocalSourceDraft] = useState<LocalSourceDraft>(null);

  useEffect(() => {
    if (!plans.some((plan) => plan.id === selectedPlanId)) {
      setSelectedPlanId(plans[0]?.id ?? '');
    }
  }, [plans, selectedPlanId]);

  useEffect(() => {
    if (!localSourceDialogId) return;
    const source = localSources.find((item) => item.id === localSourceDialogId);
    if (!source) return;
    setLocalSourceDraft((draft) => {
      if (!draft) return draft;
      const backendItems = source.items ?? [];
      if (backendItems.length === 0 && (draft.items ?? []).length > 0) return draft;
      return { ...draft, items: backendItems };
    });
  }, [localSources, localSourceDialogId]);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) ?? plans[0] ?? null,
    [plans, selectedPlanId],
  );

  const sourceOptions = useMemo<SourceOption[]>(() => {
    const builtin: SourceOption[] = [
      { value: 'favorites', label: t('autoChange.source.favorites'), description: t('autoChange.source.favoritesDescription'), kind: 'builtin' },
      { value: 'bing', label: t('autoChange.source.bing'), description: t('autoChange.source.bingDescription'), kind: 'builtin' },
      { value: 'spotlight', label: t('autoChange.source.spotlight'), description: t('autoChange.source.spotlightDescription'), kind: 'builtin' },
    ];
    const ltws: SourceOption[] = wallpaperSources
      .filter((source) => !source.invalid && source.enabled !== false)
      .flatMap((source) =>
        (source.apis ?? []).map((api) => ({
          value: `ltws:${source.identifier}:${api.name}`,
          label: `${source.name} / ${api.name}`,
          description: api.description?.trim() || source.description?.trim() || t('autoChange.source.ltwsDescription'),
          kind: 'ltws' as const,
        })),
      );
    return [...builtin, ...ltws];
  }, [t, wallpaperSources]);

  function commit(nextPlans: AutoChangePlan[], nextLocalSources: AutoChangeLocalSource[] = localSources) {
    void onSave({
      enabled: nextPlans.some((plan) => plan.enabled),
      plans: nextPlans,
      local_sources: nextLocalSources,
    });
  }

  function updateSelectedPlan(mutator: (plan: AutoChangePlan) => AutoChangePlan) {
    if (!selectedPlan) {
      return;
    }
    commit(plans.map((plan) => (plan.id === selectedPlan.id ? mutator(plan) : plan)));
  }

  function addPlan() {
    const nextPlan = createPlan(plans.length + 1);
    const nextPlans = [...plans, nextPlan];
    setSelectedPlanId(nextPlan.id);
    commit(nextPlans);
  }

  function deleteSelectedPlan() {
    if (!selectedPlan || plans.length <= 1) {
      return;
    }
    const nextPlans = plans.filter((plan) => plan.id !== selectedPlan.id);
    const orphanedLocalIds = localSources
      .map((source) => `local:${source.id}`)
      .filter((ref) =>
        selectedPlan.sources.includes(ref) && !nextPlans.some((plan) => plan.sources.includes(ref)),
      )
      .map((ref) => ref.split(':', 2)[1]);
    const nextLocalSources = orphanedLocalIds.length > 0
      ? localSources.filter((source) => !orphanedLocalIds.includes(source.id))
      : localSources;
    setSelectedPlanId(nextPlans[0]?.id ?? '');
    commit(nextPlans, nextLocalSources);
  }

  function addSourceToPlan(sourceRef: string) {
    if (!selectedPlan || selectedPlan.sources.includes(sourceRef)) {
      return;
    }
    updateSelectedPlan((plan) => ({ ...plan, sources: [...plan.sources, sourceRef] }));
    setSourceDialogOpen(false);
  }

  async function addLocalSource() {
    const picked = await onPickLocalFolder();
    if (!picked?.path || !selectedPlan) {
      return;
    }
    const existingSource = localSources.find((source) => source.path === picked.path);
    const targetLocalSource = existingSource ?? createLocalSource(picked.path);
    const nextLocalSources = existingSource ? localSources : [...localSources, targetLocalSource];
    const targetRef = `local:${targetLocalSource.id}`;
    const nextPlans = plans.map((plan) =>
      plan.id === selectedPlan.id
        ? { ...plan, sources: plan.sources.includes(targetRef) ? plan.sources : [...plan.sources, targetRef] }
        : plan,
    );
    commit(nextPlans, nextLocalSources);
    setLocalSourceDialogId(targetLocalSource.id);
    setLocalSourceDraft(targetLocalSource);
    setSourceDialogOpen(false);
  }

  function removeSourceFromPlan(sourceRef: string) {
    const nextPlans = plans.map((plan) =>
      plan.id === selectedPlan?.id
        ? { ...plan, sources: plan.sources.filter((item) => item !== sourceRef) }
        : plan,
    );

    if (sourceRef.startsWith('local:')) {
      const sourceId = sourceRef.split(':', 2)[1];
      const stillReferenced = nextPlans.some((plan) => plan.sources.includes(sourceRef));
      if (!stillReferenced) {
        const nextLocalSources = localSources.filter((source) => source.id !== sourceId);
        commit(nextPlans, nextLocalSources);
        return;
      }
    }

    commit(nextPlans);
  }

  function openSourceWeightDialog() {
    if (!selectedPlan) {
      return;
    }
    setSourceWeightDraft({ ...selectedPlan.selection.source_weights });
    setSourceWeightDialogOpen(true);
  }

  function saveSourceWeights() {
    updateSelectedPlan((plan) => ({
      ...plan,
      selection: {
        ...plan.selection,
        source_weights: { ...sourceWeightDraft },
      },
    }));
    setSourceWeightDialogOpen(false);
  }

  function openLocalSourceDialog(sourceId: string) {
    const source = localSources.find((item) => item.id === sourceId) ?? null;
    setLocalSourceDialogId(sourceId);
    setLocalSourceDraft(source ? { ...source, selection: { ...source.selection, weights: { ...source.selection.weights } }, items: [...(source.items ?? [])] } : null);
  }

  function saveLocalSourceDialog() {
    if (!localSourceDialogId || !localSourceDraft) {
      return;
    }
    const nextLocalSources = localSources.map((source) => (source.id === localSourceDialogId ? localSourceDraft : source));
    commit(plans, nextLocalSources);
    setLocalSourceDialogId(null);
    setLocalSourceDraft(null);
  }

  function removeLocalSourceCompletely(sourceId: string) {
    const nextLocalSources = localSources.filter((source) => source.id !== sourceId);
    const targetRef = `local:${sourceId}`;
    const nextPlans = plans.map((plan) => ({
      ...plan,
      sources: plan.sources.filter((item) => item !== targetRef),
      selection: {
        ...plan.selection,
        source_weights: Object.fromEntries(Object.entries(plan.selection.source_weights).filter(([key]) => key !== targetRef)),
      },
    }));
    commit(nextPlans, nextLocalSources);
    setLocalSourceDialogId(null);
    setLocalSourceDraft(null);
  }

  if (!selectedPlan) {
    return null;
  }

  return (
    <Stack spacing={2.5}>
      <Card>
        <CardContent>
          <Stack spacing={1.5}>
            <Chip icon={<AutoAwesomeRoundedIcon />} label={t('autoChange.eyebrow')} color="primary" variant="outlined" sx={{ alignSelf: 'flex-start' }} />
            <Typography variant="h4">{t('autoChange.title')}</Typography>
            <Typography color="text.secondary">{t('autoChange.subtitle')}</Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
              <Chip color={autoChange?.running ? 'success' : 'default'} label={autoChange?.running ? t('common.running') : t('common.stopped')} />
              <Chip label={autoChange?.next_plan_name ? t('autoChange.nextPlan', { name: autoChange.next_plan_name }) : t('autoChange.noNextPlan')} variant="outlined" />
              <Chip label={autoChange?.next_run_at ? t('autoChange.nextRun', { value: autoChange.next_run_at }) : t('autoChange.noNextRun')} variant="outlined" />
            </Stack>
            {autoChange?.last_error && <Alert severity="warning">{autoChange.last_error}</Alert>}
          </Stack>
        </CardContent>
      </Card>

      <Stack direction={{ xs: 'column', xl: 'row' }} spacing={2.5} alignItems="stretch">
        <Stack spacing={2} sx={{ width: { xs: '100%', xl: 360 }, flexShrink: 0 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Stack spacing={1.5}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="h6">{t('autoChange.planList')}</Typography>
                  <Button size="small" startIcon={<AddRoundedIcon />} onClick={addPlan} disabled={working}>
                    {t('autoChange.addPlan')}
                  </Button>
                </Stack>
                {plans.map((plan) => (
                  <Card
                    key={plan.id}
                    variant={plan.id === selectedPlan.id ? 'elevation' : 'outlined'}
                    sx={{ cursor: 'pointer', borderColor: plan.id === selectedPlan.id ? 'primary.main' : undefined }}
                    onClick={() => setSelectedPlanId(plan.id)}
                  >
                    <CardContent>
                      <Stack spacing={1}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                          <Typography variant="subtitle1">{plan.name}</Typography>
                          <Chip size="small" color={plan.enabled ? 'success' : 'default'} label={plan.enabled ? t('autoChange.planEnabled') : t('autoChange.planDisabled')} />
                        </Stack>
                        <Typography variant="body2" color="text.secondary">{formatTrigger(plan, t)}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {t('autoChange.planSources', { count: plan.sources.length })}
                        </Typography>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Stack spacing={1.25}>
                <Typography variant="h6">{t('autoChange.runtimeTitle')}</Typography>
                <Typography variant="body2" color="text.secondary">{t('autoChange.lastPlan', { name: autoChange?.last_plan_name ?? t('common.none') })}</Typography>
                <Typography variant="body2" color="text.secondary">{t('autoChange.lastWallpaper', { name: autoChange?.last_item_title ?? t('common.none') })}</Typography>
                <Typography variant="body2" color="text.secondary">{t('autoChange.lastRunAt', { value: autoChange?.last_run_at ?? t('common.none') })}</Typography>
                <Button variant="contained" startIcon={<PlayArrowRoundedIcon />} onClick={() => void onTriggerNow(selectedPlan.id)} disabled={working || !selectedPlan.enabled}>
                  {t('autoChange.runSelectedPlan')}
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Stack>

        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Stack spacing={2.5}>
              <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1.5}>
                <Box>
                  <Typography variant="h5">{t('autoChange.editorTitle')}</Typography>
                  <Typography variant="body2" color="text.secondary">{t('autoChange.editorSubtitle')}</Typography>
                </Box>
                <Button color="error" startIcon={<DeleteOutlineRoundedIcon />} onClick={deleteSelectedPlan} disabled={plans.length <= 1 || working}>
                  {t('autoChange.deletePlan')}
                </Button>
              </Stack>

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <TextField
                  label={t('autoChange.planName')}
                  value={selectedPlan.name}
                  onChange={(event) => updateSelectedPlan((plan) => ({ ...plan, name: event.target.value }))}
                  fullWidth
                />
                <Stack direction="row" alignItems="center" spacing={1.25} sx={{ minWidth: 220 }}>
                  <Switch checked={selectedPlan.enabled} onChange={(event) => updateSelectedPlan((plan) => ({ ...plan, enabled: event.target.checked }))} />
                  <Typography>{selectedPlan.enabled ? t('autoChange.planEnabled') : t('autoChange.planDisabled')}</Typography>
                </Stack>
              </Stack>

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <TextField
                  select
                  label={t('autoChange.triggerType')}
                  value={selectedPlan.trigger.kind}
                  onChange={(event) =>
                    updateSelectedPlan((plan) => ({
                      ...plan,
                      trigger: { ...plan.trigger, kind: event.target.value as AutoChangePlan['trigger']['kind'] },
                    }))
                  }
                  fullWidth
                >
                  <MenuItem value="interval">{t('autoChange.trigger.interval')}</MenuItem>
                  <MenuItem value="schedule">{t('autoChange.trigger.schedule')}</MenuItem>
                </TextField>
                {selectedPlan.trigger.kind === 'interval' ? (
                  <TextField
                    type="number"
                    label={t('autoChange.intervalSeconds')}
                    value={selectedPlan.trigger.interval_seconds}
                    onChange={(event) =>
                      updateSelectedPlan((plan) => ({
                        ...plan,
                        trigger: {
                          ...plan.trigger,
                          interval_seconds: Math.max(30, Number(event.target.value || 3600)),
                        },
                      }))
                    }
                    fullWidth
                    InputProps={{ startAdornment: <TimerRoundedIcon sx={{ mr: 1, color: 'text.secondary' }} /> }}
                  />
                ) : (
                  <TextField
                    type="time"
                    label={t('autoChange.scheduleTime')}
                    value={selectedPlan.trigger.time_of_day}
                    onChange={(event) =>
                      updateSelectedPlan((plan) => ({
                        ...plan,
                        trigger: { ...plan.trigger, time_of_day: event.target.value || '09:00' },
                      }))
                    }
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                    InputProps={{ startAdornment: <ScheduleRoundedIcon sx={{ mr: 1, color: 'text.secondary' }} /> }}
                  />
                )}
              </Stack>

              <Divider />

              <Stack spacing={1.25}>
                <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1.5}>
                  <Box>
                    <Typography variant="h6">{t('autoChange.sourcesTitle')}</Typography>
                    <Typography variant="body2" color="text.secondary">{t('autoChange.sourcesSubtitle')}</Typography>
                  </Box>
                  <Button startIcon={<AddRoundedIcon />} onClick={() => setSourceDialogOpen(true)} disabled={working}>
                    {t('autoChange.addSource')}
                  </Button>
                </Stack>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {selectedPlan.sources.map((sourceRef) => {
                    const isLocal = sourceRef.startsWith('local:');
                    const localSourceId = isLocal ? sourceRef.split(':', 2)[1] : '';
                    return (
                      <Stack key={sourceRef} direction="row" alignItems="center" spacing={0.5} sx={{ px: 1.25, py: 0.75, borderRadius: 999, bgcolor: 'action.hover' }}>
                        <Typography variant="body2">{sourceLabel(sourceRef, localSources, wallpaperSources, t)}</Typography>
                        {isLocal && (
                          <IconButton size="small" onClick={() => openLocalSourceDialog(localSourceId)}>
                            <SettingsRoundedIcon fontSize="inherit" />
                          </IconButton>
                        )}
                        <IconButton size="small" onClick={() => removeSourceFromPlan(sourceRef)}>
                          <DeleteOutlineRoundedIcon fontSize="inherit" />
                        </IconButton>
                      </Stack>
                    );
                  })}
                  {selectedPlan.sources.length === 0 && <Typography color="text.secondary">{t('autoChange.noSources')}</Typography>}
                </Stack>
              </Stack>

              <Divider />

              <Stack spacing={1.25}>
                <Typography variant="h6">{t('autoChange.selectionTitle')}</Typography>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems="stretch">
                  <TextField
                    select
                    label={t('autoChange.selectionMode')}
                    value={selectedPlan.selection.mode}
                    onChange={(event) => {
                      const nextMode = event.target.value as AutoChangeStrategy;
                      updateSelectedPlan((plan) => ({
                        ...plan,
                        selection: {
                          ...plan.selection,
                          mode: nextMode,
                          avoid_repeats: nextMode === 'weighted_random' ? plan.selection.avoid_repeats : false,
                        },
                      }));
                    }}
                    sx={{ flex: selectedPlan.selection.mode === 'weighted_random' ? '0 0 260px' : 1 }}
                  >
                    {STRATEGY_OPTIONS.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </MenuItem>
                    ))}
                  </TextField>
                  {selectedPlan.selection.mode === 'weighted_random' && (
                    <Button variant="outlined" startIcon={<TuneRoundedIcon />} onClick={openSourceWeightDialog}>
                      {t('autoChange.configureWeights')}
                    </Button>
                  )}
                  {selectedPlan.selection.mode === 'weighted_random' && (
                    <Stack direction="row" alignItems="center" spacing={1.25} sx={{ minWidth: 220 }}>
                      <Switch
                        checked={selectedPlan.selection.avoid_repeats}
                        onChange={(event) =>
                          updateSelectedPlan((plan) => ({
                            ...plan,
                            selection: { ...plan.selection, avoid_repeats: event.target.checked },
                          }))
                        }
                      />
                      <Typography>{t('autoChange.avoidRepeats')}</Typography>
                    </Stack>
                  )}
                </Stack>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      </Stack>

      <Dialog open={sourceDialogOpen} onClose={() => setSourceDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{t('autoChange.addSourceDialogTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.25} sx={{ pt: 1 }}>
            <Button variant="outlined" startIcon={<FolderOpenRoundedIcon />} onClick={() => void addLocalSource()}>
              {t('autoChange.addLocalFolder')}
            </Button>
            {sourceOptions.map((option) => {
              const disabled = selectedPlan.sources.includes(option.value);
              return (
                <Card key={option.value} variant="outlined" sx={{ opacity: disabled ? 0.56 : 1 }}>
                  <CardContent>
                    <Stack direction="row" justifyContent="space-between" spacing={1.5} alignItems="center">
                      <Box>
                        <Typography variant="subtitle1">{option.label}</Typography>
                        <Typography variant="body2" color="text.secondary">{option.description}</Typography>
                      </Box>
                      <Button onClick={() => addSourceToPlan(option.value)} disabled={disabled}>
                        {disabled ? t('autoChange.added') : t('autoChange.addThisSource')}
                      </Button>
                    </Stack>
                  </CardContent>
                </Card>
              );
            })}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSourceDialogOpen(false)}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={sourceWeightDialogOpen} onClose={() => setSourceWeightDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{t('autoChange.sourceWeightDialogTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {selectedPlan.sources.map((sourceRef) => (
              <Box key={sourceRef}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="subtitle2">{sourceLabel(sourceRef, localSources, wallpaperSources, t)}</Typography>
                  <Typography variant="body2" color="text.secondary">{Math.round(sourceWeightDraft[sourceRef] ?? 100)}</Typography>
                </Stack>
                <Slider
                  min={0}
                  max={200}
                  step={1}
                  value={sourceWeightDraft[sourceRef] ?? 100}
                  onChange={(_, value) => setSourceWeightDraft((current) => ({ ...current, [sourceRef]: Number(value) }))}
                />
              </Box>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSourceWeightDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={saveSourceWeights}>{t('autoChange.applyChanges')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(localSourceDialogId && localSourceDraft)} onClose={() => { setLocalSourceDialogId(null); setLocalSourceDraft(null); }} fullWidth maxWidth="md">
        <DialogTitle>{t('autoChange.localSourceDialogTitle')}</DialogTitle>
        <DialogContent>
          {localSourceDraft && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                label={t('autoChange.localSourceName')}
                value={localSourceDraft.name}
                onChange={(event) => setLocalSourceDraft({ ...localSourceDraft, name: event.target.value })}
                fullWidth
              />
              <TextField label={t('autoChange.localSourcePath')} value={localSourceDraft.path} fullWidth disabled />
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <TextField
                  select
                  label={t('autoChange.localSelectionMode')}
                  value={localSourceDraft.selection.mode}
                  onChange={(event) => {
                    const nextMode = event.target.value as AutoChangeStrategy;
                    setLocalSourceDraft({
                      ...localSourceDraft,
                      selection: {
                        ...localSourceDraft.selection,
                        mode: nextMode,
                        avoid_repeats: nextMode === 'weighted_random' ? localSourceDraft.selection.avoid_repeats : false,
                      },
                    });
                  }}
                  fullWidth
                >
                  {STRATEGY_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </MenuItem>
                  ))}
                </TextField>
                {localSourceDraft.selection.mode === 'weighted_random' && (
                  <Stack direction="row" alignItems="center" spacing={1.25} sx={{ minWidth: 220 }}>
                    <Switch
                      checked={localSourceDraft.selection.avoid_repeats}
                      onChange={(event) =>
                        setLocalSourceDraft({
                          ...localSourceDraft,
                          selection: { ...localSourceDraft.selection, avoid_repeats: event.target.checked },
                        })
                      }
                    />
                    <Typography>{t('autoChange.avoidRepeats')}</Typography>
                  </Stack>
                )}
              </Stack>
              {localSourceDraft.selection.mode === 'weighted_random' && (
                <Stack spacing={1.5}>
                  <Typography variant="subtitle1">{t('autoChange.localWeightTitle')}</Typography>
                  {(localSourceDraft.items ?? []).length === 0 ? (
                    <Alert severity="info">{t('autoChange.localWeightEmpty')}</Alert>
                  ) : (
                    (localSourceDraft.items ?? []).map((item) => (
                      <Box key={item.id}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                          <Box sx={{ minWidth: 0, pr: 2 }}>
                            <Typography variant="subtitle2" noWrap>{item.name}</Typography>
                            <Typography variant="caption" color="text.secondary" noWrap>{item.path}</Typography>
                          </Box>
                          <Typography variant="body2" color="text.secondary">{Math.round(localSourceDraft.selection.weights[item.id] ?? item.weight ?? 100)}</Typography>
                        </Stack>
                        <Slider
                          min={0}
                          max={200}
                          step={1}
                          value={localSourceDraft.selection.weights[item.id] ?? item.weight ?? 100}
                          onChange={(_, value) =>
                            setLocalSourceDraft({
                              ...localSourceDraft,
                              selection: {
                                ...localSourceDraft.selection,
                                weights: { ...localSourceDraft.selection.weights, [item.id]: Number(value) },
                              },
                            })
                          }
                        />
                      </Box>
                    ))
                  )}
                </Stack>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          {localSourceDialogId && (
            <Button color="error" onClick={() => removeLocalSourceCompletely(localSourceDialogId)}>
              {t('autoChange.removeLocalSource')}
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => { setLocalSourceDialogId(null); setLocalSourceDraft(null); }}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={saveLocalSourceDialog}>{t('autoChange.applyChanges')}</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}