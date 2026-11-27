import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { Porcentagem, Titulo } from '../componentes/Titulo';
import { Gaveta } from '../componentes/Gaveta';
import { useEscopo } from '../lib/escopo';
import { data, num } from '../lib/formato';
import { SITUACAO } from './Notas';
import { atendimentoComponentes, ofCurta, useOFComponentes, useOFItens, useOFNFs, useOFs, type OF, type OFComponente, type OFItem, type OFNF } from '../dados/ofs';

const n = (v: number | string | null | undefined) => Number(v ?? 0);
const hoje = new Date().toISOString().slice(0, 10);

// OFs = resumo de OFs do cliente (só T3/T4) × NFs recebidas que citam a OF.
// Entra no escopo a OF cujo canteiro de entrega está no escopo, ou que tem NF entregue (ou a entregar) num canteiro do escopo
// — o local de entrega da NF prevalece sobre o canteiro previsto na OF.
export function OFs() {
  const ofs = useOFs();
  const itens = useOFItens();
  const comps = useOFComponentes();
  const compPorOF = useMemo(() => {
    const m = new Map<number, OFComponente[]>();
    for (const c of comps.dados) m.set(c.of_id, [...(m.get(c.of_id) ?? []), c]);
    return m;
  }, [comps.dados]);
  const nfs = useOFNFs();
  const { inclui } = useEscopo();
  const [params, setParams] = useSearchParams();
  const selId = Number(params.get('of')) || null;
  const abrir = (id: number | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set('of', String(id)); else p.delete('of');
    setParams(p, { replace: true });
  };

  const nfsPorOF = useMemo(() => {
    const m = new Map<number, OFNF[]>();
    for (const x of nfs.dados) m.set(x.of_id, [...(m.get(x.of_id) ?? []), x]);
    return m;
  }, [nfs.dados]);
  const doEscopo = useMemo(() => ofs.dados.filter((o) =>
    (o.canteiro && inclui(o.linha, o.canteiro)) ||
    (nfsPorOF.get(o.id) ?? []).some((x) => !!x.local_entrega && inclui(x.linha_local ?? o.linha, x.local_entrega))),
  [ofs.dados, nfsPorOF, inclui]);

  if (ofs.carregando || nfs.carregando) return <><Titulo texto="OFs" /><p className="muted">Carregando…</p></>;
  const erro = ofs.erro ?? nfs.erro;
  if (erro) return <><Titulo texto="OFs" /><p className="warn">Não foi possível carregar: {erro}</p></>;

  const prev = doEscopo.reduce((s, o) => s + n(o.peso_previsto), 0);
  const rec = doEscopo.reduce((s, o) => s + n(o.peso_recebido), 0);
  const naoRec = doEscopo.reduce((s, o) => s + n(o.nfs_nao_recebidas), 0);
  const semCtrl = doEscopo.reduce((s, o) => s + n(o.nfs_sem_controle), 0);
  const sel = selId ? ofs.dados.find((o) => o.id === selId) ?? null : null;

  return (
    <>
      <Titulo texto="OFs"><span className="num">{doEscopo.length} OFs · {num(prev / 1000, 1)} t</span></Titulo>
      {(naoRec > 0 || semCtrl > 0) && (
        <div className="callout">
          NFs emitidas destas OFs que não aparecem como recebidas: <b>{naoRec}</b> não recebida(s) no canteiro de destino
          {semCtrl > 0 && <> · <b>{semCtrl}</b> com destino em canteiro cujo controle ainda não foi importado</>}.
        </div>
      )}

      <section className="panel">
        <div className="tramo-h">
          <b>ATENDIMENTO POR PESO</b>
          <span className="muted num">previsto {num(prev / 1000, 1)} t · NFs recebidas {num(rec / 1000, 1)} t</span>
          <span className="grow" /><Porcentagem valor={prev ? rec / prev : 0} />
        </div>
        <div style={{ overflow: 'auto' }}>
          <table>
            <thead><tr>
              <th>OF</th><th>Linha</th><th>Canteiro de entrega</th><th>Emitida</th><th>Entrega prevista</th>
              <th className="r">Itens</th><th className="r">Peso OF (t)</th><th className="r">NFs emitidas</th><th className="r">Recebidas</th>
              <th className="r" title="Não recebidas + destino sem controle importado">Não recebidas</th><th className="r">Peso NFs rec. (t)</th><th>Atendido (peso)</th><th>Componentes</th>
            </tr></thead>
            <tbody>
              {doEscopo.map((o) => <Linha key={o.id} o={o} comp={atendimentoComponentes(compPorOF.get(o.id) ?? [])} sel={o.id === selId} abrir={() => abrir(o.id)} />)}
            </tbody>
          </table>
        </div>
        {doEscopo.length === 0 && <p className="muted" style={{ padding: 10 }}>Nenhuma OF neste escopo.</p>}
      </section>

      <FichaOF o={sel} comps={selId ? compPorOF.get(selId) ?? [] : []} itens={itens.dados.filter((i) => i.of_id === selId)} nfs={selId ? nfsPorOF.get(selId) ?? [] : []} aoFechar={() => abrir(null)} />
    </>
  );
}

export function Linha({ o, comp, sel, abrir }: { o: OF; comp: number; sel: boolean; abrir: () => void }) {
  const pct = n(o.peso_previsto) ? n(o.peso_recebido) / n(o.peso_previsto) : 0;
  const passou = !!o.entrega_prevista && o.entrega_prevista < hoje && pct < 1;
  return (
    <tr className="clk" onClick={abrir} style={sel ? { background: 'var(--orange-tint)' } : undefined}>
      <td><b>{ofCurta(o)}</b>{n(o.revisao) > 0 && <span className="muted"> rev {o.revisao}</span>}</td>
      <td>{o.linha}</td>
      <td>{o.canteiro ?? '—'}</td>
      <td className="num">{data(o.emitida_em)}</td>
      <td className="num">{o.entrega_prevista ? data(o.entrega_prevista) : o.entrega_texto ?? '—'}{passou && <> <span className="st falta" title="Entrega prevista já passou e o peso recebido não chegou a 100%">vencida</span></>}</td>
      <td className="r num">{o.itens}</td>
      <td className="r num prev">{num(n(o.peso_previsto) / 1000, 1)}</td>
      <td className="r num">{o.nfs || ''}</td>
      <td className="r num">{o.nfs_recebidas || ''}</td>
      <td className="r num">
        {n(o.nfs_nao_recebidas) > 0 && <span className="warn">{o.nfs_nao_recebidas}</span>}
        {n(o.nfs_sem_controle) > 0 && <span className="muted" title="destino em canteiro sem controle importado">{n(o.nfs_nao_recebidas) > 0 ? ' + ' : ''}{o.nfs_sem_controle}?</span>}
      </td>
      <td className="r num rec">{n(o.peso_recebido) ? num(n(o.peso_recebido) / 1000, 1) : ''}</td>
      <td><Porcentagem valor={pct} ok={pct >= 1} /></td>
      <td><Porcentagem valor={comp} ok={comp >= 1} /></td>
    </tr>
  );
}

export function FichaOF({ o, comps, itens, nfs, aoFechar }: { o: OF | null; comps: OFComponente[]; itens: OFItem[]; nfs: OFNF[]; aoFechar: () => void }) {
  const ent = new Map(comps.map((c) => [c.of_item_id, c]));
  const recebidas = nfs.filter((x) => x.situacao !== 'nao_recebida').sort((a, b) => (a.recebida_em ?? '').localeCompare(b.recebida_em ?? ''));
  const pendentes = nfs.filter((x) => x.situacao === 'nao_recebida').sort((a, b) => (a.emissao ?? '').localeCompare(b.emissao ?? ''));
  const porCanteiro = new Map<string, number>();
  for (const x of recebidas) { const k = x.canteiro_recebimento ?? '—'; porCanteiro.set(k, (porCanteiro.get(k) ?? 0) + n(x.peso)); }
  const tipos = [...new Set(itens.map((i) => i.tipo_torre))];
  return (
    <Gaveta aberta={!!o} aoFechar={aoFechar} sub={o ? `${o.linha} · entrega em ${o.canteiro ?? '—'}` : ''} titulo={o?.codigo ?? ''}
            resumo={o ? [
              ['Peso da OF', `${num(n(o.peso_previsto) / 1000, 1)} t`],
              ['Peso NFs recebidas', `${num(n(o.peso_recebido) / 1000, 1)} t`],
              ['Entrega prevista', o.entrega_prevista ? data(o.entrega_prevista) : o.entrega_texto ?? '—'],
              ['Última recebida', data(o.ultima_recebida)],
            ] : undefined}>
      {o && (
        <>
          <section>
            <h3 className="dr-t">Itens da OF</h3>
            <table>
              <thead><tr><th>Componente</th><th className="r">Qtd.</th><th className="r">Entregue</th><th className="r">Peso (kg)</th></tr></thead>
              <tbody>
                {tipos.flatMap((t) => [
                  <tr key={`t${t}`} className="sec"><td colSpan={4}>{t}</td></tr>,
                  ...itens.filter((i) => i.tipo_torre === t).map((i) => (
                    <tr key={i.id}><td>{i.descricao}</td><td className="r num">{num(i.quantidade)}</td><td className={`r num ${ent.get(i.id)?.componente ? (Number(ent.get(i.id)?.entregue ?? 0) >= Number(i.quantidade) ? 'ok-txt' : 'warn') : 'muted'}`}>{ent.get(i.id)?.componente ? num(ent.get(i.id)?.entregue ?? 0) : '—'}</td><td className="r num">{num(i.peso_kg, 1)}</td></tr>
                  )),
                ])}
              </tbody>
            </table>
          </section>
          <section>
            <h3 className="dr-t">NFs desta OF ({nfs.length})</h3>
            {nfs.length ? (
              <>
                {recebidas.length > 0 && (
                  <p className="muted" style={{ fontSize: 12.5, margin: '0 0 6px' }}>
                    Recebido por canteiro: {[...porCanteiro].map(([c, p]) => `${c} ${num(p / 1000, 1)} t`).join(' · ')}
                  </p>
                )}
                <table>
                  <thead><tr><th>NF</th><th>Emissão</th><th>Situação</th><th>Destino / recebida em</th><th className="r">Peso (kg)</th></tr></thead>
                  <tbody>
                    {[...recebidas, ...pendentes].map((x) => {
                      const s = SITUACAO[x.situacao_exibida];
                      const onde = x.canteiro_recebimento ?? x.destino;
                      return (
                        <tr key={x.nf_id}>
                          <td><b>{x.numero}</b>{(x.sac || x.rnc) && <span className="st rnc" style={{ marginLeft: 6 }} title={`SAC ${x.sac ?? '—'} · RNC ${x.rnc ?? '—'}`}>SAC</span>}</td>
                          <td className="num">{data(x.emissao)}</td>
                          <td><span className={`st ${s[1]}`} title={s[2]}>{s[0]}</span></td>
                          <td>{onde ?? '—'}{x.recebida_em && <span className="muted num"> · {data(x.recebida_em)}</span>}
                            {onde && o.canteiro && onde !== o.canteiro && <span className="st neutro" style={{ marginLeft: 6 }}>fora do canteiro da OF</span>}</td>
                          <td className="r num">{num(x.peso, 1)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            ) : <p className="muted">Nenhuma NF cita esta OF.</p>}
          </section>
        </>
      )}
    </Gaveta>
  );
}
