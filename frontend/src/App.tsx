import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
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
import { ImageViewerProvider, ImageViewer } from '@/components/ImageViewer';
import { ThemeProvider } from '@/components/ThemeProvider';
import BetaWarningModal from '@/components/BetaWarningModal';
import BetaWatermark from '@/components/BetaWatermark';
import { getBuildInfo } from '@/api/backend';
import { Toast } from '@heroui/react';
import { logError } from '@/lib/log';

function App() {
  const [betaVersion, setBetaVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
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
  }, []);

  return (
    <ThemeProvider>
      <ImageViewerProvider>
        <HashRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Home />} />
             <Route path="resource" element={<Resource />} />
             <Route path="resource/cnu/:workId" element={<CnuWorkDetail />} />
             <Route path="resource/pixivel/:workId" element={<PixivelWorkDetail />} />
            <Route path="resource/source-management" element={<WallpaperSourceManagement />} />
             <Route path="generate" element={<Generate />} />
             <Route path="create" element={<Create />} />
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
          </Route>
        </Routes>
      </HashRouter>
      <ImageViewer />
      {betaVersion !== null && (
        <BetaWarningModal
          version={betaVersion}
          onDismiss={() => setBetaVersion(null)}
        />
      )}
      <BetaWatermark />
      <Toast.Provider placement="bottom end" />
    </ImageViewerProvider>
    </ThemeProvider>
  );
}

export default App;
