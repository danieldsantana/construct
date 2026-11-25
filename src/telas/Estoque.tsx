import { Fragment, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Abas, Porcentagem, Titulo } from '../componentes/Titulo';
import { useEscopo } from '../lib/escopo';
import { num } from '../lib/formato';
import { useEstoqueParte, useSaldos, type EstoqueParte, type Saldo } from '../dados/recebimento';
import './Estoque.css';

type Aba = 'volumes' | 'fixadores';
const n = (v: number | string | null | undefined) => Number(v ?? 0);

// Estoque = VOLUMES RECEBIDOS (uma linha por parte, volumes ao abrir) e fixadores, só do que tem previsto no escopo.
// O conjunto completo é o do estoque — o mesmo que pinta a Lista — e mostra até onde chega na sequência de ataque.
export function Estoque() {
  const { inclui } = useEscopo();
  const saldos = useSaldos();
  const est = useEstoqueParte();
  const [params, setParams] = useSearchParams();
  const aba: Aba = params.get('aba') === 'fixadores' ? 'fixadores' : 'volumes';
  const tipos = (params.get('tipos') ?? '').split(',').filter(Boolean);
  const soFalta = params.get('falta') === '1';
  const mudar = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    setParams(p, { replace: true });
  };

  const doEscopo = useMemo(() => saldos.dados.filter((s) => inclui(s.linha, s.canteiro) && n(s.previsto) > 0), [saldos.dados, inclui]);
  const varios = new Set(doEscopo.map((s) => `${s.linha}|${s.canteiro}`)).size > 1;

  if (saldos.carregando || est.carregando) return <><Titulo texto="Estoque" /><p className="muted">Carregando…</p></>;
  const erro = saldos.erro ?? est.erro;
  if (erro) return <><Titulo texto="Estoque" /><p className="warn">Não foi possível carregar: {erro}</p></>;

  return (
    <div className="estoque cheia">
      <Titulo texto="Estoque" />
      <Abas<Aba> abas={[['volumes', 'Volumes'], ['fixadores', 'Fixadores']]} atual={aba} aoMudar={(a) => mudar('aba', a === 'volumes' ? '' : a)} />
      {doEscopo.length === 0
        ? <div className="callout">Nada previsto para este escopo nos dados importados.</div>
        : aba === 'volumes'
          ? <Volumes saldos={doEscopo.filter((s) => s.parte)} est={est.dados} varios={varios} tipos={tipos} soFalta={soFalta} mudar={mudar} />
          : <Fixadores fixadores={doEscopo.filter((s) => s.secao.startsWith('FIXADORES'))} varios={varios} soFalta={soFalta} mudar={mudar} />}
    </div>
  );
}

type Parte = {
  chave: string; linha: string; canteiro: string; tipo: string; parte: string; ordem: number;
  volumes: Saldo[]; ep: EstoqueParte | undefined; previsto: number; conjunto: number; pesoPrev: number; pesoRec: number;
};

export function Volumes({ saldos, est, varios, tipos, soFalta, mudar }: {
  saldos: Saldo[]; est: EstoqueParte[]; varios: boolean; tipos: string[]; soFalta: boolean; mudar: (k: string, v: string) => void;
}) {
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const partes = useMemo(() => {
    const porParte = new Map(est.map((x) => [`${x.linha}|${x.canteiro}|${x.tipo}|${x.parte}`, x]));
    const m = new Map<string, Parte>();
    for (const s of saldos) {
      const tipo = s.tipo ?? '—';
      const chave = `${s.linha}|${s.canteiro}|${tipo}|${s.parte}`;
      const p = m.get(chave) ?? { chave, linha: s.linha, canteiro: s.canteiro, tipo, parte: s.parte!, ordem: s.ordem, volumes: [], ep: porParte.get(chave),
        previsto: 0, conjunto: 0, pesoPrev: 0, pesoRec: 0 };
      p.volumes.push(s);
      p.ordem = Math.min(p.ordem, s.ordem);
      p.pesoPrev += n(s.previsto) * n(s.peso_unit);
      p.pesoRec += n(s.recebido) * n(s.peso_unit);
      m.set(chave, p);
    }
    for (const p of m.values()) {
      p.volumes.sort((a, b) => a.ordem - b.ordem);
      p.previsto = n(p.ep?.previsto ?? Math.min(...p.volumes.map((v) => n(v.previsto))));
      p.conjunto = n(p.ep?.conjunto);
    }
    return [...m.values()].sort((a, b) => a.linha.localeCompare(b.linha) || a.canteiro.localeCompare(b.canteiro) || a.tipo.localeCompare(b.tipo) || a.ordem - b.ordem);
  }, [saldos, est]);

  const contagem = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of partes) c.set(p.tipo, (c.get(p.tipo) ?? 0) + 1);
    return [...c];
  }, [partes]);
  const visiveis = partes.filter((p) => (!tipos.length || tipos.includes(p.tipo)) && (!soFalta || p.conjunto < p.previsto));
  const alternar = (k: string) => setAbertas((s) => { const x = new Set(s); if (x.has(k)) x.delete(k); else x.add(k); return x; });
  const pesoPrev = visiveis.reduce((s, p) => s + p.pesoPrev, 0);
  const pesoRec = visiveis.reduce((s, p) => s + p.pesoRec, 0);
  const colunas = 9 + (varios ? 1 : 0);

  return (
    <>
      <div className="toolbar">
        <div className="chips" role="group" aria-label="Tipos de torre">
          {contagem.map(([t, q]) => (
            <button key={t} className={`chip ${tipos.includes(t) ? 'on' : ''}`}
                    onClick={() => mudar('tipos', (tipos.includes(t) ? tipos.filter((x) => x !== t) : [...tipos, t]).join(','))}>{t}<span className="n">{q}</span></button>
          ))}
          {tipos.length > 0 && <button className="chip limpar" onClick={() => mudar('tipos', '')}>Limpar tipos</button>}
        </div>
        <span className="grow" />
        <label className="muted" style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={soFalta} onChange={(e) => mudar('falta', e.target.checked ? '1' : '')} /> Só partes incompletas
        </label>
        <button className="chip" onClick={() => setAbertas(abertas.size ? new Set() : new Set(visiveis.map((p) => p.chave)))}>
          {abertas.size ? 'Recolher volumes' : 'Abrir todos os volumes'}
        </button>
      </div>
      <section className="panel estoque-painel">
        <div className="tramo-h">
          <b>VOLUMES RECEBIDOS</b>
          <span className="muted num">{visiveis.length} partes · peso previsto {num(pesoPrev / 1000, 1)} t · recebido {num(pesoRec / 1000, 1)} t</span>
          <span className="grow" /><Porcentagem valor={pesoPrev ? pesoRec / pesoPrev : 0} />
        </div>
        <div className="estoque-tabela">
          <table className="est">
            <thead><tr>
              <th>Tipo</th><th className="esq">Parte</th><th>Previsto</th><th>Conjunto completo</th><th>Atendimento</th>
              <th className="g0">Torres atendidas</th><th>Próxima torre</th>
              <th className="g0">Peso previsto (t)</th><th>Peso recebido (t)</th>{varios && <th className="g0">Canteiro</th>}
            </tr></thead>
            <tbody>
              {visiveis.map((p, i) => {
                const ant = visiveis[i - 1];
                const divisa = ant && (ant.tipo !== p.tipo || ant.canteiro !== p.canteiro || ant.linha !== p.linha);
                const aberta = abertas.has(p.chave);
                const completo = p.conjunto >= p.previsto;
                return (
                  <Fragment key={p.chave}>
                    <tr className={`parte ${divisa ? 'divisa' : ''} ${aberta ? 'aberta' : ''}`} onClick={() => alternar(p.chave)}>
                      <td className="tipo">{p.tipo}</td>
                      <td className="esq"><span className="seta">{aberta ? '▾' : '▸'}</span>{p.parte}<span className="muted vol">{p.volumes.length} vol.</span></td>
                      <td>{num(p.previsto)}</td>
                      <td className={completo ? 'pint-ok' : p.conjunto === 0 ? 'pint-falta' : ''}><b>{num(p.conjunto)}</b></td>
                      <td><Porcentagem valor={p.previsto ? p.conjunto / p.previsto : 0} ok={completo} /></td>
                      <td className="g0">{p.ep?.torres ? <>{p.ep.atendidas} <span className="muted">de {p.ep.torres}</span></> : '—'}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {p.ep?.proxima_torre
                          ? <Link to={`/lista?q=${encodeURIComponent(p.ep.proxima_torre)}`} title={`Ver na Lista · seq. ${p.ep.proxima_seq ?? '—'}`}>{p.ep.proxima_torre}</Link>
                          : p.ep?.torres ? <span className="ok">todas</span> : '—'}
                      </td>
                      <td className="g0">{num(p.pesoPrev / 1000, 2)}</td>
                      <td>{num(p.pesoRec / 1000, 2)}</td>
                      {varios && <td className="g0 cant">{p.linha} · {p.canteiro}</td>}
                    </tr>
                    {aberta && (
                      <tr className="vols"><td colSpan={colunas}>
                        <table className="est-vol">
                          <thead><tr><th className="esq">Volume</th><th>Previsto</th><th>Recebido</th><th>Falta</th><th>Peso unit. (kg)</th><th>Peso recebido (kg)</th></tr></thead>
                          <tbody>{p.volumes.map((v) => {
                            const falta = Math.max(0, n(v.previsto) - n(v.recebido));
                            return (
                              <tr key={v.material_id}>
                                <td className="esq">{v.descricao}</td><td>{num(v.previsto)}</td><td>{num(v.recebido)}</td>
                                <td className={falta ? 'pint-falta' : 'vazio'}>{falta ? num(falta) : ''}</td>
                                <td>{num(v.peso_unit, 3)}</td><td>{num(n(v.recebido) * n(v.peso_unit), 1)}</td>
                              </tr>
                            );
                          })}</tbody>
                        </table>
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export function Fixadores({ fixadores, varios, soFalta, mudar }: { fixadores: Saldo[]; varios: boolean; soFalta: boolean; mudar: (k: string, v: string) => void }) {
  const lista = fixadores
    .filter((f) => !soFalta || n(f.recebido) < n(f.previsto))
    .sort((a, b) => a.linha.localeCompare(b.linha) || a.canteiro.localeCompare(b.canteiro) || a.ordem - b.ordem);
  return (
    <>
      <div className="toolbar">
        <span className="muted" style={{ fontSize: 13 }}>Previsto = coluna PREVISTO da ENTRADA (nos fixadores a granel já inclui os 5%). Peso dos fixadores ainda não importado.</span>
        <span className="grow" />
        <label className="muted" style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={soFalta} onChange={(e) => mudar('falta', e.target.checked ? '1' : '')} /> Só o que falta
        </label>
      </div>
      <section className="panel estoque-painel">
        <div className="tramo-h"><b>FIXADORES</b><span className="muted num">{lista.length} itens</span></div>
        <div className="estoque-tabela">
          <table className="est">
            <thead><tr>
              <th className="esq">Seção</th><th className="esq">Fixador</th><th>Previsto</th><th>Recebido</th><th>Saldo</th><th>Atendido</th>
              {varios && <th className="g0">Canteiro</th>}
            </tr></thead>
            <tbody>
              {lista.map((f, i) => {
                const ant = lista[i - 1];
                const divisa = ant && (ant.secao !== f.secao || ant.canteiro !== f.canteiro || ant.linha !== f.linha);
                const saldo = n(f.recebido) - n(f.previsto);
                return (
                  <tr key={`${f.linha_id}-${f.canteiro_id}-${f.material_id}`} className={divisa ? 'divisa' : ''}>
                    <td className="esq muted secao">{!ant || divisa ? f.secao.replace(/^FIXADORES\s*-?\s*/i, '') || 'Granel' : ''}</td>
                    <td className="esq"><b>{f.descricao}</b></td>
                    <td>{num(f.previsto)}</td><td>{num(f.recebido)}</td>
                    <td className={saldo < 0 ? 'pint-falta' : 'pint-ok'}>{num(saldo)}</td>
                    <td><Porcentagem valor={n(f.previsto) ? n(f.recebido) / n(f.previsto) : 0} ok={saldo >= 0} /></td>
                    {varios && <td className="g0 cant">{f.linha} · {f.canteiro}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
