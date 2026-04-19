import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import { ThemeEnvironment } from './components/ThemeEnvironment';
import './styles.css';
import { cacheThemeDocument, getBuiltinThemeDocuments, loadCachedThemeDocument } from './themeSystem';

function AppRoot() {
  const [themeDocument, setThemeDocument] = useState(() => loadCachedThemeDocument() ?? getBuiltinThemeDocuments('zh-CN')[0]);

  function handleThemeChange(nextThemeDocument: typeof themeDocument, options?: { cache?: boolean }) {
    if (options?.cache !== false) {
      cacheThemeDocument(nextThemeDocument);
    }
    setThemeDocument(nextThemeDocument);
  }

  return (
    <ThemeEnvironment themeDocument={themeDocument}>
      <App onThemeChange={handleThemeChange} />
    </ThemeEnvironment>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppRoot />
  </React.StrictMode>,
);
