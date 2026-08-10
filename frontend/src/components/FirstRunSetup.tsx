import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Card,
  Checkbox,
  Chip,
  Modal,
  ProgressBar,
  Radio,
  RadioGroup,
  ScrollShadow,
  Spinner,
  Switch,
} from '@heroui/react';
import {
  ArrowLeft,
  ArrowRight,
  BatteryCharging,
  Check,
  CheckCircle2,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Laptop,
  MonitorCog,
  Moon,
  Palette,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Sun,
} from 'lucide-react';
import WindowTitleBar from '@/components/WindowTitleBar';
import { getAutostartStatus, getSettings, openUrl, setAutostartEnabled, setSettings } from '@/api/backend';
import { useThemeContext } from '@/components/ThemeProvider';
import type { AppSettings, DynamicWallpaperPerformanceAction } from '@/types';
import type { ThemeMode } from '@/theme/types';

const AGREEMENT_URL = 'https://docs.zsxiaoshu.cn/terms/wallpaper/user_agreement/';
const AGREEMENT_VERSION = '2026-08-10';

const STEPS = [
  { label: '欢迎', icon: Sparkles },
  { label: '用户协议', icon: ShieldCheck },
  { label: '外观', icon: Palette },
  { label: '系统行为', icon: MonitorCog },
  { label: '性能与隐私', icon: BatteryCharging },
  { label: '准备完成', icon: CheckCircle2 },
] as const;

type SetupDraft = {
  theme: ThemeMode;
  autoStart: boolean;
  hideOnLaunch: boolean;
  hideOnClose: boolean;
  minimizeToTray: boolean;
  autoCheckUpdates: boolean;
  autoChangeWallpaper: boolean;
  rememberPrompts: boolean;
  fullScreenAction: DynamicWallpaperPerformanceAction;
  batteryAction: DynamicWallpaperPerformanceAction;
};

const DEFAULT_DRAFT: SetupDraft = {
  theme: 'system',
  autoStart: false,
  hideOnLaunch: true,
  hideOnClose: true,
  minimizeToTray: true,
  autoCheckUpdates: true,
  autoChangeWallpaper: false,
  rememberPrompts: true,
  fullScreenAction: 'pause',
  batteryAction: 'pause',
};

function consumeForceOnboardingFlag(): boolean {
  const url = new URL(window.location.href);
  const forced = url.searchParams.get('force_onboarding') === '1';
  if (forced) {
    url.searchParams.delete('force_onboarding');
    window.history.replaceState({}, '', url.toString());
  }
  return forced;
}

function createDraft(settings: AppSettings): SetupDraft {
  return {
    theme: settings.ui.theme,
    autoStart: settings.startup.auto_start,
    hideOnLaunch: settings.startup.hide_on_launch,
    hideOnClose: settings.ui.hide_on_close,
    minimizeToTray: settings.ui.minimize_to_tray,
    autoCheckUpdates: settings.updates.auto_check,
    autoChangeWallpaper: settings.wallpaper.auto_change.enabled,
    rememberPrompts: settings.generate.remember_prompts,
    fullScreenAction: settings.wallpaper.dynamic.performance.other_application_fullscreen,
    batteryAction: settings.wallpaper.dynamic.performance.on_battery,
  };
}

function withDraft(settings: AppSettings, draft: SetupDraft): AppSettings {
  return {
    ...settings,
    onboarding: {
      completed: true,
      agreement_version: AGREEMENT_VERSION,
    },
    ui: {
      ...settings.ui,
      theme: draft.theme,
      hide_on_close: draft.hideOnClose,
      minimize_to_tray: draft.minimizeToTray,
    },
    updates: { ...settings.updates, auto_check: draft.autoCheckUpdates },
    startup: {
      ...settings.startup,
      auto_start: draft.autoStart,
      hide_on_launch: draft.hideOnLaunch,
    },
    generate: { ...settings.generate, remember_prompts: draft.rememberPrompts },
    wallpaper: {
      ...settings.wallpaper,
      auto_change: {
        ...settings.wallpaper.auto_change,
        enabled: draft.autoChangeWallpaper,
        mode: draft.autoChangeWallpaper ? 'interval' : 'off',
        interval: draft.autoChangeWallpaper
          ? { ...settings.wallpaper.auto_change.interval, value: 30, unit: 'minutes' }
          : settings.wallpaper.auto_change.interval,
      },
      dynamic: {
        ...settings.wallpaper.dynamic,
        performance: {
          ...settings.wallpaper.dynamic.performance,
          other_application_fullscreen: draft.fullScreenAction,
          on_battery: draft.batteryAction,
        },
      },
    },
  };
}

export default function FirstRunSetup({ children }: { children: React.ReactNode }) {
  const { setTheme } = useThemeContext();
  const [forceOnboarding] = useState(consumeForceOnboardingFlag);
  const [forcedSetupCompleted, setForcedSetupCompleted] = useState(false);
  const [settings, setSettingsState] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [draft, setDraft] = useState<SetupDraft>(DEFAULT_DRAFT);
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [agreementOpen, setAgreementOpen] = useState(false);
  const [autostartSupported, setAutostartSupported] = useState(true);
  const [autostartReason, setAutostartReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const themeRequestId = useRef(0);

  const load = () => {
    setLoading(true);
    setLoadError('');
    Promise.all([getSettings(), getAutostartStatus()])
      .then(([nextSettings, autostart]) => {
        setSettingsState(nextSettings);
        setDraft(createDraft(nextSettings));
        setAutostartSupported(autostart.supported);
        setAutostartReason(autostart.reason);
      })
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : '无法读取应用设置');
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (loading) {
    return <SetupShell><SetupStatus title="正在准备首次设置" description="读取设备与应用偏好..." /></SetupShell>;
  }

  if (!settings) {
    return (
      <SetupShell>
        <SetupStatus
          title="暂时无法开始设置"
          description={loadError || '后端服务未返回设置，请稍后重试。'}
          action={<Button onPress={load}>重试</Button>}
        />
      </SetupShell>
    );
  }

  if (settings.onboarding.completed && (!forceOnboarding || forcedSetupCompleted)) return children;

  const canContinue = step !== 1 || agreementAccepted;
  const setDraftValue = <K extends keyof SetupDraft>(key: K, value: SetupDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const changeStep = (next: number) => {
    setDirection(next > step ? 'forward' : 'back');
    setStep(next);
    setSaveError('');
  };

  const changeTheme = async (nextTheme: ThemeMode) => {
    if (nextTheme === draft.theme) return;
    const requestId = ++themeRequestId.current;
    const previousTheme = draft.theme;
    setDraftValue('theme', nextTheme);
    setSaveError('');
    try {
      await setTheme(nextTheme);
    } catch (error: unknown) {
      if (requestId !== themeRequestId.current) return;
      setDraftValue('theme', previousTheme);
      setSaveError(error instanceof Error ? error.message : '无法应用外观设置');
    }
  };

  const finish = async () => {
    if (!agreementAccepted || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      const nextSettings = withDraft(settings, draft);
      if (draft.autoStart !== settings.startup.auto_start) {
        await setAutostartEnabled(draft.autoStart);
      }
      await setTheme(draft.theme);
      await setSettings(nextSettings);
      setForcedSetupCompleted(true);
      setSettingsState(nextSettings);
    } catch (error: unknown) {
      setSaveError(error instanceof Error ? error.message : '保存设置时发生未知错误');
    } finally {
      setSaving(false);
    }
  };

  const CurrentStepIcon = STEPS[step].icon;

  return (
    <SetupShell>
      <div className="first-run-frame mx-auto flex w-full max-w-[1120px] flex-1 p-4 sm:p-6 lg:max-w-[1240px] lg:p-8 2xl:max-w-[1380px]">
        <main className="first-run-surface flex min-h-0 flex-1 flex-col overflow-hidden">
          <header className="flex shrink-0 items-center justify-between gap-4 px-6 py-5 sm:px-9">
            <div className="flex items-center gap-3">
              <img src="./logo.png" alt="小树壁纸" className="size-11 rounded-2xl object-cover" draggable={false} />
              <div>
                <p className="text-[15px] font-semibold leading-5">小树壁纸 Next</p>
                <p className="text-xs text-muted">初次使用设置</p>
              </div>
            </div>
            <Chip size="sm" variant="soft" className="shrink-0">
              <CurrentStepIcon size={13} /> {STEPS[step].label}
            </Chip>
          </header>

          <ScrollShadow hideScrollBar orientation="vertical" size={56} className="min-h-0 flex-1 px-6 py-8 sm:px-10 sm:py-10">
            <div key={step} className={`first-run-panel first-run-panel--${direction}`}>
              <SetupStep
                step={step}
                draft={draft}
                setDraftValue={setDraftValue}
                onThemeChange={changeTheme}
                agreementAccepted={agreementAccepted}
                setAgreementAccepted={setAgreementAccepted}
                setAgreementOpen={setAgreementOpen}
                autostartSupported={autostartSupported}
                autostartReason={autostartReason}
              />
            </div>
          </ScrollShadow>

          <footer className="first-run-footer shrink-0 px-6 py-5 sm:px-9">
            <div className="flex items-center gap-4">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <CurrentStepIcon size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium text-foreground">{STEPS[step].label}</span>
                  <span className="shrink-0 text-muted">{step + 1} / {STEPS.length}</span>
                </div>
                <ProgressBar aria-label="设置进度" value={((step + 1) / STEPS.length) * 100}>
                  <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
                </ProgressBar>
              </div>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <Button variant="ghost" onPress={() => changeStep(step - 1)} isDisabled={step === 0 || saving}>
                <ArrowLeft size={16} /> 返回
              </Button>
              <div className="min-w-0 flex-1 truncate text-center text-xs text-danger">{saveError}</div>
              {step < STEPS.length - 1 ? (
                <Button onPress={() => changeStep(step + 1)} isDisabled={!canContinue}>
                  继续 <ArrowRight size={16} />
                </Button>
              ) : (
                <Button onPress={finish} isPending={saving} isDisabled={!agreementAccepted}>
                  {saving ? <Spinner size="sm" color="current" /> : <Sparkles size={16} />}
                  {saving ? '正在保存' : '开始探索'}
                </Button>
              )}
            </div>
          </footer>
        </main>
      </div>

      <Modal.Backdrop isOpen={agreementOpen} onOpenChange={setAgreementOpen}>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>用户协议摘要</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="space-y-4 text-sm leading-7 text-muted">
                <p>在使用小树壁纸前，请了解以下重要事项。完整条款以官方用户协议页面为准。</p>
                <AgreementPoint title="第三方内容">壁纸、搜索结果和市场资源可能由第三方提供，其版权与可用性由对应提供方负责。</AgreementPoint>
                <AgreementPoint title="本地数据">收藏、下载记录、设置和生成历史默认保存在您的设备上，部分在线功能会向对应服务发送必要请求。</AgreementPoint>
                <AgreementPoint title="使用责任">您需要遵守所在地法律法规、内容提供方条款，并合理使用下载、生成和动态壁纸功能。</AgreementPoint>
                <Card variant="secondary" className="gap-2 p-4">
                  <p className="font-medium text-foreground">协议版本</p>
                  <p className="text-xs">当前确认版本：{AGREEMENT_VERSION}</p>
                </Card>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onPress={() => void openUrl(AGREEMENT_URL)}>
                查看完整协议 <ExternalLink size={15} />
              </Button>
              <Button onPress={() => setAgreementOpen(false)}>我已了解</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </SetupShell>
  );
}

function SetupShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="first-run-root relative z-50 flex h-screen w-screen min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <WindowTitleBar title="小树壁纸 Next · 初次使用设置" />
      <div className="first-run-ambient" aria-hidden="true">
        <span className="first-run-orb first-run-orb--one" />
        <span className="first-run-orb first-run-orb--two" />
        <span className="first-run-sheen" />
      </div>
      <div className="relative flex min-h-0 flex-1">{children}</div>
    </div>
  );
}

function SetupStatus({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="m-auto flex max-w-md flex-col items-center gap-4 p-8 text-center">
      <img src="./logo.png" alt="小树壁纸" className="size-14 rounded-3xl object-cover" draggable={false} />
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}

function SetupStep({
  step,
  draft,
  setDraftValue,
  onThemeChange,
  agreementAccepted,
  setAgreementAccepted,
  setAgreementOpen,
  autostartSupported,
  autostartReason,
}: {
  step: number;
  draft: SetupDraft;
  setDraftValue: <K extends keyof SetupDraft>(key: K, value: SetupDraft[K]) => void;
  onThemeChange: (value: ThemeMode) => void;
  agreementAccepted: boolean;
  setAgreementAccepted: (value: boolean) => void;
  setAgreementOpen: (value: boolean) => void;
  autostartSupported: boolean;
  autostartReason: string;
}) {
  if (step === 0) return (
    <div className="mx-auto flex min-h-full max-w-[760px] flex-col justify-center lg:max-w-[900px] xl:max-w-[980px]">
      <Chip size="sm" variant="soft" className="w-fit"><Sparkles size={13} /> 2 分钟完成常用设置</Chip>
      <h1 className="mt-7 max-w-2xl text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">欢迎使用小树壁纸</h1>
      <p className="mt-5 max-w-2xl text-[15px] leading-8 text-muted">配置协议、外观、启动行为、性能与隐私。高级配置稍后仍然可以在设置中调整。</p>
      <div className="mt-10 grid gap-3 sm:grid-cols-3">
        <Card variant="secondary" className="gap-3 p-4">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Palette size={18} /></span>
          <div><p className="text-sm font-medium">界面风格</p><p className="mt-1 text-xs leading-5 text-muted">浅色、深色或跟随系统</p></div>
        </Card>
        <Card variant="secondary" className="gap-3 p-4">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Laptop size={18} /></span>
          <div><p className="text-sm font-medium">系统行为</p><p className="mt-1 text-xs leading-5 text-muted">托盘、开机与静默启动</p></div>
        </Card>
        <Card variant="secondary" className="gap-3 p-4">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><ShieldCheck size={18} /></span>
          <div><p className="text-sm font-medium">隐私选择</p><p className="mt-1 text-xs leading-5 text-muted">更新与本地记录偏好</p></div>
        </Card>
      </div>
    </div>
  );

  if (step === 1) return (
    <StepLayout eyebrow="使用前须知" title="清楚了解，再安心开始" description="继续使用前，需要阅读并同意小树壁纸用户协议。可以随时打开完整协议查看。">
      <Card variant="secondary" className="gap-5 p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <FileText size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium">小树壁纸用户协议</p>
            <p className="mt-1 text-sm leading-6 text-muted">包括第三方内容、本地数据、知识产权、免责声明与服务变更等条款。</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="secondary" onPress={() => setAgreementOpen(true)}>摘要</Button>
            <Button variant="ghost" onPress={() => void openUrl(AGREEMENT_URL)}>
              完整协议 <ExternalLink size={14} />
            </Button>
          </div>
        </div>
        <div className="mt-5 border-t border-separator pt-5">
          <Checkbox isSelected={agreementAccepted} onChange={setAgreementAccepted}>
            <Checkbox.Content className="flex-row items-center">
              <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
              <span className="text-sm leading-6">我已阅读并同意《小树壁纸用户协议》，并了解部分功能由第三方服务提供。</span>
            </Checkbox.Content>
          </Checkbox>
          <p className={`mt-2 text-xs ${agreementAccepted ? 'text-muted' : 'text-warning'}`}>
            {agreementAccepted ? '协议已确认，可以继续设置。' : '勾选同意后才能继续。'}
          </p>
        </div>
      </Card>
    </StepLayout>
  );

  if (step === 2) return (
    <StepLayout eyebrow="外观" title="选择舒适的界面明暗" description="选择后会立即预览，并保存为主题偏好。">
      <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="界面外观">
        <ThemeChoice title="跟随系统" description="自动适应明暗" icon={<RotateCcw size={18} />} selected={draft.theme === 'system'} onSelect={() => void onThemeChange('system')} preview={<SystemPreview />} />
        <ThemeChoice title="浅色" description="清透明亮" icon={<Sun size={18} />} selected={draft.theme === 'light'} onSelect={() => void onThemeChange('light')} preview={<ThemePreviewSwatch mode="light" />} />
        <ThemeChoice title="深色" description="柔和低亮" icon={<Moon size={18} />} selected={draft.theme === 'dark'} onSelect={() => void onThemeChange('dark')} preview={<ThemePreviewSwatch mode="dark" />} />
      </div>
    </StepLayout>
  );

  if (step === 3) return (
    <StepLayout eyebrow="系统行为" title="决定应用如何陪伴您" description="推荐保留托盘功能，避免关闭窗口时中断自动化或动态壁纸。">
      <div className="grid gap-3">
        <SettingSwitch title="启用系统托盘" description="在通知区域保留快捷入口和后台能力" value={draft.minimizeToTray} onChange={(value) => setDraftValue('minimizeToTray', value)} />
        <SettingSwitch title="关闭窗口时隐藏到托盘" description="关闭主窗口不退出后台服务" value={draft.hideOnClose} onChange={(value) => setDraftValue('hideOnClose', value)} isDisabled={!draft.minimizeToTray} />
        <SettingSwitch title="开机时自动启动" description={autostartSupported ? '登录系统后自动运行小树壁纸' : autostartReason || '当前系统不支持开机启动'} value={draft.autoStart} onChange={(value) => setDraftValue('autoStart', value)} isDisabled={!autostartSupported} />
        <SettingSwitch title="自启动时隐藏主界面" description="安静地在后台启动，不打断当前操作" value={draft.hideOnLaunch} onChange={(value) => setDraftValue('hideOnLaunch', value)} isDisabled={!draft.autoStart || !draft.minimizeToTray} />
      </div>
    </StepLayout>
  );

  if (step === 4) return (
    <StepLayout eyebrow="性能与隐私" title="平衡体验、续航与记录" description="以下是适合多数设备的推荐值，未列出的高级设置会保留默认值。">
      <SettingSwitch title="每 30 分钟自动更换壁纸" description="开启后使用已配置的壁纸源轮换桌面画面" value={draft.autoChangeWallpaper} onChange={(value) => setDraftValue('autoChangeWallpaper', value)} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card variant="secondary" className="gap-4 p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><BatteryCharging size={17} /></span>
            <div>
              <p className="font-medium">动态壁纸节能</p>
              <p className="text-xs text-muted">满足条件时自动降低资源占用</p>
            </div>
          </div>
          <PerformanceChoices label="其他应用全屏时" value={draft.fullScreenAction} onChange={(value) => setDraftValue('fullScreenAction', value)} />
          <div className="my-4 border-t border-separator" />
          <PerformanceChoices label="使用电池供电时" value={draft.batteryAction} onChange={(value) => setDraftValue('batteryAction', value)} />
        </Card>
        <Card variant="secondary" className="gap-4 p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><ShieldCheck size={17} /></span>
            <div>
              <p className="font-medium">更新与本地记录</p>
              <p className="text-xs text-muted">控制在线检查和本机历史</p>
            </div>
          </div>
          <div className="space-y-3">
            <SettingSwitch title="自动检查更新" description="仅检查版本信息，不会静默安装" value={draft.autoCheckUpdates} onChange={(value) => setDraftValue('autoCheckUpdates', value)} compact />
            <SettingSwitch title="记住最近的生成提示词" description="历史记录保存在本机，可随时清除" value={draft.rememberPrompts} onChange={(value) => setDraftValue('rememberPrompts', value)} compact />
          </div>
          <div className="mt-4 rounded-xl bg-surface p-3 text-xs leading-5 text-muted">
            NSFW 内容保持关闭，应用不会在首次设置中启用此类内容。
          </div>
        </Card>
      </div>
    </StepLayout>
  );

  return (
    <div className="mx-auto flex min-h-full max-w-[720px] flex-col items-center justify-center text-center lg:max-w-[820px]">
      <CheckCircle2 className="first-run-success text-success" size={56} strokeWidth={2.1} aria-hidden="true" />
      <h1 className="mt-6 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">已经准备好了</h1>
      <p className="mt-4 max-w-xl text-sm leading-7 text-muted">点击“开始探索”保存所有选择。之后可在设置中更改任何选项，并在帮助页面重新查看用户协议。</p>
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <Chip size="sm" variant="soft">{draft.theme === 'system' ? '跟随系统外观' : draft.theme === 'light' ? '浅色外观' : '深色外观'}</Chip>
        <Chip size="sm" variant="soft">{draft.autoStart ? '开机自启动' : '手动启动'}</Chip>
        <Chip size="sm" variant="soft">{draft.autoChangeWallpaper ? '自动更换壁纸' : '保留当前壁纸'}</Chip>
        <Chip size="sm" variant="soft">协议已确认</Chip>
      </div>
    </div>
  );
}

function StepLayout({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-full max-w-[760px] flex-col justify-center lg:max-w-[900px] xl:max-w-[980px]">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">{eyebrow}</p>
      <h1 className="mt-4 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">{title}</h1>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-muted">{description}</p>
      <div className="mt-9 space-y-4">{children}</div>
    </div>
  );
}

function ThemeChoice({ title, description, icon, selected, onSelect, preview }: { title: string; description: string; icon: React.ReactNode; selected: boolean; onSelect: () => void; preview: React.ReactNode }) {
  return (
    <button type="button" className="first-run-theme-choice" data-selected={selected} onClick={onSelect} aria-pressed={selected}>
      <span className="first-run-theme-preview">{preview}</span>
      <span className="mt-4 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-medium">{icon}{title}</span>
        <span className="first-run-theme-check">{selected ? <Check size={15} /> : null}</span>
      </span>
      <span className="mt-1 block text-left text-xs leading-5 text-muted">{description}</span>
    </button>
  );
}

function ThemePreviewSwatch({ mode }: { mode: 'light' | 'dark' }) {
  return (
    <span className={`first-run-mini-window first-run-mini-window--${mode}`}>
      <span className="first-run-mini-window__bar"><i /><i /><i /></span>
      <span className="first-run-mini-window__body"><ImageIcon size={15} /><b /><em /></span>
    </span>
  );
}

function SystemPreview() {
  return (
    <span className="first-run-system-preview">
      <ThemePreviewSwatch mode="light" />
      <ThemePreviewSwatch mode="dark" />
    </span>
  );
}

function SettingSwitch({ title, description, value, onChange, isDisabled = false, compact = false }: { title: string; description: string; value: boolean; onChange: (value: boolean) => void; isDisabled?: boolean; compact?: boolean }) {
  return (
    <Card variant="secondary" className={`flex flex-row items-center justify-between gap-5 ${compact ? 'p-3' : 'p-4'}`}>
      <div className="min-w-0"><p className="text-sm font-medium">{title}</p><p className="mt-1 text-xs leading-5 text-muted">{description}</p></div>
      <Switch aria-label={title} isSelected={value} onChange={onChange} isDisabled={isDisabled}><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
    </Card>
  );
}

function PerformanceChoices({ label, value, onChange }: { label: string; value: DynamicWallpaperPerformanceAction; onChange: (value: DynamicWallpaperPerformanceAction) => void }) {
  const options: { id: DynamicWallpaperPerformanceAction; label: string }[] = [
    { id: 'keep_running', label: '保持运行' },
    { id: 'pause', label: '暂停' },
    { id: 'stop', label: '停止' },
  ];
  return (
    <div>
      <p className="mb-2 text-xs text-muted">{label}</p>
      <RadioGroup value={value} onChange={(next) => onChange(next as DynamicWallpaperPerformanceAction)} aria-label={label} orientation="horizontal" className="flex flex-wrap gap-4">
        {options.map((option) => (
          <Radio key={option.id} value={option.id}>
            <Radio.Control><Radio.Indicator /></Radio.Control>
            <Radio.Content>{option.label}</Radio.Content>
          </Radio>
        ))}
      </RadioGroup>
    </div>
  );
}

function AgreementPoint({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><p className="font-medium text-foreground">{title}</p><p>{children}</p></div>;
}
