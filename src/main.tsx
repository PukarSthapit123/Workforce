import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- index.html declares #root; its absence is a build-time defect, not a runtime one to guard against.
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
