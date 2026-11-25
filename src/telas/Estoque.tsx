import { useMemo, useState, type MouseEvent } from 'react';
import { useSearchParams } from 'react-router';
import { Abas, Porcentagem, Titulo } from '../componentes/Titulo';
import { useEscopo } from '../lib/escopo';
import { num } from '../lib/formato';
import { useEstoqueParte, useSaldos, type EstoqueParte, type Saldo } from '../dados/recebimento';
import './Estoque.css';

type Aba = 'volumes' | 'fixadores';

// Destaque em cruz: a linha sob o mouse (CSS :hover) e a coluna (índice da célula, via data-col na tabela).
function useColunaSobMouse() {
  const [col, setCol] = useState<number | null>(null);
  const sobre = (e: MouseEvent<HTMLTableElement>) => {
    const td = (e.target as HTMLElement).closest('td');
    const tr = td?.parentElement;
    setCol(td && tr && !tr.classList.contains('faixa') && !tr.classList.contains('vols') && td.closest('table') === e.currentTarget ? td.cellIndex : null);
  };
  return { 'data-col': col ?? undefined, onMouseOver: sobre, onMouseLeave: () => setCol(null) };
}
const n = (v: number | string | null | undefined) => Number(v ?? 0);

// Estoque = VOLUMES RECEBIDOS (layout do controle) e fixadores, só do que tem previsto no escopo.
// Canteiro vem da barra de escopo do topo; com mais de um canteiro no escopo ("Todos"), mostra o Geral somado por linha.
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
  const canteiros = useMemo(() => [...new Map(doEscopo.map((s) => [`${s.linha}|${s.canteiro}`, s])).values()]
    .sort((a, b) => a.linha.localeCompare(b.linha) || a.canteiro_id - b.canteiro_id)
    .map((s) => ({ chave: `${s.linha}|${s.canteiro}`, linha: s.linha, canteiro: s.canteiro })), [doEscopo]);
  const variasLinhas = new Set(canteiros.map((c) => c.linha)).size > 1;
  const atual = canteiros.length > 1 ? 'geral' : canteiros[0]?.chave ?? '';

  // Geral: soma os canteiros da mesma linha (previsto, recebido e conjunto completo de cada canteiro)
  const { saldosVis, estVis } = useMemo(() => {
    if (atual !== 'geral') {
      return { saldosVis: doEscopo.filter((s) => `${s.linha}|${s.canteiro}` === atual), estVis: est.dados };
    }
    const m = new Map<string, Saldo>();
    for (const s of doEscopo) {
      const k = `${s.linha}|${s.secao}|${s.descricao}`;
      const a = m.get(k);
      if (a) m.set(k, { ...a, previsto: n(a.previsto) + n(s.previsto), recebido: n(a.recebido) + n(s.recebido), ordem: Math.min(a.ordem, s.ordem) });
      else m.set(k, { ...s, canteiro: 'Geral', canteiro_id: 0, previsto: n(s.previsto), recebido: n(s.recebido) });
    }
    const e = new Map<string, EstoqueParte>();
    for (const x of est.dados) {
      if (!canteiros.some((c) => c.linha === x.linha && c.canteiro === x.canteiro)) continue;
      const k = `${x.linha}|${x.tipo}|${x.parte}`;
      const a = e.get(k);
      if (a) e.set(k, { ...a, conjunto: n(a.conjunto) + n(x.conjunto), previsto: n(a.previsto) + n(x.previsto),
        torres: n(a.torres) + n(x.torres), atendidas: n(a.atendidas) + n(x.atendidas), proxima_torre: null, proxima_seq: null, ultima_atendida: null });
      else e.set(k, { ...x, canteiro: 'Geral', proxima_torre: null, proxima_seq: null, ultima_atendida: null });
    }
    return { saldosVis: [...m.values()], estVis: [...e.values()] };
  }, [atual, doEscopo, est.dados, canteiros]);

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
          ? <Volumes saldos={saldosVis.filter((s) => s.parte)} est={estVis} varios={atual === 'geral' && variasLinhas} tipos={tipos} soFalta={soFalta} mudar={mudar} />
          : <Fixadores fixadores={saldosVis.filter((s) => s.secao.startsWith('FIXADORES'))} varios={atual === 'geral' && variasLinhas} soFalta={soFalta} mudar={mudar} />}
    </div>
  );
}

// VOLUMES RECEBIDOS como no controle: por tipo, faixa "ESTRUTURA METÁLICA <tipo>" com os pesos; uma linha por volume
// (TORRE | PARTE - MATRIZ | PARTE | PREVISTO quant./peso unit./peso total | RECEBIDO quant./peso | CONJUNTO COMPLETO).
// Conjunto completo = o do estoque (o mesmo que pinta a Lista), mesclado por parte.
type Grupo = { chave: string; linha: string; canteiro: string; tipo: string; volumes: Saldo[] };

export function Volumes({ saldos, est, varios, tipos, soFalta, mudar }: {
  saldos: Saldo[]; est: EstoqueParte[]; varios: boolean; tipos: string[]; soFalta: boolean; mudar: (k: string, v: string) => void;
}) {
  const cruz = useColunaSobMouse();
  const [parteSob, setParteSob] = useState<string | null>(null);  // conjunto completo sob o mouse
  const porParte = useMemo(() => new Map(est.map((x) => [`${x.linha}|${x.canteiro}|${x.tipo}|${x.parte}`, x])), [est]);
  const grupos = useMemo(() => {
    const m = new Map<string, Grupo>();
    for (const s of saldos) {
      const tipo = s.tipo ?? '—';
      const chave = `${s.linha}|${s.canteiro}|${tipo}`;
      const g = m.get(chave) ?? { chave, linha: s.linha, canteiro: s.canteiro, tipo, volumes: [] };
      g.volumes.push(s);
      m.set(chave, g);
    }
    for (const g of m.values()) g.volumes.sort((a, b) => a.ordem - b.ordem);
    return [...m.values()].sort((a, b) => a.linha.localeCompare(b.linha) || a.canteiro.localeCompare(b.canteiro) || a.volumes[0].ordem - b.volumes[0].ordem);
  }, [saldos]);
  const contagem = useMemo(() => [...new Set(grupos.map((g) => g.tipo))], [grupos]);
  const cc = (g: Grupo, parte: string) => porParte.get(`${g.linha}|${g.canteiro}|${g.tipo}|${parte}`);
  const visiveis = grupos.filter((g) => !tipos.length || tipos.includes(g.tipo));
  const titulo = [...new Set(visiveis.map((g) => `${g.linha} · ${g.canteiro}`))].join(' + ');

  return (
    <>
      <div className="toolbar">
        <div className="chips" role="group" aria-label="Tipos de torre">
          {contagem.map((t) => (
            <button key={t} className={`chip ${tipos.includes(t) ? 'on' : ''}`}
                    onClick={() => mudar('tipos', (tipos.includes(t) ? tipos.filter((x) => x !== t) : [...tipos, t]).join(','))}>{t}</button>
          ))}
          {tipos.length > 0 && <button className="chip limpar" onClick={() => mudar('tipos', '')}>Limpar tipos</button>}
        </div>
        <span className="grow" />
        <label className="muted" style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={soFalta} onChange={(e) => mudar('falta', e.target.checked ? '1' : '')} /> Só partes incompletas
        </label>
      </div>
      <section className="panel estoque-painel">
        <div className="tramo-h"><b>RECEBIMENTO POR VOLUME</b><span className="muted">{titulo.toUpperCase()}</span></div>
        <div className="estoque-tabela">
          <table className="est vr cruz" {...cruz}>
            <thead>
              <tr>
                <th rowSpan={2}>Parte - matriz</th><th rowSpan={2}>Parte</th>
                <th colSpan={3} className="g0">Previsto</th><th colSpan={2} className="g0">Recebido</th><th rowSpan={2} className="g0">Conjunto completo</th>
              </tr>
              <tr className="sub"><th className="g0">Quant.</th><th>Peso unit.</th><th>Peso total</th><th className="g0">Quant.</th><th>Peso</th></tr>
            </thead>
            <tbody>
              {visiveis.flatMap((g) => {
                // partes na ordem do controle; com "só incompletas", some a parte cujo conjunto já cobre o previsto
                const partes: [string, Saldo[]][] = [];
                for (const v of g.volumes) {
                  const ult = partes[partes.length - 1];
                  if (ult && ult[0] === v.parte) ult[1].push(v); else partes.push([v.parte!, [v]]);
                }
                const mostrar = partes.filter(([parte, vs]) => !soFalta || n(cc(g, parte)?.conjunto) < n(cc(g, parte)?.previsto ?? vs[0].previsto));
                if (!mostrar.length) return [];
                const pesoPrev = g.volumes.reduce((s, v) => s + n(v.previsto) * n(v.peso_unit), 0);
                const pesoRec = g.volumes.reduce((s, v) => s + n(v.recebido) * n(v.peso_unit), 0);
                return [
                  <tr key={`h${g.chave}`} className="faixa">
                    <td colSpan={8}>
                      <div className="faixa-c">
                        <b>ESTRUTURA METÁLICA {g.tipo}</b>{varios && <span className="muted">{g.linha} · {g.canteiro}</span>}
                        <span className="grow" />
                        <span>Peso previsto <b>{num(pesoPrev, 2)}</b> kg</span>
                        <span>Peso recebido <b>{num(pesoRec, 2)}</b> kg</span>
                        <span className="pctx">{num(pesoPrev ? (pesoRec / pesoPrev) * 100 : 0)}%</span>
                      </div>
                    </td>
                  </tr>,
                  ...mostrar.flatMap(([parte, vs]) => {
                    const e = cc(g, parte);
                    const conj = n(e?.conjunto);
                                    const dica = e?.torres ? `Atende ${e.atendidas} de ${e.torres} torres na sequência de ataque` + (e.proxima_torre ? ` · próxima: ${e.proxima_torre} (seq. ${e.proxima_seq ?? '—'})` : '') : '';
                    return vs.map((v, i) => (
                      <tr key={v.material_id} className={`${i === 0 ? 'ini-parte' : ''} ${parteSob === `${g.chave}|${parte}` ? 'grupo-hl' : ''}`}>
                        <td className="esq">{v.descricao}</td>
                        <td className="esq parte">{parte}</td>
                        <td className="g0">{num(v.previsto)}</td><td>{num(v.peso_unit, 2)}</td><td>{num(n(v.previsto) * n(v.peso_unit), 2)}</td>
                        <td className={`g0 ${n(v.recebido) >= n(v.previsto) ? 'rec-ok' : n(v.recebido) > 0 ? 'rec-parc' : ''}`}>{n(v.recebido) ? num(v.recebido) : '-'}</td>
                        <td>{n(v.recebido) ? num(n(v.recebido) * n(v.peso_unit), 2) : '-'}</td>
                        {i === 0 && (
                          <td rowSpan={vs.length} className="g0 conj" title={dica} onMouseEnter={() => setParteSob(`${g.chave}|${parte}`)} onMouseLeave={() => setParteSob(null)}>{num(conj)}</td>
                        )}
                      </tr>
                    ));
                  }),
                ];
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export function Fixadores({ fixadores, varios, soFalta, mudar }: { fixadores: Saldo[]; varios: boolean; soFalta: boolean; mudar: (k: string, v: string) => void }) {
  const cruz = useColunaSobMouse();
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
          <table className="est cruz" {...cruz}>
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
