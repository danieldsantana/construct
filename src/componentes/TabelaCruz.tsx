import { useCallback, useEffect, useLayoutEffect, useRef, type MouseEvent } from 'react';

// Tabelas com destaque em cruz (mouse) e seleção de células como no Excel — usado no Estoque, na Lista e na Planilha de entrada.
// Uso: <table className="cruz" ref={s.ref} onMouseDown={s.onMouseDown} onMouseOver={s.onMouseOver} onMouseLeave={s.onMouseLeave}>,
// linhas do tbody com data-k (identificador da linha) e <ResumoSelecao refSpan={s.resumoRef} /> onde mostrar a soma.
// Tudo é aplicado direto no DOM (sem estado do React): mover o mouse, arrastar ou usar as setas não redesenha a tabela.
// Teclado: setas movem; Shift+setas estendem a partir da âncora; Ctrl+setas vão até a borda; Esc limpa. Shift+clique estende.
type Pos = { r: number; c: number };
const BORDA = 'rgba(0, 46, 109, .38)';

// A cruz do mouse vale sempre. Opções da SELEÇÃO: cruz = sombra fixa na linha/coluna das células selecionadas;
// referencia = seletor das células da linha que acompanham a seleção (ex. Lista: 'td.tnum, td.tipo', sem cruz fixa).
export function useTabelaCruz({ cruz = true, referencia = '' }: { cruz?: boolean; referencia?: string } = {}) {
  const ref = useRef<HTMLTableElement>(null);
  const resumoRef = useRef<HTMLSpanElement>(null);
  const sel = useRef<Set<string>>(new Set());
  const arraste = useRef<{ ini: Pos; base: Set<string>; ultimo: string } | null>(null);
  const ancora = useRef<Pos | null>(null);   // onde a seleção começou (Shift estende a partir daqui)
  const ativo = useRef<Pos | null>(null);    // célula "atual" (as setas movem esta)

  const linhas = () => [...(ref.current?.querySelectorAll<HTMLTableRowElement>(':scope > tbody > tr[data-k]') ?? [])];
  const chave = (td: HTMLTableCellElement) => `${(td.parentElement as HTMLElement).dataset.k}|${td.cellIndex}`;
  const celula = (alvo: EventTarget) => {
    const td = (alvo as HTMLElement).closest('td') as HTMLTableCellElement | null;
    const tr = td?.parentElement as HTMLTableRowElement | undefined;
    return td && tr?.dataset.k && td.closest('table') === ref.current ? td : null;
  };
  // rola o contêiner para a célula ficar à vista, descontando o cabeçalho e as colunas congeladas (sticky)
  const mostrar = (td: HTMLTableCellElement | null) => {
    if (!td) return;
    let box: HTMLElement | null = td.parentElement;
    while (box && !(box.scrollHeight > box.clientHeight || box.scrollWidth > box.clientWidth) ) box = box.parentElement;
    if (!box || typeof td.getBoundingClientRect !== 'function') return;
    const b = box.getBoundingClientRect(), c = td.getBoundingClientRect();
    const cab = ref.current?.tHead?.getBoundingClientRect();
    const topoLivre = cab ? Math.max(b.top, cab.bottom) : b.top;
    let esqLivre = b.left;
    for (const x of (td.parentElement as HTMLTableRowElement).cells) {
      if (x === td) break;
      if (getComputedStyle(x).position === 'sticky') esqLivre = Math.max(esqLivre, x.getBoundingClientRect().right);
    }
    if (c.top < topoLivre) box.scrollTop -= topoLivre - c.top;
    else if (c.bottom > b.bottom - 14) box.scrollTop += c.bottom - b.bottom + 14;
    if (c.left < esqLivre) box.scrollLeft -= esqLivre - c.left;
    else if (c.right > b.right - 14) box.scrollLeft += c.right - b.right + 14;
  };
  const tdEm = (ls: HTMLTableRowElement[], p: Pos) => {
    const tr = ls[p.r];
    return tr ? tr.cells[Math.min(p.c, tr.cells.length - 1)] ?? null : null;
  };

  // marca as células selecionadas (+ sombra leve na linha e na coluna), borda só no contorno, e escreve contagem/soma
  const aplicar = useCallback(() => {
    const t = ref.current;
    if (!t) return;
    t.querySelectorAll<HTMLTableCellElement>('td.selc').forEach((td) => { td.style.boxShadow = ''; });
    t.querySelectorAll('td.selc, td.sel-lin, td.sel-col, td.sel-ref').forEach((td) => td.classList.remove('selc', 'sel-lin', 'sel-col', 'sel-ref'));
    const s = sel.current;
    let numeros = 0, soma = 0;
    if (s.size) {
      const cols = new Set<number>();
      const ls = linhas();
      const marcada = (r: number, c: number) => { const tr = ls[r]; const td = tr?.cells[c]; return !!td && td.cellIndex === c && s.has(chave(td)); };
      ls.forEach((tr, r) => {
        let tem = false;
        for (const td of tr.cells) {
          if (!s.has(chave(td))) continue;
          tem = true; cols.add(td.cellIndex); td.classList.add('selc');
          const c = td.cellIndex;
          // borda só onde a vizinha não está selecionada (seleção contínua sem bordas internas)
          const lados = [
            !marcada(r - 1, c) && `inset 0 1px 0 ${BORDA}`, !marcada(r + 1, c) && `inset 0 -1px 0 ${BORDA}`,
            !marcada(r, c - 1) && `inset 1px 0 0 ${BORDA}`, !marcada(r, c + 1) && `inset -1px 0 0 ${BORDA}`,
          ].filter(Boolean);
          td.style.boxShadow = lados.join(', ');
          const txt = (td.textContent ?? '').trim();
          if (/^-?[\d.]+(,\d+)?$/.test(txt)) { numeros += 1; soma += Number(txt.replace(/\./g, '').replace(',', '.')); }
        }
        if (tem && cruz) for (const td of tr.cells) td.classList.add('sel-lin');
        if (tem && referencia) tr.querySelectorAll(referencia).forEach((td) => td.classList.add('sel-ref'));
      });
      if (cruz) for (const tr of ls) for (const td of tr.cells) if (cols.has(td.cellIndex)) td.classList.add('sel-col');
    }
    const r = resumoRef.current;
    if (r) {
      r.textContent = s.size > 1
        ? `${s.size} células${numeros > 1 ? ` · soma ${soma.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}` : ''} · Esc limpa`
        : '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const p = { r: linhas().indexOf(td.parentElement as HTMLTableRowElement), c: td.cellIndex };
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.shiftKey && ancora.current) {  // Shift+clique: estende da âncora até aqui
      ativo.current = p;
      sel.current = retangulo(ancora.current, p);
      arraste.current = { ini: ancora.current, base: new Set(), ultimo: k };
      aplicar();
      return;
    }
    if (ctrl && sel.current.has(k)) { sel.current.delete(k); arraste.current = null; aplicar(); return; }
    if (!ctrl && sel.current.size === 1 && sel.current.has(k)) { sel.current = new Set(); arraste.current = null; ancora.current = ativo.current = null; aplicar(); return; }
    const base = ctrl ? new Set(sel.current) : new Set<string>();
    arraste.current = { ini: p, base, ultimo: k };
    ancora.current = p; ativo.current = p;
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
    const p = { r: linhas().indexOf(tr), c: td.cellIndex };
    ativo.current = p;
    sel.current = new Set([...a.base, ...retangulo(a.ini, p)]);
    aplicar();
  };

  const onMouseLeave = (e: MouseEvent<HTMLTableElement>) => { delete e.currentTarget.dataset.col; };

  useEffect(() => {
    const fim = () => { arraste.current = null; };
    const tecla = (e: KeyboardEvent) => {
      if (!sel.current.size || !ref.current || !ativo.current) return;
      const alvo = e.target as HTMLElement;
      if (typeof alvo?.closest === 'function' && alvo.closest('input, select, textarea, [contenteditable="true"]')) return;
      if (e.key === 'Escape') { sel.current = new Set(); ancora.current = ativo.current = null; aplicar(); return; }
      const dir = ({ ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] } as Record<string, [number, number]>)[e.key];
      if (!dir) return;
      e.preventDefault();
      const ls = linhas();
      if (!ls.length) return;
      const a = ativo.current;
      const ctrl = e.ctrlKey || e.metaKey;
      const passo = (q: Pos): Pos | null => {
        const n = { r: q.r + dir[0], c: q.c + dir[1] };
        if (n.r < 0 || n.r >= ls.length || n.c < 0 || n.c >= (ls[n.r]?.cells.length ?? 0)) return null;
        return n;
      };
      let novo: Pos = { r: a.r, c: Math.min(a.c, (ls[a.r]?.cells.length ?? 1) - 1) };
      if (!ctrl) {
        novo = passo(novo) ?? novo;
      } else {
        // como no Excel: com valor na próxima, vai até o último valor antes de um vazio; senão, até o próximo valor (ou a borda)
        const cheia = (q: Pos) => { const t = (tdEm(ls, q)?.textContent ?? '').trim(); return t !== '' && t !== '-' && t !== '—'; };
        const prox = passo(novo);
        if (prox) {
          if (cheia(novo) && cheia(prox)) {
            let q = prox;
            for (let n = passo(q); n && cheia(n); n = passo(q)) q = n;
            novo = q;
          } else {
            let q = prox;
            while (!cheia(q)) { const n = passo(q); if (!n) break; q = n; }
            novo = q;
          }
        }
      }
      ativo.current = novo;
      if (e.shiftKey && ancora.current) {
        sel.current = retangulo(ancora.current, novo);
      } else {
        ancora.current = novo;
        const td = tdEm(ls, novo);
        sel.current = td ? new Set([chave(td)]) : new Set();
      }
      aplicar();
      mostrar(tdEm(ls, novo));
    };
    window.addEventListener('mouseup', fim);
    window.addEventListener('keydown', tecla);
    return () => { window.removeEventListener('mouseup', fim); window.removeEventListener('keydown', tecla); };
  }, [aplicar]);

  // depois de cada render (filtro, ordem…), reaplica a marcação nas células que ainda existem
  useLayoutEffect(() => { aplicar(); });

  return { ref, resumoRef, onMouseDown, onMouseOver, onMouseLeave };
}

export function ResumoSelecao({ refSpan }: { refSpan: React.RefObject<HTMLSpanElement | null> }) {
  return <span ref={refSpan} className="resumo-sel num" />;
}
