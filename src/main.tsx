import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { SessaoProvider } from './lib/sessao';
import { roteador } from './rotas';
import './styles/tokens.css';
import './styles/base.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessaoProvider>
      <RouterProvider router={roteador} />
    </SessaoProvider>
  </StrictMode>,
);
