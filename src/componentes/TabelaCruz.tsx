import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';

// Tabelas com destaque em cruz (mouse) e seleção de células como no Excel — usado no Estoque e na Lista.
// Na tabela: className "cruz", {...useColunaSobMouse()}, ref/onMouseDown/onMouseOver de useSelecao(); linhas com data-k.

// Destaque em cruz: a linha sob o mouse (CSS :hover) e a coluna (índice da célula, via data-col na tabela).
export function useColunaSobMouse() {
  const [col, setCol] = useState<number | null>(null);
  const sobre = (e: MouseEvent<HTMLTableElement>) => {
    const td = (e.target as HTMLElement).closest('td');
    const tr = td?.parentElement;
    setCol(td && tr && !tr.classList.contains('faixa') && !tr.classList.contains('vols') && td.closest('table') === e.currentTarget ? td.cellIndex : null);
  };
  return { 'data-col': col ?? undefined, onMouseOver: sobre, onMouseLeave: () => setCol(null) };
}

// Seleção de células como no Excel: clique seleciona, arrastar seleciona o retângulo, Ctrl soma áreas/células,
// Esc limpa. A célula é identificada pela linha (data-k no <tr>) + índice da coluna; a marcação (célula + sombra leve
// na linha e na coluna, como o destaque do mouse) é aplicada no DOM após cada render.
type Pos = { r: number; c: number };
export function useSelecao({ multipla = true }: { multipla?: boolean } = {}) {
  const ref = useRef<HTMLTableElement>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [resumo, setResumo] = useState<{ n: number; numeros: number; soma: number } | null>(null);
  const arraste = useRef<{ ini: Pos; base: Set<string> } | null>(null);
  const linhas = () => [...(ref.current?.querySelectorAll<HTMLTableRowElement>('tbody tr[data-k]') ?? [])];
  const chave = (td: HTMLTableCellElement) => `${(td.parentElement as HTMLElement).dataset.k}|${td.cellIndex}`;
  const posDe = (alvo: EventTarget): { td: HTMLTableCellElement; p: Pos } | null => {
    const td = (alvo as HTMLElement).closest('td') as HTMLTableCellElement | null;
    const tr = td?.parentElement as HTMLTableRowElement | undefined;
    if (!td || !tr?.dataset.k || td.closest('table') !== ref.current) return null;
    return { td, p: { r: linhas().indexOf(tr), c: td.cellIndex } };
  };
  const retangulo = (a: Pos, b: Pos) => {
    const ls = linhas(), out = new Set<string>();
    for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++)
      for (const td of ls[r]?.cells ?? []) if (td.cellIndex >= Math.min(a.c, b.c) && td.cellIndex <= Math.max(a.c, b.c)) out.add(chave(td));
    return out;
  };
  const onMouseDown = (e: MouseEvent<HTMLTableElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('a, button, input')) return;
    const x = posDe(e.target);
    if (!x) return;
    e.preventDefault();  // não seleciona texto ao arrastar
    const k = chave(x.td);
    const ctrl = multipla && (e.ctrlKey || e.metaKey);  // sem seleção múltipla: Ctrl é ignorado
    if (ctrl && sel.has(k)) {  // Ctrl+clique numa célula marcada: desmarca
      const s2 = new Set(sel); s2.delete(k); setSel(s2); arraste.current = null; return;
    }
    if (!ctrl && sel.size === 1 && sel.has(k)) { setSel(new Set()); arraste.current = null; return; }
    const base = ctrl ? new Set(sel) : new Set<string>();
    arraste.current = multipla ? { ini: x.p, base } : null;  // arrastar só com seleção múltipla
    setSel(new Set([...base, k]));
  };
  const onMouseOver = (e: MouseEvent<HTMLTableElement>) => {
    const a = arraste.current;
    if (!a || !(e.buttons & 1)) return;
    const x = posDe(e.target);
    if (x) setSel(new Set([...a.base, ...retangulo(a.ini, x.p)]));
  };
  useEffect(() => {
    const fim = () => { arraste.current = null; };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setSel(new Set()); };
    window.addEventListener('mouseup', fim);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mouseup', fim); window.removeEventListener('keydown', esc); };
  }, []);
  useLayoutEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.querySelectorAll('td.selc, td.sel-lin, td.sel-col').forEach((td) => td.classList.remove('selc', 'sel-lin', 'sel-col'));
    let numeros = 0, soma = 0;
    const cols = new Set<number>();
    const ls = linhas();
    for (const tr of ls) {
      let linhaSel = false;
      for (const td of tr.cells) {
        if (!sel.has(chave(td))) continue;
        linhaSel = true; cols.add(td.cellIndex); td.classList.add('selc');
        const txt = (td.textContent ?? '').trim();
        if (/^-?[\d.]+(,\d+)?$/.test(txt)) { numeros += 1; soma += Number(txt.replace(/\./g, '').replace(',', '.')); }
      }
      if (linhaSel) for (const td of tr.cells) td.classList.add('sel-lin');
    }
    if (cols.size) for (const tr of ls) for (const td of tr.cells) if (cols.has(td.cellIndex)) td.classList.add('sel-col');
    const novo = sel.size > 1 ? { n: sel.size, numeros, soma } : null;
    setResumo((r) => (JSON.stringify(r) === JSON.stringify(novo) ? r : novo));
  });
  return { ref, onMouseDown, onMouseOver, resumo };
}

export function ResumoSelecao({ r }: { r: { n: number; numeros: number; soma: number } | null }) {
  if (!r) return null;
  return (
    <span className="resumo-sel num">
      {r.n} células{r.numeros > 1 && <> · soma <b>{r.soma.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</b></>}
      <span className="muted"> · Esc limpa</span>
    </span>
  );
}

