import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom';
import Layout from '@/components/Layout';
import Home from '@/pages/Home';
import Resource from '@/pages/Resource';
import CnuWorkDetail from '@/pages/CnuWorkDetail';
import PixivelWorkDetail from '@/pages/PixivelWorkDetail';
import WallpaperSourceManagement from '@/pages/WallpaperSourceManagement';
import Generate from '@/pages/Generate';
import Create from '@/pages/Create';
import Search from '@/pages/Search';
import Sniff from '@/pages/Sniff';
import Favorite from '@/pages/Favorite';
import Tags from '@/pages/Tags';
import Store from '@/pages/Store';
import Settings from '@/pages/Settings';
import Help from '@/pages/Help';
import History from '@/pages/History';
import Tools from '@/pages/Tools';
import ColorPalette from '@/pages/ColorPalette';
import DynamicWallpaperDebug from '@/pages/DynamicWallpaperDebug';
import DynamicWallpaper from '@/pages/DynamicWallpaper';
import DynamicWidgetEditor from '@/pages/DynamicWidgetEditor';
import DynamicWallpaperRuntime from '@/pages/DynamicWallpaperRuntime';
import Automation from '@/pages/Automation';
import { ImageViewerProvider, ImageViewer } from '@/components/ImageViewer';
import { ThemeProvider } from '@/components/ThemeProvider';
import BetaWarningModal from '@/components/BetaWarningModal';
import BetaWatermark from '@/components/BetaWatermark';
import { getBuildInfo } from '@/api/backend';
import { Toast } from '@heroui/react';
import { logError } from '@/lib/log';
import { PluginProvider } from '@/plugins/context';
import PluginPage from '@/plugins/PluginPage';
import PluginGlobalUI from '@/plugins/PluginGlobalUI';
import StaticWallpaperGuardProvider from '@/components/StaticWallpaperGuardProvider';
import TextContextMenu from '@/components/TextContextMenu';
import WindowTitleBar from '@/components/WindowTitleBar';

function AppContent() {
  const location = useLocation();
  const isWallpaperRuntime = location.pathname === '/dynamic/runtime';
  const windowTitle = location.pathname === '/dynamic/editor' ? '小组件编辑器' : '小树壁纸 Next';
  const [betaVersion, setBetaVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (isWallpaperRuntime) {
      setBetaVersion(null);
      return undefined;
    }
    (async () => {
      try {
        const info = await getBuildInfo();
        if (cancelled) return;
        if (info.build_type === 'beta') {
          setBetaVersion(info.version);
        }
      } catch (e) {
        logError('getBuildInfo failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isWallpaperRuntime]);

  if (isWallpaperRuntime) {
    return (
      <PluginProvider>
        <Routes>
          <Route path="/dynamic/runtime" element={<DynamicWallpaperRuntime />} />
        </Routes>
      </PluginProvider>
    );
  }

  return (
    <ThemeProvider>
      <div className="relative z-10 flex h-screen w-screen min-h-0 flex-col overflow-hidden">
        <WindowTitleBar title={windowTitle} />
        <div className="min-h-0 flex-1">
        <StaticWallpaperGuardProvider>
          <PluginProvider>
            <ImageViewerProvider>
            <Routes>
              <Route path="/" element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="resource" element={<Resource />} />
                <Route path="resource/cnu/:workId" element={<CnuWorkDetail />} />
                <Route path="resource/pixivel/:workId" element={<PixivelWorkDetail />} />
                <Route path="resource/source-management" element={<WallpaperSourceManagement />} />
                <Route path="generate" element={<Generate />} />
                <Route path="create" element={<Create />} />
                <Route path="dynamic" element={<DynamicWallpaper />} />
                <Route path="dynamic/editor" element={<DynamicWidgetEditor />} />
                <Route path="dynamic/runtime" element={<DynamicWallpaperRuntime />} />
                <Route path="automation" element={<Automation />} />
                <Route path="search" element={<Search />} />
                <Route path="sniff" element={<Sniff />} />
                <Route path="favorite" element={<Favorite />} />
                <Route path="tags" element={<Tags />} />
                <Route path="store" element={<Store />} />
                <Route path="settings" element={<Settings />} />
                <Route path="settings/:tab" element={<Settings />} />
                <Route path="help" element={<Help />} />
                <Route path="history" element={<History />} />
                <Route path="tools" element={<Tools />} />
                <Route path="tools/color-palette" element={<ColorPalette />} />
                <Route path="tools/dynamic-wallpaper" element={<DynamicWallpaperDebug />} />
                <Route path="*" element={<PluginPage />} />
              </Route>
            </Routes>
            <ImageViewer />
            {betaVersion !== null && (
              <BetaWarningModal
                version={betaVersion}
                onDismiss={() => setBetaVersion(null)}
              />
            )}
            <BetaWatermark />
            <PluginGlobalUI />
            <TextContextMenu />
            <Toast.Provider placement="bottom end" />
            </ImageViewerProvider>
          </PluginProvider>
        </StaticWallpaperGuardProvider>
        </div>
      </div>
    </ThemeProvider>
  );
}

function App() {
  return <HashRouter><AppContent /></HashRouter>;
}

export default App;
