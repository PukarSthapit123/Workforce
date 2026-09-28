import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

async function start() {
  /* The literal behind lib/fake-server.ts's FAKE_SERVER_ON, used directly
     here on purpose: a constant inside this very module is what lets the
     bundler drop the dynamic import before it builds the chunk graph, so a
     plain production build does not even emit the fake server's chunk. */
  if (__FAKE_SERVER_ON__) await (await import('./mocks/browser')).startFakeServer();
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- index.html declares #root; its absence is a build-time defect, not a runtime one to guard against.
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
}
void start();
