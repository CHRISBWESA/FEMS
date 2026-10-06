import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './lib/axios';
import './index.css';
import { purgeExpired } from './offline/session';
import { ToastProvider } from './components/ui';

// Expired offline data (member lists after 24 h, very old unsent check-ins) is removed as the app starts.
purgeExpired().catch(() => undefined);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>,
);
