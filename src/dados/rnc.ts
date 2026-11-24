import { useTabela } from '../lib/dados';
import type { SituacaoNF } from './recebimento';

// Uma linha por (RNC, NF de reposição). rnc nula = NF com SAC sem RNC informada.
export type RncNF = {
  rnc: string | null; sac: string | null;
  nf_id: number; numero: string; emissao: string | null; linha: string | null;
  destino: string | null; canteiro_recebimento: string | null;
  situacao_exibida: SituacaoNF; recebida_em: string | null; of_texto: string | null; arquivo: string | null;
};
export const useRncNF = () => useTabela<RncNF>('rnc_nf', '*', ['nf_id', 'rnc']);

// '00806-26' -> 'SAC 806/26' · '1508-25' -> 'SAC 1508/25'
export const sacTexto = (s: string) => {
  const m = /^0*(\d+)-(\d+)$/.exec(s.trim());
  return m ? `SAC ${m[1]}/${m[2]}` : `SAC ${s}`;
};
// '017' -> 'RNC 17'
export const rncTexto = (r: string) => `RNC ${r.replace(/^0+(?=\d)/, '')}`;
