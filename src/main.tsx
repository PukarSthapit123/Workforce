import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

async function start() {
  /* the fake server runs unless explicitly switched off: VITE_MOCKS=off */
  if (import.meta.env.VITE_MOCKS !== 'off') await (await import('./mocks/browser')).startFakeServer();
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- index.html declares #root; its absence is a build-time defect, not a runtime one to guard against.
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
}
void start();
