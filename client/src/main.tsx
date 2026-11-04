import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';

const tg = (window as any).Telegram?.WebApp;

tg?.ready?.();
tg?.expand?.();
tg?.requestFullscreen?.();

function syncTelegramViewport() {
  const viewportHeight = Number(tg?.viewportStableHeight || tg?.viewportHeight);
  if (Number.isFinite(viewportHeight) && viewportHeight > 0) {
    document.documentElement.style.setProperty('--tg-viewport-height', `${viewportHeight}px`);
  }

  const safeArea = tg?.safeAreaInset || {};
  const contentSafeArea = tg?.contentSafeAreaInset || {};
  for (const [side, value] of Object.entries(safeArea)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      document.documentElement.style.setProperty(`--tg-safe-area-inset-${side}`, `${value}px`);
    }
  }
  for (const [side, value] of Object.entries(contentSafeArea)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      document.documentElement.style.setProperty(`--tg-content-safe-area-inset-${side}`, `${value}px`);
    }
  }
}

syncTelegramViewport();
tg?.onEvent?.('viewportChanged', syncTelegramViewport);
tg?.onEvent?.('safeAreaChanged', syncTelegramViewport);
tg?.onEvent?.('contentSafeAreaChanged', syncTelegramViewport);
window.addEventListener('resize', syncTelegramViewport);

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
