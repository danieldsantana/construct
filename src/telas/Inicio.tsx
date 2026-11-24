import { useMemo } from 'react';
import { Link } from 'react-router';
import { Porcentagem, Titulo } from '../componentes/Titulo';
import { useEscopo } from '../lib/escopo';
import { num } from '../lib/formato';
import { useTorres } from '../dados/torres';
import { useSaldos } from '../dados/recebimento';

// Visão geral do escopo: torres por canteiro (LC) e peso de estrutura previsto × recebido (controles importados).
export function Inicio() {
  const { inclui } = useEscopo();
  const { torres, carregando, erro } = useTorres();
  const saldos = useSaldos();

  const canteiros = useMemo(() => {
    const m = new Map<string, { linha: string; canteiro: string; ordem: number; tipos: Map<string, number>; total: number }>();
    for (const t of torres) {
      if (!t.canteiro || !inclui(t.linha_sigla, t.canteiro)) continue;
      const k = `${t.linha_sigla}|${t.canteiro}`;
      const c = m.get(k) ?? { linha: t.linha_sigla, canteiro: t.canteiro, ordem: t.ordem, tipos: new Map(), total: 0 };
      c.tipos.set(t.tipo, (c.tipos.get(t.tipo) ?? 0) + 1);
      c.total += 1; c.ordem = Math.min(c.ordem, t.ordem);
      m.set(k, c);
    }
    return [...m.values()].sort((a, b) => a.linha.localeCompare(b.linha) || a.ordem - b.ordem);
  }, [torres, inclui]);

  const peso = useMemo(() => {
    const m = new Map<string, { prev: number; rec: number }>();
    for (const s of saldos.dados) {
      if (!s.parte || !s.peso_unit) continue;
      const k = `${s.linha}|${s.canteiro}`;
      const p = m.get(k) ?? { prev: 0, rec: 0 };
      p.prev += Number(s.previsto) * Number(s.peso_unit);
      p.rec += Number(s.recebido) * Number(s.peso_unit);
      m.set(k, p);
    }
    return m;
  }, [saldos.dados]);

  if (carregando) return <><Titulo texto="Início" /><p className="muted">Carregando…</p></>;
  if (erro) return <><Titulo texto="Início" /><p className="warn">Não foi possível carregar: {erro}</p></>;

  return (
    <>
      <Titulo texto="Início" />
      <div className="panel" style={{ overflow: 'auto' }}>
        <table>
          <thead><tr>
            <th>Linha</th><th>Canteiro</th><th className="r">Torres (LC)</th><th>Tipos</th>
            <th className="r">Peso previsto (t)</th><th className="r">Peso recebido (t)</th><th>Estrutura recebida</th>
          </tr></thead>
          <tbody>
            {canteiros.map((c) => {
              const p = peso.get(`${c.linha}|${c.canteiro}`);
              return (
                <tr key={c.linha + c.canteiro}>
                  <td><b>{c.linha}</b></td>
                  <td><Link to="/torres">{c.canteiro}</Link></td>
                  <td className="r num">{c.total}</td>
                  <td style={{ fontSize: 13 }}>{[...c.tipos].sort((a, b) => b[1] - a[1]).map(([t, q]) => `${t} ${q}`).join(' · ')}</td>
                  <td className="r num prev">{p ? num(p.prev / 1000, 1) : '—'}</td>
                  <td className="r num rec">{p ? num(p.rec / 1000, 1) : '—'}</td>
                  <td>{p ? <Porcentagem valor={p.prev ? p.rec / p.prev : 0} /> : <span className="muted">controle não importado</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>Torres: Lista de Construção. Peso: volumes de estrutura dos controles importados (recebido × peso unitário da VOLUMES RECEBIDOS).</p>
    </>
  );
}
