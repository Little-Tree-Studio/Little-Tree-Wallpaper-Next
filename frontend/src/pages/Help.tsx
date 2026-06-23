import { useState, useEffect, useCallback } from 'react';
import {
  Card, Button, Separator, ComboBox, ListBox, Input, Label, Description,
  Modal, toast,
} from '@heroui/react';
import type { Key } from '@heroui/react';
import {
  Download, FileText, FolderOpen, Trash2, Shield, RefreshCw,
  LifeBuoy, BookOpen, MessageSquareWarning, ChevronDown, ChevronRight,
  ExternalLink, Copy,
} from 'lucide-react';
import {
  getLogStats, setLogFileLevel, clearLogs, getDebugLog, saveDebugLog,
  openDebugLogFile, openDebugLogDirectory, getCrashReports, openCrashReport,
  openUrl, copyToClipboard, type LogStats,
} from '@/api/backend';

interface CrashReport {
  path: string;
  name: string;
  size: number;
  created_at: string;
}

// Friendly labels + ordering hint for the file log level selector.
const LEVEL_LABELS: Record<string, string> = {
  TRACE: '跟踪（最详细）',
  DEBUG: '调试',
  INFO: '信息',
  SUCCESS: '成功',
  WARNING: '警告',
  ERROR: '错误',
  CRITICAL: '严重（最少）',
};

const FEEDBACK_URL = 'https://github.com/Little-Tree-Studio/Little-Tree-Wallpaper-Next/issues';

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-muted">{title}</h3>
      {children}
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex-1 rounded-lg border border-border bg-surface-tertiary p-3">
      <div className="text-xl font-semibold text-foreground">{value}</div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted/70">{hint}</div>}
    </div>
  );
}

export default function Help() {
  const [stats, setStats] = useState<LogStats | null>(null);
  const [crashReports, setCrashReports] = useState<CrashReport[]>([]);
  const [busy, setBusy] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showRecent, setShowRecent] = useState(false);
  const [recentLog, setRecentLog] = useState<{ content: string; path: string; truncated: boolean } | null>(null);
  const [logLoading, setLogLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStats(await getLogStats());
    } catch (e) {
      toast.danger('加载日志信息失败', { timeout: 0 });
    }
  }, []);

  const loadCrashReports = useCallback(async () => {
    try {
      setCrashReports(await getCrashReports());
    } catch {
      setCrashReports([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void loadCrashReports();
  }, [refresh, loadCrashReports]);

  const handleLevelChange = async (key: Key | null) => {
    const level = String(key || '');
    if (!level) return;
    setBusy(true);
    try {
      setStats(await setLogFileLevel(level));
      toast.success(`日志级别已调整为：${LEVEL_LABELS[level] || level}`, { timeout: 3000 });
    } catch {
      toast.danger('调整日志级别失败', { timeout: 0 });
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setShowClearConfirm(false);
    setBusy(true);
    try {
      const result = await clearLogs();
      setStats(result);
      setRecentLog(null);
      setShowRecent(false);
      if (result.failed > 0) {
        toast.warning(`已清理 ${result.removed} 个历史日志文件，但有 ${result.failed} 个文件未能处理（可能正被其他程序占用）`, { timeout: 0 });
      } else {
        toast.success(`已清理 ${result.removed} 个历史日志文件，当前运行日志已清空`, { timeout: 3000 });
      }
    } catch {
      toast.danger('清除日志失败', { timeout: 0 });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveLog = async () => {
    setLogLoading(true);
    try {
      const result = await saveDebugLog();
      if (result?.saved_path) {
        toast.success('日志已保存', { timeout: 3000 });
      } else if (!result?.cancelled) {
        toast.danger(result?.error || '保存日志失败', { timeout: 0 });
      }
    } catch {
      toast.danger('保存日志失败', { timeout: 0 });
    } finally {
      setLogLoading(false);
    }
  };

  const handleViewRecent = async () => {
    const next = !showRecent;
    setShowRecent(next);
    if (next && !recentLog) {
      setLogLoading(true);
      try {
        const data = await getDebugLog(300);
        setRecentLog({
          content: data?.content || '（无内容）',
          path: data?.path || '',
          truncated: !!data?.truncated,
        });
      } catch {
        toast.danger('读取日志失败', { timeout: 0 });
        setShowRecent(false);
      } finally {
        setLogLoading(false);
      }
    }
  };

  const handleOpenCrashReport = async (path: string) => {
    try {
      await openCrashReport(path);
    } catch {
      toast.danger('打开错误报告失败', { timeout: 0 });
    }
  };

  const handleCopyPath = async (text: string) => {
    try {
      await copyToClipboard(text);
      toast.success('已复制路径', { timeout: 2000 });
    } catch {
      toast.danger('复制失败', { timeout: 0 });
    }
  };

  const levels = stats?.levels || [];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">帮助与反馈</h1>

      <Card className="space-y-4 p-4">
        <Section title="帮助">
          <div className="grid gap-2 sm:grid-cols-3">
            <Button
              variant="secondary"
              className="flex h-auto w-full flex-col items-start gap-1 p-3"
              onPress={() => openUrl('https://docs.zsxiaoshu.cn/docs/wallpaper/')}
            >
              <span className="flex items-center gap-1.5 text-sm font-medium"><BookOpen size={16} /> 使用文档</span>
              <span className="text-xs text-muted">查看使用说明与常见问题</span>
            </Button>
            <Button
              variant="secondary"
              className="flex h-auto w-full flex-col items-start gap-1 p-3"
              onPress={() => openUrl(FEEDBACK_URL)}
            >
              <span className="flex items-center gap-1.5 text-sm font-medium"><MessageSquareWarning size={16} /> 问题反馈</span>
              <span className="text-xs text-muted">提交 Bug 或功能建议</span>
            </Button>
            <Button
              variant="secondary"
              className="flex h-auto w-full flex-col items-start gap-1 p-3"
              onPress={() => openUrl('https://docs.zsxiaoshu.cn/terms/wallpaper/user_agreement/')}
            >
              <span className="flex items-center gap-1.5 text-sm font-medium"><Shield size={16} /> 用户协议</span>
              <span className="text-xs text-muted">服务条款与隐私说明</span>
            </Button>
          </div>
        </Section>
      </Card>

      <Card className="space-y-4 p-4">
        <Section title="日志与诊断">
          {/* Stats */}
          <div className="flex flex-wrap gap-2">
            <StatTile label="已记录日志条数" value={stats ? stats.entry_count.toLocaleString() : '—'} hint={`错误 ${stats ? stats.error_count.toLocaleString() : '—'} 条`} />
            <StatTile label="日志文件数" value={stats ? String(stats.file_count) : '—'} />
            <StatTile label="占用空间" value={stats ? formatBytes(stats.size_bytes) : '—'} />
          </div>
          {stats?.directory && (
            <div className="flex items-center justify-between gap-2">
              <span className="shrink-0 text-xs text-muted">日志目录</span>
              <button
                type="button"
                onClick={() => handleCopyPath(stats.directory)}
                className="flex min-w-0 max-w-[65%] items-center gap-1 truncate text-xs text-muted transition-colors hover:text-foreground"
                title="点击复制路径"
              >
                <span className="truncate">{stats.directory}</span>
                <Copy size={11} className="shrink-0" />
              </button>
            </div>
          )}

          <Separator />

          {/* File log level (file-only) */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <Label className="block text-sm">文件日志级别</Label>
              <Description>仅影响写入文件的记录，控制台输出不受影响</Description>
            </div>
            <ComboBox
              className="w-full sm:w-56"
              selectedKey={stats?.level || 'DEBUG'}
              onSelectionChange={handleLevelChange}
              isDisabled={busy || !stats}
            >
              <ComboBox.InputGroup>
                <Input />
                <ComboBox.Trigger />
              </ComboBox.InputGroup>
              <ComboBox.Popover>
                <ListBox>
                  {levels.map((lvl) => (
                    <ListBox.Item key={lvl} id={lvl} textValue={LEVEL_LABELS[lvl] || lvl}>
                      {LEVEL_LABELS[lvl] || lvl}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </ComboBox.Popover>
            </ComboBox>
          </div>

          <Separator />

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onPress={() => refresh()} isDisabled={busy}>
              <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> 刷新
            </Button>
            <Button size="sm" variant="secondary" onPress={handleSaveLog} isDisabled={logLoading}>
              <Download size={14} /> 保存日志
            </Button>
            <Button size="sm" variant="ghost" onPress={() => openDebugLogFile()}>
              <FileText size={14} /> 打开日志
            </Button>
            <Button size="sm" variant="ghost" onPress={() => openDebugLogDirectory()}>
              <FolderOpen size={14} /> 日志目录
            </Button>
            <Button size="sm" variant="ghost" onPress={handleViewRecent} isDisabled={logLoading}>
              {showRecent ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {showRecent ? '收起最近日志' : '查看最近日志'}
            </Button>
            <Button size="sm" variant="ghost" className="text-danger" onPress={() => setShowClearConfirm(true)} isDisabled={busy}>
              <Trash2 size={14} /> 清除日志
            </Button>
          </div>

          {/* Recent log viewer */}
          {showRecent && (
            <div className="space-y-1">
              {recentLog?.path && (
                <div className="flex items-center justify-between text-xs text-muted">
                  <span className="truncate">{recentLog.path}</span>
                  {recentLog.truncated && <span>（已截断，仅显示尾部）</span>}
                </div>
              )}
              <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-surface-tertiary p-3 text-xs leading-relaxed whitespace-pre-wrap break-all">
                {logLoading ? '加载中…' : recentLog?.content || '（无内容）'}
              </pre>
            </div>
          )}

          <Separator />

          {/* Crash reports */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">异常退出报告</span>
              <Button size="sm" variant="ghost" onPress={() => loadCrashReports()}>
                <RefreshCw size={14} /> 刷新
              </Button>
            </div>
            {crashReports.length > 0 ? (
              <div className="space-y-1">
                <div className="text-xs text-muted">发现 {crashReports.length} 份错误报告</div>
                <div className="max-h-40 space-y-1 overflow-auto">
                  {crashReports.map((report) => (
                    <div key={report.path} className="flex items-center justify-between rounded-lg border border-border p-2">
                      <div className="min-w-0 text-xs text-muted">
                        <div className="truncate">{report.name}</div>
                        <div>{new Date(report.created_at).toLocaleString()} · {(report.size / 1024).toFixed(1)} KB</div>
                      </div>
                      <Button size="sm" variant="ghost" onPress={() => handleOpenCrashReport(report.path)}>
                        打开
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted">暂无异常退出错误报告</div>
            )}
          </div>
        </Section>
      </Card>

      <button
        type="button"
        onClick={() => openUrl(FEEDBACK_URL)}
        className="mx-auto flex items-center justify-center gap-1 text-center text-xs text-muted transition-colors hover:text-foreground"
      >
        <LifeBuoy size={12} />
        如遇问题，请通过「问题反馈」提交并附上日志文件，便于我们定位。
        <ExternalLink size={12} />
      </button>

      <Modal.Backdrop isOpen={showClearConfirm} onOpenChange={(open) => !open && setShowClearConfirm(false)}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>清除所有日志</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p className="text-sm text-muted">
                将删除全部日志文件（包括错误日志），此操作不可撤销。清除后将从空文件重新开始记录。
              </p>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={() => setShowClearConfirm(false)}>取消</Button>
              <Button className="bg-danger text-white" onPress={handleClear} isDisabled={busy}>
                <Trash2 size={14} /> 确认清除
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
