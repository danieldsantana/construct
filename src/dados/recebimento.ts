import { useTabela } from '../lib/dados';

export type Recebimento = {
  id: number;
  tipo: 'recebimento' | 'transferencia' | 'ajuste';
  data: string | null;
  documento: string | null;
  origem: string;
  linha_id: number;
  linha: string;
  canteiro_id: number;
  canteiro: string;
  nf_id: number | null;
  numero: string | null;
  emissao: string | null;
  fornecedor: string | null;
  of_texto: string | null;
  of_numero: number | null;
  romaneio: string | null;
  valor: number | null;
  peso: number | null;
  situacao: 'nao_recebida' | 'em_conferencia' | 'confirmada' | null;
  itens: number;
};

export type Saldo = {
  linha_id: number;
  linha: string;
  canteiro_id: number;
  canteiro: string;
  material_id: number;
  secao: string;
  descricao: string;
  parte: string | null;
  tipo: string | null;
  unidade: string;
  peso_unit: number | null;
  ordem: number;
  previsto: number;
  recebido: number;
  saido: number;
  saldo: number;
};

export type Lancamento = { movimento_id: number; material_id: number; quantidade: number; linha_id: number; canteiro_id: number };

export const useRecebimentos = () =>
  useTabela<Recebimento>('recebimento_lista', '*', ['id']);

export const useSaldos = () =>
  useTabela<Saldo>('saldo_material_detalhe', 'linha_id, linha, canteiro_id, canteiro, material_id, secao, descricao, parte, tipo, unidade, peso_unit, ordem, previsto, recebido, saido, saldo', ['linha_id', 'canteiro_id', 'material_id']);

// Conjunto completo como o controle calcula (coluna I da VOLUMES RECEBIDOS), na 1ª linha de cada parte.
export type ConjuntoControle = { linha_id: number; canteiro_id: number; material_id: number; quantidade: number };
export const useConjuntosControle = () =>
  useTabela<ConjuntoControle>('conjunto_controle', 'linha_id, canteiro_id, material_id, quantidade', ['linha_id', 'canteiro_id', 'material_id']);

export const useLancamentos = () =>
  useTabela<Lancamento>('movimento_item_detalhe', '*', ['movimento_id', 'material_id']);
