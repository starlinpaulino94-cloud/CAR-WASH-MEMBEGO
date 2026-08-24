import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ThemeProvider } from './context/ThemeContext';
import { engancharErroresGlobales } from './lib/observabilidad';
import './index.css';

// Errores globales que el ErrorBoundary de React no ve (promesas sin catch,
// errores fuera del render). OBS-001.
engancharErroresGlobales();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
