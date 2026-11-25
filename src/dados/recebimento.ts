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

// Uma linha por NF (emitidas pelo índice dos PDFs + recebidas pelos controles).
export type SituacaoNF = 'nao_recebida' | 'em_conferencia' | 'confirmada' | 'sem_controle' | 'reposicao';
export type NotaFiscal = {
  id: number; numero: string; emissao: string | null; fornecedor: string | null; of_texto: string | null;
  romaneio: string | null; valor: number | null; peso: number | null; arquivo: string | null; sac: string | null; rnc: string | null;
  linha: string | null; destino: string | null; canteiro_recebimento: string | null;
  recebida_em: string | null; recebimentos: number; itens: number; situacao_exibida: SituacaoNF;
  local_entrega: string | null; linha_local: string | null;
};
export const useNotasFiscais = () =>
  useTabela<NotaFiscal>('nf_lista', 'id, numero, emissao, fornecedor, of_texto, romaneio, valor, peso, arquivo, sac, rnc, linha, destino, canteiro_recebimento, recebida_em, recebimentos, itens, situacao_exibida, local_entrega, linha_local', ['id']);

// Conjunto completo como o controle calcula (coluna I da VOLUMES RECEBIDOS), na 1ª linha de cada parte.
export type ConjuntoControle = { linha_id: number; canteiro_id: number; material_id: number; quantidade: number };
export const useConjuntosControle = () =>
  useTabela<ConjuntoControle>('conjunto_controle', 'linha_id, canteiro_id, material_id, quantidade', ['linha_id', 'canteiro_id', 'material_id']);

export const useLancamentos = () =>
  useTabela<Lancamento>('movimento_item_detalhe', '*', ['movimento_id', 'material_id']);

// Estoque por parte ligado à LISTA: conjunto completo do estoque e até onde ele chega na sequência de ataque.
export type EstoqueParte = {
  linha: string; canteiro: string; tipo: string | null; parte: string; conjunto: number; previsto: number;
  torres: number | null; atendidas: number | null; ultima_atendida: string | null; proxima_torre: string | null; proxima_seq: number | null;
};
export const useEstoqueParte = () =>
  useTabela<EstoqueParte>('estoque_parte', 'linha, canteiro, tipo, parte, conjunto, previsto, torres, atendidas, ultima_atendida, proxima_torre, proxima_seq',
    ['linha', 'canteiro', 'tipo', 'parte']);

// Romaneio do PDF × lançado, por volume da matriz (só NFs cujo romaneio conferiu com o peso do DANFE/ENTRADA)
export type ConferenciaNF = { nota_fiscal_id: number; volume: string | null; qtd_romaneio: number; qtd_lancada: number };
export const useConferenciaNF = () =>
  useTabela<ConferenciaNF>('nf_conferencia', 'nota_fiscal_id, volume, qtd_romaneio, qtd_lancada', ['nota_fiscal_id', 'volume']);
export type LeituraRomaneio = { id: number; romaneio_confere: boolean | null; romaneio_obs: string | null; peso_danfe: number | null };
export const useLeituraRomaneio = () =>
  useTabela<LeituraRomaneio>('nota_fiscal', 'id, romaneio_confere, romaneio_obs, peso_danfe', ['id']);
