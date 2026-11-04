import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';

const tg = (window as any).Telegram?.WebApp;

try { tg?.ready?.(); } catch (error) { console.warn('Telegram ready failed:', error); }
try { tg?.expand?.(); } catch (error) { console.warn('Telegram expand failed:', error); }
try { tg?.requestFullscreen?.(); } catch (error) { console.warn('Telegram fullscreen failed:', error); }

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
try { tg?.onEvent?.('viewportChanged', syncTelegramViewport); } catch (error) { console.warn(error); }
try { tg?.onEvent?.('safeAreaChanged', syncTelegramViewport); } catch (error) { console.warn(error); }
try { tg?.onEvent?.('contentSafeAreaChanged', syncTelegramViewport); } catch (error) { console.warn(error); }
window.addEventListener('resize', syncTelegramViewport);

type BoundaryState = { error: string | null };
class StartupErrorBoundary extends React.Component<React.PropsWithChildren, BoundaryState> {
  state: BoundaryState = { error: null };
  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: error instanceof Error ? error.stack || error.message : String(error) };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('App render failed:', error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return <main style={{ minHeight: '100vh', padding: 24, background: '#05090d', color: '#fff', fontFamily: 'system-ui', overflowWrap: 'anywhere' }}>
        <h2 style={{ color: '#4FD2C0' }}>Miner could not start</h2>
        <p>The app hit a startup error. Send this message to support:</p>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: '#ffb7b7' }}>{this.state.error}</pre>
      </main>;
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  document.body.innerHTML = '<main style="padding:24px;background:#05090d;color:white;font:16px system-ui">Miner startup error: #root element is missing from index.html.</main>';
} else {
  createRoot(rootElement).render(<StartupErrorBoundary><App /></StartupErrorBoundary>);
}
