import { useEffect, useMemo, useRef, useState } from 'react';

// Filtro de coluna no estilo do autofiltro do Excel: ▾ no título; lista dos valores da coluna com caixas de marcação,
// busca e "Selecionar tudo". selecionados = null significa sem filtro (todos).
export function FiltroColuna({ titulo, valores, selecionados, aoMudar, ordem }: {
  titulo: string; valores: string[]; selecionados: Set<string> | null; aoMudar: (s: Set<string> | null) => void;
  ordem?: (a: string, b: string) => number;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const ref = useRef<HTMLSpanElement>(null);
  const contagem = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of valores) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m].sort((a, b) => (ordem ? ordem(a[0], b[0]) : a[0].localeCompare(b[0], 'pt-BR', { numeric: true })));
  }, [valores, ordem]);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    window.addEventListener('mousedown', fora);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', fora); window.removeEventListener('keydown', esc); };
  }, [aberto]);
  const vis = contagem.filter(([v]) => v.toLowerCase().includes(busca.trim().toLowerCase()));
  const marcado = (v: string) => !selecionados || selecionados.has(v);
  const alternar = (v: string) => {
    const base = new Set(selecionados ?? contagem.map(([x]) => x));
    if (base.has(v)) base.delete(v); else base.add(v);
    aoMudar(base.size === contagem.length ? null : base);
  };
  const todosVis = vis.every(([v]) => marcado(v));
  return (
    <span className="filtro-col" ref={ref}>
      {titulo}
      <button className={`fc-bt ${selecionados ? 'ativo' : ''}`} onClick={(e) => { e.stopPropagation(); setAberto(!aberto); }} aria-label={`Filtrar ${titulo}`}>▾</button>
      {aberto && (
        <div className="fc-pop" onClick={(e) => e.stopPropagation()}>
          <input autoFocus placeholder="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <label className="fc-tudo">
            <input type="checkbox" checked={todosVis} onChange={() => {
              const base = new Set(selecionados ?? contagem.map(([x]) => x));
              for (const [v] of vis) { if (todosVis) base.delete(v); else base.add(v); }
              aoMudar(base.size === contagem.length ? null : base);
            }} /> Selecionar tudo
          </label>
          <div className="fc-lista">
            {vis.map(([v, n]) => (
              <label key={v}><input type="checkbox" checked={marcado(v)} onChange={() => alternar(v)} /> <span>{v}</span><span className="n">{n}</span></label>
            ))}
          </div>
          {selecionados && <button className="link" onClick={() => aoMudar(null)}>Limpar filtro</button>}
        </div>
      )}
    </span>
  );
}
