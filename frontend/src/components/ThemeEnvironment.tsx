import { Box, CssBaseline } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { useMemo } from 'react';

import { buildMuiTheme, compileThemeStyleSheets } from '../themeSystem';
import type { ThemeDocument } from '../themeSystem';
import { useResolvedThemeAssetSource } from '../useResolvedThemeAssetSource';

type ThemeEnvironmentProps = {
  themeDocument: ThemeDocument;
  children: React.ReactNode;
};

export function ThemeEnvironment({ themeDocument, children }: ThemeEnvironmentProps) {
  const theme = useMemo(() => buildMuiTheme(themeDocument), [themeDocument]);
  const styleSheets = useMemo(() => compileThemeStyleSheets(themeDocument), [themeDocument]);
  const background = themeDocument.theme.background;
  const backgroundSource = useResolvedThemeAssetSource(background.source);
  const posterSource = useResolvedThemeAssetSource(background.poster);
  const overlayGradient = `linear-gradient(145deg, ${theme.palette.background.default} 0%, ${theme.palette.background.default} 26%, ${theme.palette.background.paper} 100%)`;

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      <Box
        aria-hidden
        sx={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          overflow: 'hidden',
          zIndex: 0,
          background: overlayGradient,
        }}
      >
        {background.kind === 'image' && backgroundSource && (
          <Box
            component="img"
            src={backgroundSource}
            alt=""
            sx={{
              position: 'absolute',
              inset: '-4%',
              width: '108%',
              height: '108%',
              objectFit: background.fit,
              objectPosition: background.position,
              opacity: background.opacity,
              filter: `blur(${background.blur}px) brightness(${background.brightness})`,
              transform: 'scale(1.04)',
            }}
          />
        )}
        {background.kind === 'video' && backgroundSource && (
          <Box
            component="video"
            autoPlay
            muted
            loop
            playsInline
            poster={posterSource || undefined}
            src={backgroundSource}
            sx={{
              position: 'absolute',
              inset: '-4%',
              width: '108%',
              height: '108%',
              objectFit: background.fit,
              objectPosition: background.position,
              opacity: background.opacity,
              filter: `blur(${background.blur}px) brightness(${background.brightness})`,
              transform: 'scale(1.04)',
            }}
          />
        )}
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            background: `linear-gradient(180deg, rgba(0,0,0,0) 0%, ${background.overlay_tint} 100%)`,
            opacity: background.overlay_strength,
          }}
        />
      </Box>
      {styleSheets.globalCss ? <style data-ltw-theme-global>{styleSheets.globalCss}</style> : null}
      {styleSheets.componentCss ? <style data-ltw-theme-components>{styleSheets.componentCss}</style> : null}
      <Box sx={{ position: 'relative', zIndex: 1, minHeight: '100vh' }}>
        {children}
      </Box>
    </ThemeProvider>
  );
}