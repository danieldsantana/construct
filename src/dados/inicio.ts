import { useTabela } from '../lib/dados';

// Aba TABELAS de cada controle (bloco por tipo), conferida contra a LISTA na importação.
export type TabelaControle = {
  linha: string; canteiro: string; tipo: string; previsto: number; completas: number;
  sem_fixadores: number | null; sem_estrutura: number | null; com_pendencia: number | null; fonte: string;
};
export const useTabelasControle = () =>
  useTabela<TabelaControle>('tabela_controle_detalhe', '*', ['linha', 'canteiro', 'tipo']);

// Conjunto completo de cada parte (valor do controle, coluna CONJUNTO COMPLETO) × previsto.
export type ParteConjunto = { linha: string; canteiro: string; tipo: string | null; parte: string; primeiro_volume: string; conjunto: number; previsto: number };
export const useParteConjunto = () =>
  useTabela<ParteConjunto>('parte_conjunto', '*', ['linha', 'canteiro', 'tipo', 'parte']);
