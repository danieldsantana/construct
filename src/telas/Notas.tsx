import { useCallback, useMemo, useState } from 'react';
import { Abas, Titulo } from '../componentes/Titulo';
import { Gaveta } from '../componentes/Gaveta';
import { useEscopo } from '../lib/escopo';
import { colunaDaOrigem, data, num } from '../lib/formato';
import {
  useLancamentos, useNotasFiscais, useRecebimentos, useSaldos,
  type NotaFiscal, type Recebimento, type SituacaoNF,
} from '../dados/recebimento';

type Vista = 'lista' | 'planilha';
type Filtro = 'todas' | 'nao_recebida' | 'recebidas' | 'reposicao' | 'sem_controle' | 'outros';
type Linha =
  | { k: 'nf'; id: string; nf: NotaFiscal; quando: string }
  | { k: 'mov'; id: string; mov: Recebimento; quando: string };

export const SITUACAO: Record<SituacaoNF, [string, string, string]> = {
  nao_recebida: ['Não recebida', 'neutro', 'Emitida (PDF chegou por e-mail) e ainda não lançada no controle do canteiro de destino.'],
  em_conferencia: ['Em conferência', 'conf', 'Recebida, conferência em andamento.'],
  confirmada: ['Recebida', 'ok', 'Lançada no controle do canteiro.'],
  sem_controle: ['Sem controle importado', 'info', 'O controle do canteiro de destino ainda não está no banco: não dá para saber se foi recebida.'],
  reposicao: ['Reposição (SAC)', 'rnc', 'NF de reposição de SAC não lançada no controle de estruturas (os controles em geral não lançam reposições): acompanhar pela RNC.'],
};
const HOJE = new Date();
const dias = (iso: string | null) => (iso ? Math.floor((HOJE.getTime() - new Date(iso + 'T12:00:00').getTime()) / 86400000) : null);

// Notas fiscais: todas as emitidas (índice dos PDFs) e recebidas (controles), mais transferências e ajustes.
export function Notas() {
  const { inclui, escopo, canteiroUnico } = useEscopo();
  const nfs = useNotasFiscais();
  const rec = useRecebimentos();
  const [vista, setVista] = useState<Vista>('lista');
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [abertaNF, setAbertaNF] = useState<NotaFiscal | null>(null);
  const [abertoMov, setAbertoMov] = useState<Recebimento | null>(null);
  const fechar = useCallback(() => { setAbertaNF(null); setAbertoMov(null); }, []);

  // NF sem linha definida (reposição "ND"): entra se o canteiro estiver no escopo em qualquer linha
  const nfNoEscopo = useCallback((n: NotaFiscal) => {
    const c = n.canteiro_recebimento ?? n.destino ?? '';
    if (n.linha) return inclui(n.linha, c);
    return !escopo.canteiro ? inclui('T3', c) || inclui('T4', c) : c === escopo.canteiro;
  }, [inclui, escopo.canteiro]);

  const linhas = useMemo<Linha[]>(() => [
    ...nfs.dados.filter(nfNoEscopo).map((nf) => ({ k: 'nf' as const, id: `n${nf.id}`, nf, quando: nf.recebida_em ?? nf.emissao ?? '' })),
    ...rec.dados.filter((r) => r.tipo !== 'recebimento' && inclui(r.linha, r.canteiro))
      .map((mov) => ({ k: 'mov' as const, id: `m${mov.id}`, mov, quando: mov.data ?? '' })),
  ], [nfs.dados, rec.dados, nfNoEscopo, inclui]);

  const passa = (l: Linha, f: Filtro) => {
    if (f === 'todas') return true;
    if (f === 'outros') return l.k === 'mov';
    if (l.k !== 'nf') return false;
    const s = l.nf.situacao_exibida;
    return f === 'recebidas' ? s === 'confirmada' || s === 'em_conferencia' : s === f;
  };
  const visiveis = useMemo(() => linhas.filter((l) => passa(l, filtro)).sort((a, b) => b.quando.localeCompare(a.quando)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [linhas, filtro]);

  const carregando = nfs.carregando || rec.carregando;
  const erro = nfs.erro ?? rec.erro;
  if (carregando) return <><Titulo texto="Notas fiscais" /><p className="muted">Carregando…</p></>;
  if (erro) return <><Titulo texto="Notas fiscais" /><p className="warn">Não foi possível carregar: {erro}</p></>;

  const filtros: [Filtro, string][] = [['todas', 'Todas'], ['nao_recebida', 'Não recebidas'], ['recebidas', 'Recebidas'], ['reposicao', 'Reposições (SAC)'], ['sem_controle', 'Sem controle importado'], ['outros', 'Transferências e ajustes']];

  return (
    <>
      <Titulo texto="Notas fiscais"><span className="num">{visiveis.length}</span></Titulo>
      <Abas<Vista> abas={[['lista', 'Notas fiscais'], ['planilha', 'Planilha de entrada']]} atual={vista} aoMudar={setVista} />

      {vista === 'lista' ? (
        <>
          <div className="toolbar">
            <div className="chips">
              {filtros.filter(([k]) => k === 'todas' || linhas.some((l) => passa(l, k))).map(([k, t]) => (
                <button key={k} className={`chip ${filtro === k ? 'on' : ''}`} onClick={() => setFiltro(k)}>{t}<span className="n">{linhas.filter((l) => passa(l, k)).length}</span></button>
              ))}
            </div>
          </div>
          <div className="panel" style={{ overflow: 'auto', maxHeight: 'calc(100vh - 290px)' }}>
            <table>
              <thead><tr>
                <th>Situação</th><th>NF / documento</th><th>Emissão</th><th>Recebida em</th><th className="r">Dias</th><th>OF</th>
                <th>Destino (NF)</th><th>Canteiro</th><th className="r">Peso (kg)</th><th className="r">Itens</th><th>Observações</th>
              </tr></thead>
              <tbody>
                {visiveis.map((l) => l.k === 'nf' ? (
                  <tr key={l.id} className="clk" onClick={() => setAbertaNF(l.nf)}>
                    <td><span className={`st ${SITUACAO[l.nf.situacao_exibida][1]}`} title={SITUACAO[l.nf.situacao_exibida][2]}>{SITUACAO[l.nf.situacao_exibida][0]}</span></td>
                    <td className="num"><b>{l.nf.numero}</b></td>
                    <td className="num">{data(l.nf.emissao)}</td>
                    <td className="num">{data(l.nf.recebida_em)}</td>
                    <td className="r num">{l.nf.situacao_exibida === 'nao_recebida' ? <span className="warn">{dias(l.nf.emissao)}</span> : ''}</td>
                    <td>{l.nf.of_texto ?? '—'}</td>
                    <td>{l.nf.destino ?? '—'}</td>
                    <td>{l.nf.canteiro_recebimento ?? '—'}</td>
                    <td className="r num">{num(l.nf.peso, 1)}</td>
                    <td className="r num">{l.nf.itens || '—'}</td>
                    <td style={{ fontSize: 13 }}>{[
                      l.nf.rnc ? `RNC ${l.nf.rnc}` : '', l.nf.sac ? `SAC ${l.nf.sac}` : '',
                      !l.nf.arquivo ? 'sem PDF no índice' : '',
                      l.nf.destino && l.nf.canteiro_recebimento && l.nf.destino !== l.nf.canteiro_recebimento ? `recebida fora do destino` : '',
                      l.nf.recebimentos > 1 ? `${l.nf.recebimentos} lançamentos` : '',
                    ].filter(Boolean).join(' · ')}</td>
                  </tr>
                ) : (
                  <tr key={l.id} className="clk" onClick={() => setAbertoMov(l.mov)}>
                    <td>{l.mov.tipo === 'ajuste' ? <span className="st sf">Ajuste</span> : <span className="st info">Transferência</span>}</td>
                    <td className="num"><b>{l.mov.documento ?? '—'}</b></td>
                    <td className="num">—</td>
                    <td className="num">{data(l.mov.data)}</td>
                    <td />
                    <td>—</td>
                    <td>—</td>
                    <td>{l.mov.canteiro}</td>
                    <td className="r num">—</td>
                    <td className="r num">{l.mov.itens}</td>
                    <td style={{ fontSize: 13 }}>{l.mov.tipo === 'ajuste' ? 'quantidade lançada na coluna E da ENTRADA' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : canteiroUnico ? (
        <PlanilhaEntrada linha={canteiroUnico.linha} canteiro={canteiroUnico.canteiro} aoAbrir={setAbertoMov}
                         recebimentos={rec.dados.filter((r) => inclui(r.linha, r.canteiro))} />
      ) : (
        <div className="callout">A planilha de entrada é por canteiro, como no controle. Escolha uma linha e um canteiro na barra de escopo.</div>
      )}

      <FichaNF nf={abertaNF} recebimentos={rec.dados} aoFechar={fechar} />
      <FichaRecebimento r={abertoMov} aoFechar={fechar} />
    </>
  );
}

function PlanilhaEntrada({ linha, canteiro, recebimentos, aoAbrir }: { linha: string; canteiro: string; recebimentos: Recebimento[]; aoAbrir: (r: Recebimento) => void }) {
  const saldos = useSaldos();
  const lanc = useLancamentos();
  const [todas, setTodas] = useState(false);

  const colunas = useMemo(() => recebimentos.filter((r) => r.linha === linha && r.canteiro === canteiro)
    .sort((a, b) => colunaDaOrigem(a.origem) - colunaDaOrigem(b.origem)), [recebimentos, linha, canteiro]);
  const mostrar = todas ? colunas : colunas.slice(-25);
  const qtd = useMemo(() => {
    const ids = new Set(colunas.map((c) => c.id));
    const m = new Map<string, number>();
    for (const l of lanc.dados) if (ids.has(l.movimento_id)) m.set(`${l.material_id}|${l.movimento_id}`, Number(l.quantidade));
    return m;
  }, [lanc.dados, colunas]);
  const itens = useMemo(() => saldos.dados
    .filter((s) => s.linha === linha && s.canteiro === canteiro && (Number(s.previsto) !== 0 || Number(s.recebido) !== 0))
    .sort((a, b) => a.ordem - b.ordem), [saldos.dados, linha, canteiro]);

  if (saldos.carregando || lanc.carregando) return <p className="muted">Carregando…</p>;
  if (saldos.erro || lanc.erro) return <p className="warn">Não foi possível carregar: {saldos.erro ?? lanc.erro}</p>;
  if (!colunas.length) return <div className="callout">Nenhum recebimento importado para {linha} · {canteiro}.</div>;

  let secao = '';
  return (
    <>
      <div className="toolbar">
        <span className="muted">{mostrar.length} de {colunas.length} colunas, na ordem do controle · só itens com previsto ou recebimento · clique no número da NF para abrir</span>
        <button onClick={() => setTodas(!todas)}>{todas ? 'Só as 25 últimas' : 'Todas as colunas'}</button>
      </div>
      <div className="panel planilha" style={{ overflow: 'auto', maxHeight: 'calc(100vh - 300px)' }}>
        <table>
          <thead><tr>
            <th className="stk">Descrição</th><th className="r">Previsto</th><th className="r">Recebido</th>
            {mostrar.map((c) => (
              <th key={c.id} className="nfcol" title={`${c.of_texto ?? ''} · recebida ${data(c.data)}`} onClick={() => aoAbrir(c)}>
                <span>{c.numero ?? (c.tipo === 'ajuste' ? 'COL. E' : 'TRANSF.')}</span><small>{data(c.data, true)}</small>
              </th>
            ))}
          </tr></thead>
          <tbody>
            {itens.flatMap((s) => {
              const out = [];
              if (s.secao !== secao) {
                secao = s.secao;
                out.push(<tr key={`s${s.material_id}`} className="sec"><td colSpan={3 + mostrar.length}>{s.secao}</td></tr>);
              }
              const falta = Number(s.recebido) < Number(s.previsto);
              out.push(
                <tr key={s.material_id}>
                  <td className="stk">{s.descricao}</td>
                  <td className="r num prev">{num(s.previsto)}</td>
                  <td className={`r num rec ${falta ? 'warn' : ''}`}>{num(s.recebido)}</td>
                  {mostrar.map((c) => {
                    const v = qtd.get(`${s.material_id}|${c.id}`);
                    return <td key={c.id} className={`r num ${v !== undefined && v < 0 ? 'warn' : ''}`}>{v ? num(v) : ''}</td>;
                  })}
                </tr>,
              );
              return out;
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ItensDosMovimentos({ movimentos }: { movimentos: Recebimento[] }) {
  const saldos = useSaldos();
  const lanc = useLancamentos();
  const linhas = useMemo(() => {
    const mat = new Map(saldos.dados.map((s) => [`${s.linha_id}|${s.canteiro_id}|${s.material_id}`, s]));
    const ids = new Map(movimentos.map((m) => [m.id, m]));
    return lanc.dados.filter((l) => ids.has(l.movimento_id))
      .map((l) => ({ q: Number(l.quantidade), mov: ids.get(l.movimento_id)!, m: mat.get(`${l.linha_id}|${l.canteiro_id}|${l.material_id}`) }))
      .sort((a, b) => (a.m?.ordem ?? 0) - (b.m?.ordem ?? 0));
  }, [movimentos, saldos.dados, lanc.dados]);
  if (!movimentos.length) return <p className="muted" style={{ margin: 0 }}>Ainda não recebida: nenhum item lançado. Os itens do romaneio (lidos do PDF) entram numa próxima etapa.</p>;
  let secao = '';
  const varios = movimentos.length > 1;
  return (
    <table>
      <thead><tr><th>Item</th>{varios && <th>Canteiro / data</th>}<th className="r">Qtd</th></tr></thead>
      <tbody>
        {linhas.flatMap(({ q, m, mov }, i) => {
          const out = [];
          if (m && m.secao !== secao) { secao = m.secao; out.push(<tr key={`s${i}`} className="sec"><td colSpan={varios ? 3 : 2}>{m.secao}</td></tr>); }
          out.push(<tr key={i}><td>{m?.descricao ?? '?'}</td>{varios && <td>{mov.canteiro} · {data(mov.data, true)}</td>}<td className={`r num ${q < 0 ? 'warn' : ''}`}>{num(q)} {m?.unidade}</td></tr>);
          return out;
        })}
      </tbody>
    </table>
  );
}

function FichaNF({ nf, recebimentos, aoFechar }: { nf: NotaFiscal | null; recebimentos: Recebimento[]; aoFechar: () => void }) {
  const movs = useMemo(() => (nf ? recebimentos.filter((r) => r.nf_id === nf.id) : []), [nf, recebimentos]);
  const s = nf ? SITUACAO[nf.situacao_exibida] : null;
  return (
    <Gaveta aberta={!!nf} aoFechar={aoFechar} sub={nf ? `Nota fiscal · ${nf.linha ?? 'linha não definida'}` : ''} titulo={nf ? `NF ${nf.numero}` : ''}
            resumo={nf ? [['Situação', <span className={`st ${s![1]}`}>{s![0]}</span>], ['OF', nf.of_texto ?? '—'], ['Peso', nf.peso ? `${num(nf.peso, 1)} kg` : '—'], ['Itens', nf.itens || '—']] : []}>
      {nf && (
        <>
          <div className="passos">
            <div className="feito"><b>Emitida</b><span className="muted">{data(nf.emissao)}</span></div>
            <div className={nf.recebida_em ? 'feito' : 'atual'}><b>Recebida</b><span className="muted">{nf.recebida_em ? `${data(nf.recebida_em)} · ${nf.canteiro_recebimento}` : '—'}</span></div>
          </div>
          {nf.situacao_exibida === 'nao_recebida' && <div className="callout">Emitida há {dias(nf.emissao)} dias e ainda não lançada no controle de {nf.destino}.</div>}
          {nf.situacao_exibida === 'sem_controle' && <div className="callout">{SITUACAO.sem_controle[2]}</div>}
          {nf.destino && nf.canteiro_recebimento && nf.destino !== nf.canteiro_recebimento && <div className="callout">Destino na NF: {nf.destino}. Recebida em {nf.canteiro_recebimento}.</div>}
          <div className="fields">
            <div><span>Destino (NF)</span><b>{nf.destino ?? '—'}</b></div>
            <div><span>Romaneio</span><b>{nf.romaneio ?? '—'}</b></div>
            <div><span>Valor</span><b>{nf.valor ? `R$ ${num(nf.valor, 2)}` : '—'}</b></div>
            <div><span>SAC / RNC</span><b>{[nf.sac && `SAC ${nf.sac}`, nf.rnc && `RNC ${nf.rnc}`].filter(Boolean).join(' · ') || '—'}</b></div>
            <div style={{ gridColumn: '1 / -1' }}><span>Arquivo</span><b style={{ fontSize: 13 }}>{nf.arquivo ?? 'sem PDF no índice'}</b></div>
          </div>
          <h2>Itens recebidos</h2>
          <ItensDosMovimentos movimentos={movs} />
        </>
      )}
    </Gaveta>
  );
}

function FichaRecebimento({ r, aoFechar }: { r: Recebimento | null; aoFechar: () => void }) {
  return (
    <Gaveta aberta={!!r} aoFechar={aoFechar}
            sub={r ? `${r.tipo === 'transferencia' ? 'Transferência' : r.tipo === 'ajuste' ? 'Ajuste' : 'Recebimento'} · ${r.linha} · ${r.canteiro}` : ''}
            titulo={r ? (r.numero ? `NF ${r.numero}` : r.documento ?? '—') : ''}
            resumo={r ? [['Data', data(r.data)], ['OF', r.of_texto ?? '—'], ['Peso NF', r.peso ? `${num(r.peso, 1)} kg` : '—'], ['Itens', r.itens]] : []}>
      {r && (
        <>
          {r.tipo === 'ajuste' && <div className="callout">Quantidade digitada na coluna E da ENTRADA (a coluna dos rótulos), sem NF nem data. A planilha conta como recebida; confira a qual recebimento pertence.</div>}
          <ItensDosMovimentos movimentos={[r]} />
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Origem: {r.origem.replace('controle:', 'controle ').replace('#', ', coluna ')}</p>
        </>
      )}
    </Gaveta>
  );
}
