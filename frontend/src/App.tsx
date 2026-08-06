import { useEffect, useState } from 'react';
import { Route, Router, Switch } from 'wouter';
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
import ForcedUpdateBanner from '@/components/ForcedUpdateBanner';
import { useHashRouterLocation, usePathname } from '@/lib/router';

function AppContent() {
  const pathname = usePathname();
  const isWallpaperRuntime = pathname === '/dynamic/runtime';
  const windowTitle = pathname === '/dynamic/editor' ? '小组件编辑器' : '小树壁纸 Next';
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
        <Route path="/dynamic/runtime" component={DynamicWallpaperRuntime} />
      </PluginProvider>
    );
  }

  return (
    <ThemeProvider>
      <div className="relative z-10 flex h-screen w-screen min-h-0 flex-col overflow-hidden">
        <WindowTitleBar title={windowTitle} />
        <div className="flex min-h-0 flex-1 flex-col">
          <ForcedUpdateBanner />
          <div className="min-h-0 flex-1">
            <StaticWallpaperGuardProvider>
              <PluginProvider>
                <ImageViewerProvider>
                  <Layout>
                    <Switch>
                      <Route path="/" component={Home} />
                      <Route path="/resource" component={Resource} />
                      <Route path="/resource/cnu/:workId" component={CnuWorkDetail} />
                      <Route path="/resource/pixivel/:workId" component={PixivelWorkDetail} />
                      <Route path="/resource/source-management" component={WallpaperSourceManagement} />
                      <Route path="/generate" component={Generate} />
                      <Route path="/create" component={Create} />
                      <Route path="/dynamic" component={DynamicWallpaper} />
                      <Route path="/dynamic/editor" component={DynamicWidgetEditor} />
                      <Route path="/dynamic/runtime" component={DynamicWallpaperRuntime} />
                      <Route path="/automation" component={Automation} />
                      <Route path="/search" component={Search} />
                      <Route path="/sniff" component={Sniff} />
                      <Route path="/favorite" component={Favorite} />
                      <Route path="/tags" component={Tags} />
                      <Route path="/store" component={Store} />
                      <Route path="/settings" component={Settings} />
                      <Route path="/settings/:tab" component={Settings} />
                      <Route path="/help" component={Help} />
                      <Route path="/history" component={History} />
                      <Route path="/tools" component={Tools} />
                      <Route path="/tools/color-palette" component={ColorPalette} />
                      <Route path="/tools/dynamic-wallpaper" component={DynamicWallpaperDebug} />
                      <Route component={PluginPage} />
                    </Switch>
                  </Layout>
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
      </div>
    </ThemeProvider>
  );
}

function App() {
  return <Router hook={useHashRouterLocation}><AppContent /></Router>;
}

export default App;
