import { useMemo, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { Porcentagem, Titulo } from '../componentes/Titulo';
import { useEscopo } from '../lib/escopo';
import { data, num } from '../lib/formato';
import { useEstoqueParte, useNotasFiscais, useSaldos, type NotaFiscal } from '../dados/recebimento';
import { ofCurta, useOFs, useOFNFs } from '../dados/ofs';
import { useTabelaAuto } from '../dados/inicio';

const n = (v: number | string | null | undefined) => Number(v ?? 0);
const HOJE = new Date();
const dias = (iso: string | null) => (iso ? Math.floor((HOJE.getTime() - new Date(iso + 'T12:00:00').getTime()) / 86400000) : null);

// Início: junta o que hoje está espalhado em TABELAS, VOLUMES RECEBIDOS, RESUMO DE FIXADORES e na pasta de NFs,
// sempre no escopo escolhido acima. Cada linha leva ao detalhe. Nada calculado além de somas e porcentagens.
export function Inicio() {
  const { inclui, escopo } = useEscopo();
  const ir = useNavigate();
  const nfs = useNotasFiscais();
  const tabelas = useTabelaAuto();
  const partes = useEstoqueParte();
  const saldos = useSaldos();
  const ofs = useOFs();
  const ofNfs = useOFNFs();

  // NF: local de entrega prevalece (mesma regra da tela Notas)
  const nfNoEscopo = (x: NotaFiscal) => {
    const c = x.local_entrega ?? '';
    if (x.linha_local) return inclui(x.linha_local, c);
    return !escopo.canteiro ? inclui('T3', c) || inclui('T4', c) : c === escopo.canteiro;
  };
  const doEscopo = useMemo(() => nfs.dados.filter(nfNoEscopo),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nfs.dados, inclui, escopo.canteiro]);
  const naoRec = doEscopo.filter((x) => x.situacao_exibida === 'nao_recebida').sort((a, b) => (a.emissao ?? '').localeCompare(b.emissao ?? ''));
  const emConf = doEscopo.filter((x) => x.situacao_exibida === 'em_conferencia').sort((a, b) => (b.recebida_em ?? '').localeCompare(a.recebida_em ?? ''));

  const tab = useMemo(() => {
    const m = new Map<string, { prev: number; comp: number }>();
    for (const t of tabelas.dados) {
      if (!inclui(t.linha, t.canteiro)) continue;
      const a = m.get(t.tipo) ?? { prev: 0, comp: 0 };
      a.prev += n(t.previsto); a.comp += n(t.completas);
      m.set(t.tipo, a);
    }
    return [...m].sort((a, b) => b[1].prev - a[1].prev);
  }, [tabelas.dados, inclui]);
  const totPrev = tab.reduce((s, [, a]) => s + a.prev, 0);
  const totComp = tab.reduce((s, [, a]) => s + a.comp, 0);

  const limita = useMemo(() => partes.dados
    .filter((p) => inclui(p.linha, p.canteiro) && n(p.conjunto) < n(p.previsto))
    .sort((a, b) => n(a.conjunto) / n(a.previsto) - n(b.conjunto) / n(b.previsto) || n(b.previsto) - n(a.previsto)),
  [partes.dados, inclui]);

  const fixadores = useMemo(() => saldos.dados
    .filter((s) => s.secao.startsWith('FIXADORES') && n(s.previsto) > 0 && inclui(s.linha, s.canteiro))
    .map((s) => ({ s, pct: n(s.recebido) / n(s.previsto) }))
    .sort((a, b) => a.pct - b.pct), [saldos.dados, inclui]);

  const ofsEscopo = useMemo(() => {
    const comNF = new Set(ofNfs.dados.filter((x) => x.local_entrega && inclui(x.linha_local ?? '', x.local_entrega)).map((x) => x.of_id));
    return ofs.dados.filter((o) => (o.canteiro && inclui(o.linha, o.canteiro)) || comNF.has(o.id))
      .map((o) => ({ o, pct: n(o.peso_previsto) ? n(o.peso_recebido) / n(o.peso_previsto) : 0 }))
      .sort((a, b) => a.pct - b.pct);
  }, [ofs.dados, ofNfs.dados, inclui]);

  const carregando = nfs.carregando || tabelas.carregando || partes.carregando || saldos.carregando || ofs.carregando || ofNfs.carregando;
  const erro = nfs.erro ?? tabelas.erro ?? partes.erro ?? saldos.erro ?? ofs.erro ?? ofNfs.erro;
  if (carregando) return <><Titulo texto="Início" /><p className="muted">Carregando…</p></>;
  if (erro) return <><Titulo texto="Início" /><p className="warn">Não foi possível carregar: {erro}</p></>;

  const li = (chave: string | number, a: ReactNode, b: ReactNode, para?: string) => (
    <li key={chave} onClick={para ? () => ir(para) : undefined} style={para ? undefined : { cursor: 'default' }}><span>{a}</span><span className="muted num">{b}</span></li>
  );
  const nada = <li className="muted" style={{ cursor: 'default' }}>Nenhuma</li>;

  return (
    <>
      <Titulo texto="Início" />
      <div className="notes">
        Junta o que hoje está espalhado em TABELAS, VOLUMES RECEBIDOS, RESUMO DE FIXADORES e na pasta de NFs, sempre no escopo escolhido acima.
        Cada linha leva ao detalhe.
      </div>
      <div className="today">
        <div className="card">
          <div className="card-h"><span className="big">{naoRec.length}</span><b>NFs emitidas e não recebidas</b></div>
          <ul>{naoRec.slice(0, 7).map((x) => li(x.id, <>NF {x.numero} · emitida {data(x.emissao)} · {x.local_entrega ?? '—'}</>,
            <span className="warn">{dias(x.emissao)} dias</span>, `/notas?filtro=nao_recebida&nf=${x.id}`)) }{naoRec.length === 0 && nada}</ul>
          <div className="foot"><Link to="/notas?filtro=nao_recebida">Ver todas</Link> <span className="muted">· origem: PDFs recebidos por e-mail × controles</span></div>
        </div>

        <div className="card">
          <div className="card-h"><span className="big">{emConf.length}</span><b>Recebidas, em conferência</b></div>
          <ul>{emConf.slice(0, 7).map((x) => li(x.id, <>NF {x.numero} · {x.of_texto ? ofTxt(x.of_texto) : '—'} · {x.local_entrega}</>,
            `recebida ${data(x.recebida_em)}`, `/notas?filtro=em_conferencia&nf=${x.id}`))}{emConf.length === 0 && nada}</ul>
          <div className="foot"><Link to="/notas?filtro=em_conferencia">Abrir</Link> <span className="muted">· lançadas aqui, ainda sem confirmação</span></div>
        </div>

        <div className="card">
          <div className="card-h"><span className="big">{totComp}</span><b>de {totPrev} torres com estrutura e fixadores completos</b></div>
          <table>
            <thead><tr><th>Tipo</th><th className="r">Previsto</th><th className="r">Completas</th><th>%</th></tr></thead>
            <tbody>{tab.map(([t, a]) => (
              <tr key={t}><td>{t}</td><td className="r num">{a.prev}</td><td className="r num">{a.comp}</td><td><Porcentagem valor={a.prev ? a.comp / a.prev : 0} ok={a.comp >= a.prev} /></td></tr>
            ))}</tbody>
          </table>
          <div className="foot"><Link to="/mapa">Ver mapa de estruturas</Link> <span className="muted">· status automático pela Lista (fixadores ainda não entram)</span></div>
        </div>

        <div className="card">
          <div className="card-h"><b>Atendimento das OFs</b></div>
          <table>
            <thead><tr><th>OF</th><th>Canteiro</th><th>Peso</th><th>Componentes</th></tr></thead>
            <tbody>{ofsEscopo.map(({ o, pct }) => (
              <tr key={o.id} className="clk" onClick={() => ir(`/ofs?of=${o.id}`)}>
                <td><b>{ofCurta(o)}</b></td><td>{o.canteiro ?? '—'}</td><td><Porcentagem valor={pct} ok={pct >= 1} /></td>
                <td className="muted" style={{ fontSize: 12 }}>a definir</td>
              </tr>
            ))}</tbody>
          </table>
          <div className="foot"><Link to="/ofs">Ver OFs</Link> <span className="muted">· peso das NFs recebidas ÷ peso da OF</span></div>
        </div>

        <div className="card">
          <div className="card-h"><span className="big">{limita.length}</span><b>Partes que mais limitam</b></div>
          <ul>{limita.slice(0, 7).map((p, i) => li(i, <>{p.tipo} · {p.parte} <span className="muted">· {p.canteiro}</span></>,
            `${num(p.conjunto)} de ${num(p.previsto)}`, '/estoque'))}{limita.length === 0 && nada}</ul>
          <div className="foot"><span className="muted">conjunto completo do estoque (inclui lançamentos feitos aqui)</span></div>
        </div>

        <div className="card">
          <div className="card-h"><b>Fixadores com menor atendimento</b></div>
          <ul>{fixadores.slice(0, 7).map(({ s, pct }) => li(`${s.linha_id}-${s.canteiro_id}-${s.material_id}`,
            <>{s.descricao} <span className="muted">· {s.canteiro}</span></>, `${num(pct * 100)}%`, '/estoque'))}{fixadores.length === 0 && nada}</ul>
          <div className="foot"><span className="muted">recebido ÷ previsto da ENTRADA · origem: controles</span></div>
        </div>
      </div>
    </>
  );
}

// 'OF-71607-EM-BRM-114' -> 'OF-114'
function ofTxt(t: string) {
  const m = /BRM-(\d+)/.exec(t);
  return m ? `OF-${m[1]}` : t;
}
