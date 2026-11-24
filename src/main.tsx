import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { SessaoProvider } from './lib/sessao';
import { EscopoProvider } from './lib/escopo';
import { roteador } from './rotas';
import './styles/base.css';
import './styles/controle.css';
import './styles/tokens.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessaoProvider>
      <EscopoProvider>
        <RouterProvider router={roteador} />
      </EscopoProvider>
    </SessaoProvider>
  </StrictMode>,
);
