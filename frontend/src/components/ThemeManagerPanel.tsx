import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import PaletteRoundedIcon from '@mui/icons-material/PaletteRounded';
import PublishRoundedIcon from '@mui/icons-material/PublishRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  MenuItem,
  Slider,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useEffect, useMemo, useState } from 'react';

import type { TranslateFn } from '../i18n';
import {
  THEME_CSS_TARGETS,
  createDraftTheme,
  getThemeRiskFlags,
  normalizeThemeDocument,
} from '../themeSystem';
import type { ThemeCatalogItem, ThemeCssTarget, ThemeDocument } from '../themeSystem';
import { useResolvedThemeAssetSource } from '../useResolvedThemeAssetSource';

type ThemeManagerPanelProps = {
  t: TranslateFn;
  activeThemeId: string;
  activeThemeDocument: ThemeDocument;
  themes: ThemeCatalogItem[];
  appVersion: string;
  onApplyTheme: (themeId: string) => Promise<void>;
  onSaveTheme: (themeDocument: ThemeDocument) => Promise<boolean>;
  onDeleteTheme: (themeId: string) => Promise<void>;
  onImportTheme: () => Promise<void>;
  onExportTheme: (themeDocument: ThemeDocument) => Promise<void>;
  onPickThemeAsset: (assetKind: 'image' | 'video' | 'poster') => Promise<string | null>;
  onPreviewTheme: (themeDocument: ThemeDocument | null) => void;
};

type EditorMode = 'create' | 'edit';
type EditorTab = 'meta' | 'palette' | 'background' | 'css';

const editorTabs: EditorTab[] = ['meta', 'palette', 'background', 'css'];

export function ThemeManagerPanel({
  t,
  activeThemeId,
  activeThemeDocument,
  themes,
  appVersion,
  onApplyTheme,
  onSaveTheme,
  onDeleteTheme,
  onImportTheme,
  onExportTheme,
  onPickThemeAsset,
  onPreviewTheme,
}: ThemeManagerPanelProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('md'));
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>('create');
  const [editorTab, setEditorTab] = useState<EditorTab>('meta');
  const [draftTheme, setDraftTheme] = useState<ThemeDocument | null>(null);
  const draftIconSource = useResolvedThemeAssetSource(draftTheme?.metadata.icon);

  useEffect(() => {
    if (!editorOpen || !draftTheme) {
      return;
    }
    onPreviewTheme(draftTheme);
  }, [draftTheme, editorOpen, onPreviewTheme]);

  function closeEditor() {
    setEditorOpen(false);
    setDraftTheme(null);
    setEditorTab('meta');
    onPreviewTheme(null);
  }

  function openCreateEditor(baseTheme?: ThemeDocument) {
    setEditorMode('create');
    setEditorOpen(true);
    setEditorTab('meta');
    setDraftTheme(createDraftTheme(baseTheme ?? activeThemeDocument, appVersion));
  }

  function openEditEditor(document: ThemeDocument) {
    setEditorMode('edit');
    setEditorOpen(true);
    setEditorTab('meta');
    setDraftTheme(normalizeThemeDocument(document, document.metadata.name));
  }

  async function handleSaveTheme() {
    if (!draftTheme) {
      return;
    }
    const saved = await onSaveTheme(draftTheme);
    if (saved) {
      closeEditor();
    }
  }

  function updateDraftTheme(updater: (current: ThemeDocument) => ThemeDocument) {
    setDraftTheme((current) => {
      if (!current) {
        return current;
      }
      return updater(current);
    });
  }

  async function pickBackgroundAsset(assetField: 'source' | 'poster') {
    if (!draftTheme) {
      return;
    }

    const assetKind = assetField === 'poster'
      ? 'poster'
      : draftTheme.theme.background.kind === 'video'
        ? 'video'
        : 'image';
    const selectedPath = await onPickThemeAsset(assetKind);
    if (!selectedPath) {
      return;
    }

    updateDraftTheme((current) => ({
      ...current,
      theme: {
        ...current.theme,
        background: {
          ...current.theme.background,
          [assetField]: selectedPath,
        },
      },
    }));
  }

  const supportedTargets = useMemo(() => Object.keys(THEME_CSS_TARGETS) as ThemeCssTarget[], []);

  return (
    <Card data-ltw-theme-manager="true">
      <CardContent>
        <Stack spacing={2.5}>
          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} alignItems={{ lg: 'center' }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="h5">{t('themeManager.title')}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                {t('themeManager.subtitle')}
              </Typography>
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
              <Button variant="outlined" startIcon={<PublishRoundedIcon />} onClick={() => void onImportTheme()}>
                {t('themeManager.importAction')}
              </Button>
              <Button variant="outlined" startIcon={<ContentCopyRoundedIcon />} onClick={() => openCreateEditor(activeThemeDocument)}>
                {t('themeManager.duplicateCurrentAction')}
              </Button>
              <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => openCreateEditor()}>
                {t('themeManager.createAction')}
              </Button>
            </Stack>
          </Stack>

          <Alert severity="warning" icon={<WarningAmberRoundedIcon fontSize="inherit" />}>
            {t('themeManager.securityWarning')}
          </Alert>

          <Grid container spacing={2}>
            {themes.map((entry) => {
              const riskFlags = getThemeRiskFlags(entry.document);
              const isActive = entry.id === activeThemeId;
              return (
                <Grid key={entry.id} size={{ xs: 12, xl: 6 }}>
                  <ThemeCard
                    t={t}
                    document={entry.document}
                    source={entry.source}
                    active={isActive}
                    riskFlags={riskFlags}
                    onApply={() => void onApplyTheme(entry.id)}
                    onEdit={entry.source === 'custom' ? () => openEditEditor(entry.document) : undefined}
                    onDuplicate={() => openCreateEditor(entry.document)}
                    onExport={() => void onExportTheme(entry.document)}
                    onDelete={entry.source === 'custom' ? () => void onDeleteTheme(entry.id) : undefined}
                  />
                </Grid>
              );
            })}
          </Grid>
        </Stack>
      </CardContent>

      <Dialog open={editorOpen} onClose={closeEditor} fullWidth maxWidth="lg" fullScreen={fullScreen}>
        <DialogTitle>{editorMode === 'create' ? t('themeManager.editor.createTitle') : t('themeManager.editor.editTitle')}</DialogTitle>
        <DialogContent dividers>
          {draftTheme && (
            <Stack spacing={2.5}>
              <Alert severity="info">{t('themeManager.editor.previewHint')}</Alert>
              <Tabs value={editorTab} onChange={(_, next) => setEditorTab(next)} variant="scrollable" scrollButtons="auto">
                <Tab value="meta" label={t('themeManager.editor.tab.meta')} />
                <Tab value="palette" label={t('themeManager.editor.tab.palette')} />
                <Tab value="background" label={t('themeManager.editor.tab.background')} />
                <Tab value="css" label={t('themeManager.editor.tab.css')} />
              </Tabs>

              {editorTab === 'meta' && (
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, md: 7 }}>
                    <Stack spacing={2}>
                      <TextField
                        label={t('themeManager.editor.name')}
                        value={draftTheme.metadata.name}
                        onChange={(event) => updateDraftTheme((current) => ({
                          ...current,
                          metadata: {
                            ...current.metadata,
                            name: event.target.value,
                          },
                        }))}
                        fullWidth
                        required
                      />
                      <TextField
                        label={t('themeManager.editor.summary')}
                        value={draftTheme.metadata.summary ?? ''}
                        onChange={(event) => updateDraftTheme((current) => ({
                          ...current,
                          metadata: {
                            ...current.metadata,
                            summary: event.target.value,
                          },
                        }))}
                        fullWidth
                      />
                      <TextField
                        label={t('themeManager.editor.descriptionMd')}
                        value={draftTheme.metadata.description_md ?? ''}
                        onChange={(event) => updateDraftTheme((current) => ({
                          ...current,
                          metadata: {
                            ...current.metadata,
                            description_md: event.target.value,
                          },
                        }))}
                        multiline
                        minRows={8}
                        fullWidth
                        helperText={t('themeManager.editor.descriptionMdHint')}
                      />
                    </Stack>
                  </Grid>
                  <Grid size={{ xs: 12, md: 5 }}>
                    <Stack spacing={2}>
                      <TextField
                        label={t('themeManager.editor.icon')}
                        value={draftTheme.metadata.icon ?? ''}
                        onChange={(event) => updateDraftTheme((current) => ({
                          ...current,
                          metadata: {
                            ...current.metadata,
                            icon: event.target.value,
                          },
                        }))}
                        fullWidth
                        helperText={t('themeManager.editor.iconHint')}
                      />
                      <Stack direction="row" spacing={1.5} alignItems="center">
                        <Avatar src={draftIconSource} sx={{ width: 56, height: 56 }}>
                          <PaletteRoundedIcon />
                        </Avatar>
                        <Typography variant="body2" color="text.secondary">
                          {t('themeManager.editor.iconPreview')}
                        </Typography>
                      </Stack>
                      <TextField
                        label={t('themeManager.editor.author')}
                        value={draftTheme.metadata.author ?? ''}
                        onChange={(event) => updateDraftTheme((current) => ({
                          ...current,
                          metadata: {
                            ...current.metadata,
                            author: event.target.value,
                          },
                        }))}
                        fullWidth
                      />
                      <TextField
                        label={t('themeManager.editor.authorWebsite')}
                        value={draftTheme.metadata.author_website ?? ''}
                        onChange={(event) => updateDraftTheme((current) => ({
                          ...current,
                          metadata: {
                            ...current.metadata,
                            author_website: event.target.value,
                          },
                        }))}
                        fullWidth
                      />
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <TextField
                          label={t('themeManager.editor.version')}
                          value={draftTheme.metadata.version ?? ''}
                          onChange={(event) => updateDraftTheme((current) => ({
                            ...current,
                            metadata: {
                              ...current.metadata,
                              version: event.target.value,
                            },
                          }))}
                          fullWidth
                        />
                        <TextField
                          label={t('themeManager.editor.supportedAppVersion')}
                          value={draftTheme.metadata.supported_app_version ?? ''}
                          onChange={(event) => updateDraftTheme((current) => ({
                            ...current,
                            metadata: {
                              ...current.metadata,
                              supported_app_version: event.target.value,
                            },
                          }))}
                          fullWidth
                          helperText={t('themeManager.editor.supportedAppVersionHint', { version: appVersion })}
                        />
                      </Stack>
                    </Stack>
                  </Grid>
                </Grid>
              )}

              {editorTab === 'palette' && (
                <Stack spacing={2.5}>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, md: 4 }}>
                      <TextField
                        select
                        label={t('themeManager.editor.mode')}
                        value={draftTheme.theme.mode}
                        onChange={(event) => updateDraftTheme((current) => normalizeThemeDocument({
                          ...current,
                          theme: {
                            ...current.theme,
                            mode: event.target.value,
                          },
                        }, current.metadata.name))}
                        fullWidth
                      >
                        <MenuItem value="light">{t('themeManager.editor.modeLight')}</MenuItem>
                        <MenuItem value="dark">{t('themeManager.editor.modeDark')}</MenuItem>
                      </TextField>
                    </Grid>
                    <Grid size={{ xs: 12, md: 4 }}>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        {t('themeManager.editor.borderRadius')}
                      </Typography>
                      <Slider
                        value={draftTheme.theme.shape.border_radius}
                        min={0}
                        max={40}
                        step={1}
                        valueLabelDisplay="auto"
                        onChange={(_, value) => updateDraftTheme((current) => ({
                          ...current,
                          theme: {
                            ...current.theme,
                            shape: {
                              ...current.theme.shape,
                              border_radius: Number(value),
                            },
                          },
                        }))}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, md: 4 }}>
                      <TextField
                        label={t('themeManager.editor.fontFamily')}
                        value={draftTheme.theme.typography.font_family}
                        onChange={(event) => updateDraftTheme((current) => ({
                          ...current,
                          theme: {
                            ...current.theme,
                            typography: {
                              ...current.theme.typography,
                              font_family: event.target.value,
                            },
                          },
                        }))}
                        fullWidth
                      />
                    </Grid>
                  </Grid>
                  <Grid container spacing={2}>
                    <ColorField label={t('themeManager.editor.color.primary')} value={draftTheme.theme.palette.primary} onChange={(value) => updatePaletteValue('primary', value, updateDraftTheme)} />
                    <ColorField label={t('themeManager.editor.color.secondary')} value={draftTheme.theme.palette.secondary} onChange={(value) => updatePaletteValue('secondary', value, updateDraftTheme)} />
                    <ColorField label={t('themeManager.editor.color.success')} value={draftTheme.theme.palette.success} onChange={(value) => updatePaletteValue('success', value, updateDraftTheme)} />
                    <ColorField label={t('themeManager.editor.color.warning')} value={draftTheme.theme.palette.warning} onChange={(value) => updatePaletteValue('warning', value, updateDraftTheme)} />
                    <ColorField label={t('themeManager.editor.color.info')} value={draftTheme.theme.palette.info} onChange={(value) => updatePaletteValue('info', value, updateDraftTheme)} />
                    <ColorField label={t('themeManager.editor.color.backgroundDefault')} value={draftTheme.theme.palette.background_default} onChange={(value) => updatePaletteValue('background_default', value, updateDraftTheme)} />
                    <ColorField label={t('themeManager.editor.color.backgroundPaper')} value={draftTheme.theme.palette.background_paper} onChange={(value) => updatePaletteValue('background_paper', value, updateDraftTheme)} />
                    <ColorField label={t('themeManager.editor.color.textPrimary')} value={draftTheme.theme.palette.text_primary} onChange={(value) => updatePaletteValue('text_primary', value, updateDraftTheme)} />
                    <ColorField label={t('themeManager.editor.color.textSecondary')} value={draftTheme.theme.palette.text_secondary} onChange={(value) => updatePaletteValue('text_secondary', value, updateDraftTheme)} />
                  </Grid>
                  <Divider />
                  <Grid container spacing={2}>
                    <SliderField
                      label={t('themeManager.editor.surface.blur')}
                      value={draftTheme.theme.surface.blur}
                      min={0}
                      max={48}
                      step={1}
                      onChange={(value) => updateSurfaceValue('blur', value, updateDraftTheme)}
                    />
                    <SliderField
                      label={t('themeManager.editor.surface.opacity')}
                      value={draftTheme.theme.surface.opacity}
                      min={0.15}
                      max={1}
                      step={0.01}
                      onChange={(value) => updateSurfaceValue('opacity', value, updateDraftTheme)}
                    />
                    <SliderField
                      label={t('themeManager.editor.surface.borderOpacity')}
                      value={draftTheme.theme.surface.border_opacity}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={(value) => updateSurfaceValue('border_opacity', value, updateDraftTheme)}
                    />
                    <SliderField
                      label={t('themeManager.editor.surface.shadowOpacity')}
                      value={draftTheme.theme.surface.shadow_opacity}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={(value) => updateSurfaceValue('shadow_opacity', value, updateDraftTheme)}
                    />
                  </Grid>
                </Stack>
              )}

              {editorTab === 'background' && (
                <Stack spacing={2.5}>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, md: 4 }}>
                      <TextField
                        select
                        label={t('themeManager.editor.background.kind')}
                        value={draftTheme.theme.background.kind}
                        onChange={(event) => updateDraftTheme((current) => ({
                          ...current,
                          theme: {
                            ...current.theme,
                            background: {
                              ...current.theme.background,
                              kind: event.target.value as ThemeDocument['theme']['background']['kind'],
                            },
                          },
                        }))}
                        fullWidth
                      >
                        <MenuItem value="none">{t('themeManager.editor.background.none')}</MenuItem>
                        <MenuItem value="image">{t('themeManager.editor.background.image')}</MenuItem>
                        <MenuItem value="video">{t('themeManager.editor.background.video')}</MenuItem>
                      </TextField>
                    </Grid>
                    <Grid size={{ xs: 12, md: 4 }}>
                      <TextField
                        select
                        label={t('themeManager.editor.background.fit')}
                        value={draftTheme.theme.background.fit}
                        onChange={(event) => updateDraftTheme((current) => ({
                          ...current,
                          theme: {
                            ...current.theme,
                            background: {
                              ...current.theme.background,
                              fit: event.target.value as ThemeDocument['theme']['background']['fit'],
                            },
                          },
                        }))}
                        fullWidth
                      >
                        <MenuItem value="cover">{t('themeManager.editor.background.fitCover')}</MenuItem>
                        <MenuItem value="contain">{t('themeManager.editor.background.fitContain')}</MenuItem>
                      </TextField>
                    </Grid>
                    <Grid size={{ xs: 12, md: 4 }}>
                      <TextField
                        label={t('themeManager.editor.background.position')}
                        value={draftTheme.theme.background.position}
                        onChange={(event) => updateDraftTheme((current) => ({
                          ...current,
                          theme: {
                            ...current.theme,
                            background: {
                              ...current.theme.background,
                              position: event.target.value,
                            },
                          },
                        }))}
                        fullWidth
                      />
                    </Grid>
                  </Grid>

                  <Stack spacing={1.25}>
                    <TextField
                      label={t('themeManager.editor.background.source')}
                      value={draftTheme.theme.background.source ?? ''}
                      onChange={(event) => updateDraftTheme((current) => ({
                        ...current,
                        theme: {
                          ...current.theme,
                          background: {
                            ...current.theme.background,
                            source: event.target.value,
                          },
                        },
                      }))}
                      fullWidth
                      helperText={t('themeManager.editor.background.sourceHint')}
                    />
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                      <Button variant="outlined" onClick={() => void pickBackgroundAsset('source')} disabled={draftTheme.theme.background.kind === 'none'}>
                        {t('themeManager.editor.background.pickFile')}
                      </Button>
                      <Button variant="text" color="inherit" onClick={() => updateBackgroundValue('source', '', updateDraftTheme)} disabled={!draftTheme.theme.background.source}>
                        {t('themeManager.editor.background.clearFile')}
                      </Button>
                    </Stack>
                  </Stack>

                  <Stack spacing={1.25}>
                    <TextField
                      label={t('themeManager.editor.background.poster')}
                      value={draftTheme.theme.background.poster ?? ''}
                      onChange={(event) => updateDraftTheme((current) => ({
                        ...current,
                        theme: {
                          ...current.theme,
                          background: {
                            ...current.theme.background,
                            poster: event.target.value,
                          },
                        },
                      }))}
                      fullWidth
                      disabled={draftTheme.theme.background.kind !== 'video'}
                      helperText={t('themeManager.editor.background.posterHint')}
                    />
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                      <Button variant="outlined" onClick={() => void pickBackgroundAsset('poster')} disabled={draftTheme.theme.background.kind !== 'video'}>
                        {t('themeManager.editor.background.pickPosterFile')}
                      </Button>
                      <Button variant="text" color="inherit" onClick={() => updateBackgroundValue('poster', '', updateDraftTheme)} disabled={!draftTheme.theme.background.poster}>
                        {t('themeManager.editor.background.clearFile')}
                      </Button>
                    </Stack>
                  </Stack>

                  <Grid container spacing={2}>
                    <SliderField
                      label={t('themeManager.editor.background.opacity')}
                      value={draftTheme.theme.background.opacity}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={(value) => updateBackgroundValue('opacity', value, updateDraftTheme)}
                    />
                    <SliderField
                      label={t('themeManager.editor.background.blur')}
                      value={draftTheme.theme.background.blur}
                      min={0}
                      max={40}
                      step={1}
                      onChange={(value) => updateBackgroundValue('blur', value, updateDraftTheme)}
                    />
                    <SliderField
                      label={t('themeManager.editor.background.brightness')}
                      value={draftTheme.theme.background.brightness}
                      min={0.2}
                      max={1.4}
                      step={0.01}
                      onChange={(value) => updateBackgroundValue('brightness', value, updateDraftTheme)}
                    />
                    <SliderField
                      label={t('themeManager.editor.background.overlayStrength')}
                      value={draftTheme.theme.background.overlay_strength}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={(value) => updateBackgroundValue('overlay_strength', value, updateDraftTheme)}
                    />
                  </Grid>

                  <Grid container spacing={2}>
                    <ColorField
                      label={t('themeManager.editor.background.overlayTint')}
                      value={draftTheme.theme.background.overlay_tint}
                      onChange={(value) => updateBackgroundValue('overlay_tint', value, updateDraftTheme)}
                    />
                  </Grid>
                </Stack>
              )}

              {editorTab === 'css' && (
                <Stack spacing={2.5}>
                  <Alert severity="warning">{t('themeManager.editor.cssHint')}</Alert>
                  <TextField
                    label={t('themeManager.editor.cssGlobal')}
                    value={draftTheme.theme.css.global ?? ''}
                    onChange={(event) => updateDraftTheme((current) => ({
                      ...current,
                      theme: {
                        ...current.theme,
                        css: {
                          ...current.theme.css,
                          global: event.target.value,
                        },
                      },
                    }))}
                    multiline
                    minRows={8}
                    fullWidth
                    helperText={t('themeManager.editor.cssGlobalHint')}
                  />
                  <Divider />
                  <Stack spacing={2}>
                    {supportedTargets.map((target) => (
                      <TextField
                        key={target}
                        label={t(`themeManager.editor.cssTarget.${target}` as never)}
                        value={draftTheme.theme.css.components?.[target] ?? ''}
                        onChange={(event) => updateDraftTheme((current) => ({
                          ...current,
                          theme: {
                            ...current.theme,
                            css: {
                              ...current.theme.css,
                              components: {
                                ...current.theme.css.components,
                                [target]: event.target.value,
                              },
                            },
                          },
                        }))}
                        multiline
                        minRows={4}
                        fullWidth
                        helperText={t('themeManager.editor.cssTargetHint', { target })}
                      />
                    ))}
                  </Stack>
                </Stack>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEditor}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={() => void handleSaveTheme()} disabled={!draftTheme?.metadata.name.trim()}>
            {editorMode === 'create' ? t('themeManager.editor.saveNew') : t('themeManager.editor.saveChanges')}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

function ThemeCard({
  t,
  document,
  source,
  active,
  riskFlags,
  onApply,
  onEdit,
  onDuplicate,
  onExport,
  onDelete,
}: {
  t: TranslateFn;
  document: ThemeDocument;
  source: 'builtin' | 'custom';
  active: boolean;
  riskFlags: ReturnType<typeof getThemeRiskFlags>;
  onApply: () => void;
  onEdit?: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete?: () => void;
}) {
  const theme = useTheme();
  const backgroundSource = useResolvedThemeAssetSource(document.theme.background.source);
  const iconSource = useResolvedThemeAssetSource(document.metadata.icon);
  const mediaOverlay = document.theme.background.kind === 'none'
    ? `linear-gradient(140deg, ${alpha(document.theme.palette.primary, 0.28)}, ${alpha(document.theme.palette.secondary, 0.2)} 55%, ${document.theme.palette.background_default})`
    : document.theme.palette.background_default;

  return (
    <Card
      sx={{
        height: '100%',
        borderColor: active ? alpha(theme.palette.primary.main, 0.4) : undefined,
        boxShadow: active ? `0 18px 40px ${alpha(theme.palette.primary.main, 0.14)}` : undefined,
      }}
    >
      <Box
        sx={{
          position: 'relative',
          minHeight: 156,
          overflow: 'hidden',
          background: mediaOverlay,
        }}
      >
        {document.theme.background.kind !== 'none' && backgroundSource && (
          <Box
            component={document.theme.background.kind === 'video' ? 'video' : 'img'}
            src={backgroundSource}
            autoPlay={document.theme.background.kind === 'video' ? true : undefined}
            muted={document.theme.background.kind === 'video' ? true : undefined}
            loop={document.theme.background.kind === 'video' ? true : undefined}
            playsInline={document.theme.background.kind === 'video' ? true : undefined}
            sx={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: document.theme.background.position,
              opacity: document.theme.background.opacity,
              filter: `blur(${Math.min(document.theme.background.blur, 12)}px) brightness(${document.theme.background.brightness})`,
              transform: 'scale(1.04)',
            }}
          />
        )}
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            background: `linear-gradient(180deg, ${alpha(document.theme.background.overlay_tint, 0.08)} 0%, ${alpha(document.theme.background.overlay_tint, Math.max(0.2, document.theme.background.overlay_strength))} 100%)`,
          }}
        />
        <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ position: 'relative', p: 2 }}>
          <Avatar src={iconSource} sx={{ width: 52, height: 52, bgcolor: alpha(document.theme.palette.background_paper, 0.78), color: document.theme.palette.primary }}>
            <PaletteRoundedIcon />
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip size="small" label={source === 'builtin' ? t('themeManager.builtinTag') : t('themeManager.customTag')} />
              {active && <Chip size="small" color="primary" label={t('themeManager.activeTag')} />}
              {riskFlags.hasCustomCss && <Chip size="small" color="warning" label={t('themeManager.cssTag')} />}
              {riskFlags.hasRemoteAsset && <Chip size="small" color="warning" label={t('themeManager.remoteAssetTag')} />}
            </Stack>
            <Typography variant="h6" sx={{ mt: 1, color: document.theme.palette.text_primary }}>
              {document.metadata.name}
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5, color: alpha(document.theme.palette.text_primary, 0.86) }}>
              {document.metadata.summary || t('themeManager.noSummary')}
            </Typography>
          </Box>
        </Stack>
      </Box>
      <CardContent>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {document.metadata.version ? <Chip size="small" label={`v${document.metadata.version}`} /> : null}
            {document.metadata.author ? <Chip size="small" label={t('themeManager.authorValue', { value: document.metadata.author })} /> : null}
            {document.metadata.supported_app_version ? <Chip size="small" label={t('themeManager.supportedAppValue', { value: document.metadata.supported_app_version })} /> : null}
            <Chip size="small" label={document.theme.background.kind === 'none' ? t('themeManager.backgroundKind.none') : document.theme.background.kind === 'image' ? t('themeManager.backgroundKind.image') : t('themeManager.backgroundKind.video')} />
          </Stack>
          <Stack direction="row" spacing={1}>
            {[
              document.theme.palette.primary,
              document.theme.palette.secondary,
              document.theme.palette.background_paper,
              document.theme.palette.text_primary,
            ].map((color) => (
              <Box key={color} sx={{ width: 18, height: 18, borderRadius: 999, bgcolor: color, border: `1px solid ${alpha('#000000', 0.08)}` }} />
            ))}
          </Stack>
        </Stack>
      </CardContent>
      <CardActions sx={{ px: 2, pb: 2, pt: 0, flexWrap: 'wrap', gap: 1 }}>
        {!active && <Button size="small" variant="contained" onClick={onApply}>{t('themeManager.applyAction')}</Button>}
        <Button size="small" variant="outlined" startIcon={<ContentCopyRoundedIcon />} onClick={onDuplicate}>{t('themeManager.duplicateAction')}</Button>
        {onEdit ? <Button size="small" variant="outlined" startIcon={<EditRoundedIcon />} onClick={onEdit}>{t('themeManager.editAction')}</Button> : null}
        <Button size="small" variant="outlined" startIcon={<DownloadRoundedIcon />} onClick={onExport}>{t('themeManager.exportAction')}</Button>
        {onDelete ? <Button size="small" color="error" variant="outlined" startIcon={<DeleteOutlineRoundedIcon />} onClick={onDelete}>{t('themeManager.deleteAction')}</Button> : null}
      </CardActions>
    </Card>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Grid size={{ xs: 12, md: 4 }}>
      <TextField
        label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        fullWidth
        InputProps={{
          startAdornment: (
            <Box
              component="span"
              sx={{
                width: 18,
                height: 18,
                borderRadius: 999,
                bgcolor: value,
                border: '1px solid rgba(0, 0, 0, 0.14)',
                mr: 1.25,
                flexShrink: 0,
              }}
            />
          ),
        }}
      />
    </Grid>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <Grid size={{ xs: 12, md: 6 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {label}
      </Typography>
      <Slider value={value} min={min} max={max} step={step} valueLabelDisplay="auto" onChange={(_, next) => onChange(Number(next))} />
    </Grid>
  );
}

function updatePaletteValue(
  key: keyof ThemeDocument['theme']['palette'],
  value: string,
  updateDraftTheme: (updater: (current: ThemeDocument) => ThemeDocument) => void,
) {
  updateDraftTheme((current) => ({
    ...current,
    theme: {
      ...current.theme,
      palette: {
        ...current.theme.palette,
        [key]: value,
      },
    },
  }));
}

function updateSurfaceValue(
  key: keyof ThemeDocument['theme']['surface'],
  value: number,
  updateDraftTheme: (updater: (current: ThemeDocument) => ThemeDocument) => void,
) {
  updateDraftTheme((current) => ({
    ...current,
    theme: {
      ...current.theme,
      surface: {
        ...current.theme.surface,
        [key]: value,
      },
    },
  }));
}

function updateBackgroundValue(
  key: keyof ThemeDocument['theme']['background'],
  value: string | number,
  updateDraftTheme: (updater: (current: ThemeDocument) => ThemeDocument) => void,
) {
  updateDraftTheme((current) => ({
    ...current,
    theme: {
      ...current.theme,
      background: {
        ...current.theme.background,
        [key]: value,
      },
    },
  }));
}