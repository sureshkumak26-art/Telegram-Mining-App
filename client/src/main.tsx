import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';

const tg = (window as any).Telegram?.WebApp;

tg?.ready?.();
tg?.expand?.();

function syncTelegramViewport() {
  const viewportHeight = Number(tg?.viewportHeight);
  if (Number.isFinite(viewportHeight) && viewportHeight > 0) {
    document.documentElement.style.setProperty('--tg-viewport-height', `${viewportHeight}px`);
  }
}

syncTelegramViewport();
tg?.onEvent?.('viewportChanged', syncTelegramViewport);
window.addEventListener('resize', syncTelegramViewport);

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
