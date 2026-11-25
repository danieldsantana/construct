import { useTabela } from '../lib/dados';
import type { SituacaoNF } from './recebimento';

// Uma linha por OF (cabeçalho + previsto dos itens + NFs recebidas que citam a OF).
export type OF = {
  id: number; codigo: string; numero: number | null; revisao: number | null;
  emitida_em: string | null; entrega_prevista: string | null; entrega_texto: string | null;
  linha: string; canteiro: string | null;
  itens: number; quantidade: number; peso_previsto: number;
  nfs: number; nfs_recebidas: number; peso_recebido: number; ultima_recebida: string | null;
  nfs_nao_recebidas: number; nfs_sem_controle: number;
};
export type OFItem = { id: number; of_id: number; seq: number | null; tipo_torre: string; descricao: string; unidade: string | null; quantidade: number; peso_kg: number };
export type OFNF = {
  of_id: number; nf_id: number; numero: string; emissao: string | null; peso: number | null;
  situacao: 'nao_recebida' | 'em_conferencia' | 'confirmada'; canteiro_recebimento: string | null; linha_nf: string | null; recebida_em: string | null;
  situacao_exibida: SituacaoNF; destino: string | null; sac: string | null; rnc: string | null;
  local_entrega: string | null; linha_local: string | null;
};

export const useOFs = () => useTabela<OF>('of_resumo', '*', ['linha', 'numero']);
export const useOFItens = () => useTabela<OFItem>('of_item', 'id, of_id, seq, tipo_torre, descricao, unidade, quantidade, peso_kg', ['of_id', 'seq', 'id']);
export const useOFNFs = () => useTabela<OFNF>('of_nf', '*', ['of_id', 'nf_id']);

// 'OF-71607-EM-BRM-114' -> 'OF-114' (como nos controles do T4)
export const ofCurta = (o: Pick<OF, 'codigo' | 'numero'>) => (o.numero !== null ? `OF-${o.numero}` : o.codigo);

// Atendimento por componentes: item da OF × conjunto completo formado só com os volumes das NFs da OF (na unidade da OF)
export type OFComponente = { of_item_id: number; of_id: number; quantidade: number; peso_kg: number; componente: string | null; entregue: number | null };
export const useOFComponentes = () =>
  useTabela<OFComponente>('of_componente', 'of_item_id, of_id, quantidade, peso_kg, componente, entregue', ['of_id', 'of_item_id']);

// % do peso da OF em componentes completos: cada item conta min(entregue, qtd) / qtd do seu peso
export function atendimentoComponentes(itens: OFComponente[]) {
  const vs = itens.filter((i) => i.componente && Number(i.quantidade) > 0);
  const peso = vs.reduce((s, i) => s + Number(i.peso_kg), 0);
  const ok = vs.reduce((s, i) => s + Math.min(Number(i.entregue ?? 0), Number(i.quantidade)) / Number(i.quantidade) * Number(i.peso_kg), 0);
  return peso ? ok / peso : 0;
}
