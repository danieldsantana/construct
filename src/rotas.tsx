import { createHashRouter } from 'react-router';
import { Moldura } from './telas/Moldura';
import { Inicio } from './telas/Inicio';
import { Torres } from './telas/Torres';
import { Notas } from './telas/Notas';
import { Estoque } from './telas/Estoque';
import { OFs } from './telas/OFs';
import { RNCs } from './telas/RNCs';

// HashRouter: o GitHub Pages só serve arquivos estáticos, então as rotas ficam após o "#".
export const roteador = createHashRouter([
  {
    path: '/',
    element: <Moldura />,
    children: [
      { index: true, element: <Inicio /> },
      { path: 'torres', element: <Torres /> },
      { path: 'notas', element: <Notas /> },
      { path: 'estoque', element: <Estoque /> },
      { path: 'ofs', element: <OFs /> },
      { path: 'rncs', element: <RNCs /> },
    ],
  },
]);
