export function num(v: number | string | null | undefined, casas = 0): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

// '2026-11-24' -> '24/11/2026'
export function data(iso: string | null | undefined, curta = false): string {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return curta ? `${d}/${m}` : `${d}/${m}/${a}`;
}

// Letra de coluna do Excel ('AB') -> número (28). Usado para manter a ordem das colunas da ENTRADA.
export function colunaExcel(letra: string): number {
  let n = 0;
  for (const ch of letra.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function colunaDaOrigem(origem: string): number {
  const m = /#([A-Z]+)$/.exec(origem);
  // sem coluna de Excel (lançamento feito pelo app): depois de todas as colunas do controle
  return m ? colunaExcel(m[1]) : 1e6;
}
