import { useCallback, useEffect, useLayoutEffect, useRef, type MouseEvent } from 'react';

// Tabelas com destaque em cruz (mouse) e seleção de células como no Excel — usado no Estoque e na Lista.
// Uso: <table className="cruz" ref={s.ref} onMouseDown={s.onMouseDown} onMouseOver={s.onMouseOver} onMouseLeave={s.onMouseLeave}>,
// linhas do tbody com data-k (identificador da linha) e <ResumoSelecao refSpan={s.resumoRef} /> onde mostrar a soma.
// Tudo é aplicado direto no DOM (sem estado do React): mover o mouse ou arrastar não redesenha a tabela.
type Pos = { r: number; c: number };

export function useTabelaCruz() {
  const ref = useRef<HTMLTableElement>(null);
  const resumoRef = useRef<HTMLSpanElement>(null);
  const sel = useRef<Set<string>>(new Set());
  const arraste = useRef<{ ini: Pos; base: Set<string>; ultimo: string } | null>(null);

  const linhas = () => [...(ref.current?.querySelectorAll<HTMLTableRowElement>(':scope > tbody > tr[data-k]') ?? [])];
  const chave = (td: HTMLTableCellElement) => `${(td.parentElement as HTMLElement).dataset.k}|${td.cellIndex}`;
  const celula = (alvo: EventTarget) => {
    const td = (alvo as HTMLElement).closest('td') as HTMLTableCellElement | null;
    const tr = td?.parentElement as HTMLTableRowElement | undefined;
    return td && tr?.dataset.k && td.closest('table') === ref.current ? td : null;
  };

  // marca as células selecionadas (+ sombra leve na linha e na coluna) e escreve contagem/soma
  const aplicar = useCallback(() => {
    const t = ref.current;
    if (!t) return;
    t.querySelectorAll('td.selc, td.sel-lin, td.sel-col').forEach((td) => td.classList.remove('selc', 'sel-lin', 'sel-col'));
    const s = sel.current;
    let numeros = 0, soma = 0;
    if (s.size) {
      const cols = new Set<number>();
      const ls = linhas();
      for (const tr of ls) {
        let marcada = false;
        for (const td of tr.cells) {
          if (!s.has(chave(td))) continue;
          marcada = true; cols.add(td.cellIndex); td.classList.add('selc');
          const txt = (td.textContent ?? '').trim();
          if (/^-?[\d.]+(,\d+)?$/.test(txt)) { numeros += 1; soma += Number(txt.replace(/\./g, '').replace(',', '.')); }
        }
        if (marcada) for (const td of tr.cells) td.classList.add('sel-lin');
      }
      for (const tr of ls) for (const td of tr.cells) if (cols.has(td.cellIndex)) td.classList.add('sel-col');
    }
    const r = resumoRef.current;
    if (r) {
      r.textContent = s.size > 1
        ? `${s.size} células${numeros > 1 ? ` · soma ${soma.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}` : ''} · Esc limpa`
        : '';
    }
  }, []);

  const retangulo = (a: Pos, b: Pos) => {
    const ls = linhas(), out = new Set<string>();
    for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++)
      for (const td of ls[r]?.cells ?? []) if (td.cellIndex >= Math.min(a.c, b.c) && td.cellIndex <= Math.max(a.c, b.c)) out.add(chave(td));
    return out;
  };

  const onMouseDown = (e: MouseEvent<HTMLTableElement>) => {
    if (e.button !== 0 || e.detail > 1 || (e.target as HTMLElement).closest('a, button, input')) return;
    const td = celula(e.target);
    if (!td) return;
    e.preventDefault();  // não seleciona texto ao arrastar
    const k = chave(td);
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && sel.current.has(k)) { sel.current.delete(k); arraste.current = null; aplicar(); return; }
    if (!ctrl && sel.current.size === 1 && sel.current.has(k)) { sel.current = new Set(); arraste.current = null; aplicar(); return; }
    const base = ctrl ? new Set(sel.current) : new Set<string>();
    arraste.current = { ini: { r: linhas().indexOf(td.parentElement as HTMLTableRowElement), c: td.cellIndex }, base, ultimo: k };
    sel.current = new Set([...base, k]);
    aplicar();
  };

  const onMouseOver = (e: MouseEvent<HTMLTableElement>) => {
    const t = e.currentTarget;
    const td = (e.target as HTMLElement).closest('td') as HTMLTableCellElement | null;
    const tr = td?.parentElement as HTMLTableRowElement | undefined;
    // coluna sob o mouse: atributo na tabela (o CSS pinta a coluna), sem redesenhar
    const col = td && tr?.dataset.k && td.closest('table') === t ? String(td.cellIndex) : '';
    if (t.dataset.col !== col) { if (col) t.dataset.col = col; else delete t.dataset.col; }
    const a = arraste.current;
    if (!a || !(e.buttons & 1) || !td || !tr?.dataset.k) return;
    const k = chave(td);
    if (k === a.ultimo) return;
    a.ultimo = k;
    sel.current = new Set([...a.base, ...retangulo(a.ini, { r: linhas().indexOf(tr), c: td.cellIndex })]);
    aplicar();
  };

  const onMouseLeave = (e: MouseEvent<HTMLTableElement>) => { delete e.currentTarget.dataset.col; };

  useEffect(() => {
    const fim = () => { arraste.current = null; };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && sel.current.size) { sel.current = new Set(); aplicar(); } };
    window.addEventListener('mouseup', fim);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mouseup', fim); window.removeEventListener('keydown', esc); };
  }, [aplicar]);

  // depois de cada render (filtro, ordem…), reaplica a marcação nas células que ainda existem
  useLayoutEffect(() => { aplicar(); });

  return { ref, resumoRef, onMouseDown, onMouseOver, onMouseLeave };
}

export function ResumoSelecao({ refSpan }: { refSpan: React.RefObject<HTMLSpanElement | null> }) {
  return <span ref={refSpan} className="resumo-sel num" />;
}
