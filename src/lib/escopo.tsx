import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

// Escopo = linha e canteiro que valem para todas as telas (barra abaixo do topo).
export type Escopo = { meu: boolean; linha: string; canteiro: string };

// "Meu escopo": T4 inteiro + Laje dos Negros e Umburanas do T3 (o que o usuário mantém).
// Fixo por enquanto; depois vira configuração por usuário.
const MEU = (linha: string, canteiro: string) =>
  linha === 'T4' || (linha === 'T3' && (canteiro === 'Laje dos Negros' || canteiro === 'Umburanas'));

const PADRAO: Escopo = { meu: false, linha: 'T4', canteiro: 'Juazeiro' };
const CHAVE = 'construct.escopo';

function ler(): Escopo {
  try {
    const s = localStorage.getItem(CHAVE);
    if (s) return { ...PADRAO, ...JSON.parse(s) };
  } catch { /* sem acesso ao armazenamento: usa o padrão */ }
  return PADRAO;
}

type Ctx = {
  escopo: Escopo;
  setEscopo: (e: Escopo) => void;
  inclui: (linha: string, canteiro: string) => boolean;
  nome: string;
  canteiroUnico: { linha: string; canteiro: string } | null;
};
const EscopoContexto = createContext<Ctx | null>(null);

export function EscopoProvider({ children }: { children: ReactNode }) {
  const [escopo, setEscopo] = useState<Escopo>(ler);
  useEffect(() => {
    try { localStorage.setItem(CHAVE, JSON.stringify(escopo)); } catch { /* ignora */ }
  }, [escopo]);
  const valor = useMemo<Ctx>(() => {
    const { meu, linha, canteiro } = escopo;
    const inclui = (l: string, c: string) => (meu ? MEU(l, c) : (!linha || l === linha) && (!canteiro || c === canteiro));
    const nome = meu ? 'Meu escopo · T4 + Laje dos Negros e Umburanas do T3'
      : linha ? `${linha}${canteiro ? ' · ' + canteiro : ' inteiro'}` : canteiro ? `${canteiro} (T3 e T4)` : 'Obra toda';
    const canteiroUnico = !meu && linha && canteiro ? { linha, canteiro } : null;
    return { escopo, setEscopo, inclui, nome, canteiroUnico };
  }, [escopo]);
  return <EscopoContexto.Provider value={valor}>{children}</EscopoContexto.Provider>;
}

export function useEscopo() {
  const c = useContext(EscopoContexto);
  if (!c) throw new Error('useEscopo fora do EscopoProvider');
  return c;
}
