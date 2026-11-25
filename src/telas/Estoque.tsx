import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Abas, Porcentagem, Titulo } from '../componentes/Titulo';
import { useEscopo } from '../lib/escopo';
import { num } from '../lib/formato';
import { useEstoqueParte, useSaldos, type Saldo } from '../dados/recebimento';

type Aba = 'volumes' | 'fixadores';
const n = (v: number | string | null | undefined) => Number(v ?? 0);

// Estoque = previsto × recebido por material, só do que tem previsto no escopo (VOLUMES RECEBIDOS e fixadores).
export function Estoque() {
  const { inclui } = useEscopo();
  const saldos = useSaldos();
  const [aba, setAba] = useState<Aba>('volumes');
  const [tipoSel, setTipoSel] = useState('');

  const doEscopo = useMemo(() => saldos.dados.filter((s) => inclui(s.linha, s.canteiro) && n(s.previsto) > 0), [saldos.dados, inclui]);
  const volumes = useMemo(() => doEscopo.filter((s) => s.parte), [doEscopo]);
  const fixadores = useMemo(() => doEscopo.filter((s) => s.secao.startsWith('FIXADORES')), [doEscopo]);
  const canteiros = useMemo(() => [...new Map(doEscopo.map((s) => [`${s.linha}|${s.canteiro}`, s])).values()]
    .map((s) => ({ linha: s.linha, canteiro: s.canteiro })), [doEscopo]);

  if (saldos.carregando) return <><Titulo texto="Estoque" /><p className="muted">Carregando…</p></>;
  if (saldos.erro) return <><Titulo texto="Estoque" /><p className="warn">Não foi possível carregar: {saldos.erro}</p></>;

  return (
    <>
      <Titulo texto="Estoque" />
      <Abas<Aba> abas={[['volumes', 'Volumes'], ['fixadores', 'Fixadores']]} atual={aba} aoMudar={setAba} />
      {doEscopo.length === 0 && <div className="callout">Nada previsto para este escopo nos dados importados.</div>}
      {aba === 'volumes'
        ? <Volumes volumes={volumes} canteiros={canteiros} tipoSel={tipoSel} setTipoSel={setTipoSel} />
        : <Fixadores fixadores={fixadores} canteiros={canteiros} />}
    </>
  );
}

function Volumes({ volumes, canteiros, tipoSel, setTipoSel }: { volumes: Saldo[]; canteiros: { linha: string; canteiro: string }[]; tipoSel: string; setTipoSel: (t: string) => void }) {
  const est = useEstoqueParte();
  const porParte = new Map(est.dados.map((x) => [`${x.linha}|${x.canteiro}|${x.tipo}|${x.parte}`, x]));
  const tipos = [...new Set(volumes.map((v) => v.tipo ?? '—'))];
  const tipo = tipos.includes(tipoSel) ? tipoSel : tipos[0];
  const pesoPct = (t: string) => {
    const vs = volumes.filter((v) => (v.tipo ?? '—') === t);
    const prev = vs.reduce((s, v) => s + n(v.previsto) * n(v.peso_unit), 0);
    const rec = vs.reduce((s, v) => s + n(v.recebido) * n(v.peso_unit), 0);
    return prev ? rec / prev : 0;
  };
  return (
    <>
      <div className="toolbar">
        <div className="chips">
          {tipos.map((t) => (
            <button key={t} className={`chip ${t === tipo ? 'on' : ''}`} onClick={() => setTipoSel(t)}>{t}<span className="n">{Math.round(pesoPct(t) * 100)}%</span></button>
          ))}
        </div>
        <span className="grow" />
        <span className="muted" style={{ fontSize: 13 }}>% = peso recebido ÷ peso previsto do tipo</span>
      </div>
      {canteiros.map(({ linha, canteiro }) => {
        const vs = volumes.filter((v) => v.linha === linha && v.canteiro === canteiro && (v.tipo ?? '—') === tipo).sort((a, b) => a.ordem - b.ordem);
        if (!vs.length) return null;
        const prev = vs.reduce((s, v) => s + n(v.previsto) * n(v.peso_unit), 0);
        const rec = vs.reduce((s, v) => s + n(v.recebido) * n(v.peso_unit), 0);
        const grupos = new Map<string, Saldo[]>();
        for (const v of vs) { const k = v.parte ?? '—'; grupos.set(k, [...(grupos.get(k) ?? []), v]); }
        return (
          <section key={linha + canteiro} className="panel" style={{ marginBottom: 12 }}>
            <div className="tramo-h">
              <b>{linha} · {canteiro.toUpperCase()} · {tipo}</b>
              <span className="muted num">peso previsto {num(prev / 1000, 1)} t · recebido {num(rec / 1000, 1)} t</span>
              <span className="grow" /><Porcentagem valor={prev ? rec / prev : 0} />
            </div>
            <div style={{ overflow: 'auto' }}>
              <table>
                <thead><tr>
                  <th>Volume</th><th className="r">Previsto</th><th className="r">Recebido</th><th className="r">Falta</th>
                  <th className="r">Peso unit. (kg)</th><th className="r">Peso recebido (kg)</th><th className="r">Conjunto completo</th>
                  <th className="r">Torres atendidas</th><th>Próxima torre</th>
                </tr></thead>
                <tbody>
                  {[...grupos].flatMap(([parte, g]) => {
                    // CONJUNTO COMPLETO do estoque (mesmo valor que pinta a LISTA) e até onde ele chega na sequência de ataque
                    const ep = porParte.get(`${linha}|${canteiro}|${g[0].tipo}|${parte}`);
                    const cc = n(ep?.conjunto);
                    const prv = n(ep?.previsto ?? g[0].previsto);
                    const est = { verticalAlign: 'middle' as const, background: 'var(--rec)', borderLeft: '2px solid var(--line)' };
                    return [
                      <tr key={`p${parte}`} className="sec"><td colSpan={9}>{parte}</td></tr>,
                      ...g.map((v, i) => (
                        <tr key={v.material_id}>
                          <td>{v.descricao}</td>
                          <td className="r num prev">{num(v.previsto)}</td>
                          <td className="r num rec">{num(v.recebido)}</td>
                          <td className={`r num ${n(v.previsto) > n(v.recebido) ? 'warn' : ''}`}>{num(Math.max(0, n(v.previsto) - n(v.recebido)))}</td>
                          <td className="r num">{num(v.peso_unit, 3)}</td>
                          <td className="r num">{num(n(v.recebido) * n(v.peso_unit), 1)}</td>
                          {i === 0 && (<>
                            <td className="r num" rowSpan={g.length} style={{ ...est, fontSize: 16, fontWeight: 700, color: cc >= prv ? 'var(--ok)' : undefined }}>
                              {num(cc)}<div className="muted" style={{ fontSize: 11.5, fontWeight: 400 }}>de {num(prv)}</div>
                            </td>
                            <td className="r num" rowSpan={g.length} style={{ ...est, fontSize: 15, fontWeight: 700 }}>
                              {ep?.torres ? <>{ep.atendidas} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>de {ep.torres}</span>
                                {ep.ultima_atendida && <div className="muted" style={{ fontSize: 11.5, fontWeight: 400 }}>até {ep.ultima_atendida}</div>}</> : '—'}
                            </td>
                            <td rowSpan={g.length} style={{ verticalAlign: 'middle' }}>
                              {ep?.proxima_torre
                                ? <Link to={`/lista?q=${encodeURIComponent(ep.proxima_torre)}`} title="Ver na Lista">{ep.proxima_torre}</Link>
                                : ep?.torres ? <span style={{ color: 'var(--ok)' }}>todas atendidas</span> : '—'}
                              {ep?.proxima_seq != null && <div className="muted" style={{ fontSize: 11.5 }}>seq. {ep.proxima_seq}</div>}
                            </td>
                          </>)}
                        </tr>
                      )),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}

function Fixadores({ fixadores, canteiros }: { fixadores: Saldo[]; canteiros: { linha: string; canteiro: string }[] }) {
  return (
    <>
      <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>Previsto = coluna PREVISTO da ENTRADA (nos fixadores a granel já inclui os 5%). Peso dos fixadores ainda não importado.</p>
      {canteiros.map(({ linha, canteiro }) => {
        const fs = fixadores.filter((f) => f.linha === linha && f.canteiro === canteiro).sort((a, b) => a.ordem - b.ordem);
        if (!fs.length) return null;
        let secao = '';
        return (
          <section key={linha + canteiro} className="panel" style={{ marginBottom: 12 }}>
            <div className="tramo-h"><b>{linha} · {canteiro.toUpperCase()}</b></div>
            <div style={{ overflow: 'auto' }}>
              <table>
                <thead><tr><th>Fixador</th><th className="r">Previsto</th><th className="r">Recebido</th><th className="r">Saldo</th><th>Atendido</th></tr></thead>
                <tbody>
                  {fs.flatMap((f) => {
                    const out = [];
                    if (f.secao !== secao) { secao = f.secao; out.push(<tr key={`s${f.material_id}`} className="sec"><td colSpan={5}>{f.secao}</td></tr>); }
                    const saldo = n(f.recebido) - n(f.previsto);
                    out.push(
                      <tr key={f.material_id}>
                        <td><b>{f.descricao}</b></td>
                        <td className="r num prev">{num(f.previsto)}</td>
                        <td className="r num rec">{num(f.recebido)}</td>
                        <td className={`r num ${saldo < 0 ? 'warn' : ''}`} style={saldo >= 0 ? { color: 'var(--ok)' } : undefined}>{num(saldo)}</td>
                        <td><Porcentagem valor={n(f.previsto) ? n(f.recebido) / n(f.previsto) : 0} ok={n(f.recebido) >= n(f.previsto)} /></td>
                      </tr>,
                    );
                    return out;
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
