import { useTabela } from '../lib/dados';

export type Torre = {
  id: number;
  linha_id: number;
  linha_sigla: string;
  numero: string;
  ordem: number;
  tipo: string;
  categoria: 'estaiada' | 'autoportante';
  altura_util: number;
  extensao: number | null;
  perna_a: number | null;
  perna_b: number | null;
  perna_c: number | null;
  perna_d: number | null;
  perna_referencia: string | null;
  canteiro_id: number | null;
  canteiro: string | null;
  ancoragem: boolean;
  arranjo_ferragens: string | null;
  tramo: number | null;
  // aba LISTA do controle do canteiro (null = controle ainda não importado)
  status: string | null;
  status_controle?: string | null;
  fixadores_faltando?: number;          // fixadores a granel que o estoque (pela sequência) ainda não cobre
  fixadores_completos?: boolean | null;  // status digitado no controle (só para comparar; o que vale é o automático)
  sequencia: number | null;
  composicao: Record<string, number> | null;
  fonte: string | null;
};

// Carrega todas as torres uma vez (≈800 linhas); filtros e buscas rodam no navegador, sem esperar o banco.
export function useTorres() {
  const r = useTabela<Torre>('torre_lista',
    'id, linha_id, linha_sigla, numero, ordem, tipo, categoria, altura_util, extensao, perna_a, perna_b, perna_c, perna_d, perna_referencia, canteiro_id, canteiro, ancoragem, arranjo_ferragens, tramo, status, sequencia, composicao, fonte',
    ['linha_sigla', 'ordem']);
  return { torres: r.dados, carregando: r.carregando, erro: r.erro };
}

// Status como está digitado na LISTA; só a caixa é padronizada (FALTANTE e Faltante são o mesmo).
export type ClasseStatus = 'ok' | 'falta' | 'sf' | 'sem';
export function statusDaTorre(t: Pick<Torre, 'status'>): { texto: string; classe: ClasseStatus } {
  const s = (t.status ?? '').trim();
  if (!s) return { texto: t.status === null ? 'Sem controle importado' : 'Sem status', classe: 'sem' };
  const texto = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const k = texto.toLowerCase();
  return { texto, classe: k === 'entregue' ? 'ok' : k === 'faltante' ? 'falta' : 'sf' };
}

// Colunas G–AB da LISTA, na ordem do controle. "m" = valor em metros (extensão e pernas); o resto é quantidade.
export type ColunaComposicao = { chave: string; rotulo: string; metros?: boolean };
export const COMPOSICAO: { grupo: 'AUTOPORTANTE' | 'ESTAIADA'; colunas: ColunaComposicao[] }[] = [
  {
    grupo: 'AUTOPORTANTE', colunas: [
      { chave: 'AP_PR_ANC', rotulo: 'PR anc.' }, { chave: 'AP_PR_SUSP', rotulo: 'PR susp.' },
      { chave: 'AP_CABECA', rotulo: 'Cabeça' }, { chave: 'AP_TRONCO', rotulo: 'Tronco' },
      { chave: 'AP_EXT', rotulo: 'Ext. (m)', metros: true },
      { chave: 'AP_PERNA_A', rotulo: 'Perna A', metros: true }, { chave: 'AP_PERNA_B', rotulo: 'Perna B', metros: true },
      { chave: 'AP_PERNA_C', rotulo: 'Perna C', metros: true }, { chave: 'AP_PERNA_D', rotulo: 'Perna D', metros: true },
      { chave: 'AP_STUB', rotulo: 'Stub' },
    ],
  },
  {
    grupo: 'ESTAIADA', colunas: [
      { chave: 'ES_PR_ANC', rotulo: 'PR anc.' }, { chave: 'ES_PR_SUSP', rotulo: 'PR susp.' },
      { chave: 'ES_CABECA', rotulo: 'Cabeça' }, { chave: 'ES_TRONCO_SUP', rotulo: 'Tronco sup.' },
      { chave: 'ES_EXT_1_5', rotulo: 'Ext. 1,5' }, { chave: 'ES_EXT_3_0', rotulo: 'Ext. 3,0' },
      { chave: 'ES_EXT_4_5', rotulo: 'Ext. 4,5' }, { chave: 'ES_EXT_6_0', rotulo: 'Ext. 6,0' },
      { chave: 'ES_EXT_7_5', rotulo: 'Ext. 7,5' }, { chave: 'ES_TRONCO_INF', rotulo: 'Tronco inf.' },
      { chave: 'ES_CALOTA', rotulo: 'Calota' }, { chave: 'ES_PINO', rotulo: 'Pino' },
    ],
  },
];

export function formatarMetros(v: number | null) {
  return v === null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// Linhas com o código usado nos documentos (T4 = JZTIII-CAFII, T3 = CAFII-BRRII)
export const useLinhas = () => useTabela<{ sigla: string; codigo: string }>('linha', 'sigla, codigo', ['sigla']);

// Pintura da LISTA calculada no banco: conjunto completo do estoque distribuído pela sequência de ataque.
export type TorreComponente = { torre_id: number; chave: string; completo: boolean; necessidade: number; disponivel_antes: number };
export const useTorreComponentes = () =>
  useTabela<TorreComponente>('torre_componente', 'torre_id, chave, completo, necessidade, disponivel_antes', ['torre_id', 'chave']);

// Status automático (a LISTA manda): Entregue = todos os componentes completos pelo estoque; fixadores ainda não entram.
export type StatusAuto = { torre_id: number; status: 'Entregue' | 'Faltante'; componentes: number; completos: number;
  fixadores_faltando: number; fixadores_completos: boolean | null };
export const useStatusAuto = () => useTabela<StatusAuto>('torre_status_auto', 'torre_id, status, componentes, completos, fixadores_faltando, fixadores_completos', ['torre_id']);
