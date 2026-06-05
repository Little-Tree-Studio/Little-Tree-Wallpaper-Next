import { HashRouter, Routes, Route } from 'react-router-dom';
import Layout from '@/components/Layout';
import Home from '@/pages/Home';
import Resource from '@/pages/Resource';
import Generate from '@/pages/Generate';
import Sniff from '@/pages/Sniff';
import Favorite from '@/pages/Favorite';
import Store from '@/pages/Store';
import Settings from '@/pages/Settings';
import History from '@/pages/History';
import Tools from '@/pages/Tools';
import ColorPalette from '@/pages/ColorPalette';
import { ImageViewerProvider, ImageViewer } from '@/components/ImageViewer';
import { ThemeProvider } from '@/components/ThemeProvider';
import { Toast } from '@heroui/react';

function App() {
  return (
    <ThemeProvider>
      <ImageViewerProvider>
        <HashRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="resource" element={<Resource />} />
            <Route path="generate" element={<Generate />} />
            <Route path="sniff" element={<Sniff />} />
            <Route path="favorite" element={<Favorite />} />
            <Route path="store" element={<Store />} />
            <Route path="settings" element={<Settings />} />
            <Route path="settings/:tab" element={<Settings />} />
            <Route path="history" element={<History />} />
            <Route path="tools" element={<Tools />} />
            <Route path="tools/color-palette" element={<ColorPalette />} />
          </Route>
        </Routes>
      </HashRouter>
      <ImageViewer />
      <Toast.Provider placement="bottom end" />
    </ImageViewerProvider>
    </ThemeProvider>
  );
}

export default App;
