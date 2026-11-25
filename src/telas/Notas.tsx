import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Abas, Titulo } from '../componentes/Titulo';
import { Gaveta } from '../componentes/Gaveta';
import { AcoesNF, LancarNF } from './NotasFluxo';
import { useEditor } from '../lib/sessao';
import { useEscopo } from '../lib/escopo';
import { colunaDaOrigem, data, num } from '../lib/formato';
import {
  useConferenciaNF, useLancamentos, useLeituraRomaneio, useNotasFiscais, useRecebimentos, useSaldos,
  type NotaFiscal, type Recebimento, type SituacaoNF,
} from '../dados/recebimento';

type Vista = 'lista' | 'planilha' | 'lancar';
type Filtro = 'todas' | 'nao_recebida' | 'recebidas' | 'em_conferencia' | 'reposicao' | 'sem_controle' | 'outros';
const FILTROS: Filtro[] = ['todas', 'nao_recebida', 'recebidas', 'em_conferencia', 'reposicao', 'sem_controle', 'outros'];
type Linha =
  | { k: 'nf'; id: string; nf: NotaFiscal; quando: string }
  | { k: 'mov'; id: string; mov: Recebimento; quando: string };

export const SITUACAO: Record<SituacaoNF, [string, string, string]> = {
  nao_recebida: ['Emitida', 'neutro', 'Emitida e ainda não recebida no canteiro de destino.'],
  em_conferencia: ['Em conferência', 'conf', 'Recebida, conferência em andamento.'],
  confirmada: ['Recebida', 'ok', 'Lançada no controle do canteiro.'],
  sem_controle: ['Sem controle importado', 'info', 'O controle do canteiro de destino ainda não está no banco: não dá para saber se foi recebida.'],
  reposicao: ['Reposição (SAC)', 'rnc', 'NF de reposição de SAC não lançada no controle de estruturas (os controles em geral não lançam reposições): acompanhar pela RNC.'],
};
const HOJE = new Date();
const dias = (iso: string | null) => (iso ? Math.floor((HOJE.getTime() - new Date(iso + 'T12:00:00').getTime()) / 86400000) : null);

// Notas fiscais: todas as emitidas (índice dos PDFs) e recebidas (controles), mais transferências e ajustes.
export function Notas() {
  const { inclui, escopo } = useEscopo();
  const nfs = useNotasFiscais();
  const rec = useRecebimentos();
  const [vista, setVista] = useState<Vista>('lista');
  const editor = useEditor();
  const [params] = useSearchParams();  // ?filtro=nao_recebida&nf=<id> (links da tela Início)
  const [filtro, setFiltro] = useState<Filtro>(() => {
    const f = params.get('filtro') as Filtro | null;
    return f && FILTROS.includes(f) ? f : 'todas';
  });
  const [abertaNF, setAbertaNF] = useState<NotaFiscal | null>(null);
  const nfParam = Number(params.get('nf')) || null;
  useEffect(() => {
    if (nfParam && nfs.dados.length) setAbertaNF(nfs.dados.find((n) => n.id === nfParam) ?? null);
  }, [nfParam, nfs.dados]);
  const [abertoMov, setAbertoMov] = useState<Recebimento | null>(null);
  const fechar = useCallback(() => { setAbertaNF(null); setAbertoMov(null); }, []);

  // Local de entrega prevalece: canteiro onde foi (ou será) entregue + linha do controle desse canteiro.
  // Sem linha conhecida (reposição "ND" sem controle no destino): entra se o canteiro estiver no escopo em qualquer linha.
  const nfNoEscopo = useCallback((n: NotaFiscal) => {
    const c = n.local_entrega ?? '';
    if (n.linha_local) return inclui(n.linha_local, c);
    return !escopo.canteiro ? inclui('T3', c) || inclui('T4', c) : c === escopo.canteiro;
  }, [inclui, escopo.canteiro]);

  const linhas = useMemo<Linha[]>(() => [
    ...nfs.dados.filter(nfNoEscopo).map((nf) => ({ k: 'nf' as const, id: `n${nf.id}`, nf, quando: nf.recebida_em ?? nf.emissao ?? '' })),
    ...rec.dados.filter((r) => r.tipo !== 'recebimento' && inclui(r.linha, r.canteiro))
      .map((mov) => ({ k: 'mov' as const, id: `m${mov.id}`, mov, quando: mov.data ?? '' })),
  ], [nfs.dados, rec.dados, nfNoEscopo, inclui]);

  const paresEscopo = useMemo(() => {
    const vistos = new Map<string, { linha: string; canteiro: string; id: number }>();
    for (const r of rec.dados) {
      if (!inclui(r.linha, r.canteiro)) continue;
      const k = `${r.linha}|${r.canteiro}`;
      if (!vistos.has(k)) vistos.set(k, { linha: r.linha, canteiro: r.canteiro, id: r.canteiro_id });
    }
    return [...vistos.values()].sort((a, b) => a.linha.localeCompare(b.linha) || a.id - b.id).map(({ linha, canteiro }) => ({ linha, canteiro }));
  }, [rec.dados, inclui]);

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

  const filtros: [Filtro, string][] = [['todas', 'Todas'], ['nao_recebida', 'Emitidas (não recebidas)'], ['recebidas', 'Recebidas'], ['em_conferencia', 'Em conferência'], ['reposicao', 'Reposições (SAC)'], ['sem_controle', 'Sem controle importado'], ['outros', 'Transferências e ajustes']];

  return (
    <>
      <Titulo texto="Notas fiscais"><span className="num">{visiveis.length}</span></Titulo>
      <Abas<Vista> abas={[['lista', 'Notas fiscais'], ['planilha', 'Planilha de entrada'], ...(editor ? [['lancar', 'Lançar NF'] as [Vista, string]] : [])]} atual={vista} aoMudar={setVista} />

      {vista === 'lancar' ? <LancarNF /> : vista === 'lista' ? (
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
      ) : (
        <PlanilhaEntrada pares={paresEscopo} aoAbrir={setAbertoMov} aoAbrirNF={(id) => setAbertaNF(nfs.dados.find((x) => x.id === id) ?? null)}
                         recebimentos={rec.dados.filter((r) => inclui(r.linha, r.canteiro))} />
      )}

      <FichaNF nf={abertaNF} recebimentos={rec.dados} aoFechar={fechar} />
      <FichaRecebimento r={abertoMov} aoFechar={fechar} />
    </>
  );
}

// Planilha de entrada como a aba ENTRADA do controle: cabeçalho completo por coluna (data de recebimento, fornecedor, NF,
// emissão, romaneio, valor, peso, OF) e uma coluna por recebimento. Com vários canteiros no escopo, uma linha a mais no
// cabeçalho diz o canteiro de recebimento de cada coluna, e previsto/recebido são a soma dos canteiros.
function PlanilhaEntrada({ pares, recebimentos, aoAbrir, aoAbrirNF }: {
  pares: { linha: string; canteiro: string }[]; recebimentos: Recebimento[]; aoAbrir: (r: Recebimento) => void; aoAbrirNF: (nfId: number) => void;
}) {
  const saldos = useSaldos();
  const lanc = useLancamentos();
  const [todas, setTodas] = useState(false);
  const varios = pares.length > 1;
  const variasLinhas = new Set(pares.map((p) => p.linha)).size > 1;
  const pos = (l: string, c: string) => pares.findIndex((p) => p.linha === l && p.canteiro === c);

  const colunas = useMemo(() => recebimentos.filter((r) => pos(r.linha, r.canteiro) >= 0)
    .sort((a, b) => pos(a.linha, a.canteiro) - pos(b.linha, b.canteiro) || colunaDaOrigem(a.origem) - colunaDaOrigem(b.origem)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recebimentos, pares]);
  const mostrar = todas ? colunas : colunas.slice(-25);
  const qtd = useMemo(() => {
    const ids = new Set(colunas.map((c) => c.id));
    const m = new Map<string, number>();
    for (const l of lanc.dados) if (ids.has(l.movimento_id)) m.set(`${l.material_id}|${l.movimento_id}`, Number(l.quantidade));
    return m;
  }, [lanc.dados, colunas]);
  const itens = useMemo(() => {
    const m = new Map<number, { material_id: number; secao: string; descricao: string; unidade: string; ordem: number; previsto: number; recebido: number }>();
    for (const s of saldos.dados) {
      if (pos(s.linha, s.canteiro) < 0 || (Number(s.previsto) === 0 && Number(s.recebido) === 0)) continue;
      const a = m.get(s.material_id) ?? { material_id: s.material_id, secao: s.secao, descricao: s.descricao, unidade: s.unidade, ordem: s.ordem, previsto: 0, recebido: 0 };
      a.previsto += Number(s.previsto); a.recebido += Number(s.recebido);
      m.set(s.material_id, a);
    }
    return [...m.values()].sort((a, b) => a.ordem - b.ordem);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saldos.dados, pares]);

  if (saldos.carregando || lanc.carregando) return <p className="muted">Carregando…</p>;
  if (saldos.erro || lanc.erro) return <p className="warn">Não foi possível carregar: {saldos.erro ?? lanc.erro}</p>;
  if (!colunas.length) return <div className="callout">Nenhum recebimento lançado neste escopo.</div>;

  const doc = (c: Recebimento) => c.numero ?? (c.tipo === 'ajuste' ? 'Ajuste' : c.documento ?? 'Transferência');
  const cab: [string, (c: Recebimento) => ReactNode][] = [
    ...(varios ? [['Canteiro', (c: Recebimento) => (variasLinhas ? `${c.linha} · ${c.canteiro}` : c.canteiro)] as [string, (c: Recebimento) => ReactNode]] : []),
    ['Data de recebimento', (c) => data(c.data)],
    ['Nota fiscal', (c) => <button className="link" onClick={() => (c.nf_id ? aoAbrirNF(c.nf_id) : aoAbrir(c))}>{doc(c)}</button>],
    ['Data de emissão', (c) => data(c.emissao)],
    ['Romaneio', (c) => c.romaneio ?? ''],
  ];
  let secao = '';
  return (
    <>
      <div className="toolbar">
        <span className="muted">{mostrar.length} de {colunas.length} colunas, na ordem do controle{varios ? ', canteiro a canteiro' : ''} · só itens com previsto ou recebimento</span>
        <button onClick={() => setTodas(!todas)}>{todas ? 'Só as 25 últimas' : 'Todas as colunas'}</button>
      </div>
      <div className="panel planilha" style={{ overflow: 'auto', maxHeight: 'calc(100vh - 300px)' }}>
        <table>
          <thead>
            {cab.map(([rot, f], i) => (
              <tr key={rot} className={`cab ${rot === 'Canteiro' ? 'cab-cant' : ''}`}>
                <th className="stk rot">{rot}</th><th /><th />
                {mostrar.map((c, j) => {
                  const nova = varios && rot === 'Canteiro' && (j === 0 || mostrar[j - 1].canteiro !== c.canteiro || mostrar[j - 1].linha !== c.linha);
                  return <td key={c.id} className={`cabv ${i === cab.length - 1 ? 'ult' : ''} ${nova ? 'nova' : ''}`}>{f(c)}</td>;
                })}
              </tr>
            ))}
            <tr className="tit">
              <th className="stk">Descrição</th><th className="r">Previsto</th><th className="r">Recebido</th>
              {mostrar.map((c) => <th key={c.id} className="nfcol" title={`${doc(c)} · ${c.canteiro}`} onClick={() => aoAbrir(c)}>{c.tipo === 'recebimento' ? 'NF' : c.tipo === 'ajuste' ? 'AJ.' : 'TR.'}</th>)}
            </tr>
          </thead>
          <tbody>
            {itens.flatMap((s) => {
              const out = [];
              if (s.secao !== secao) {
                secao = s.secao;
                out.push(<tr key={`s${s.material_id}`} className="sec"><td colSpan={3 + mostrar.length}>{s.secao}</td></tr>);
              }
              const falta = s.recebido < s.previsto;
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
          {nf.situacao_exibida === 'nao_recebida' && <div className="callout">Emitida há {dias(nf.emissao)} dias e ainda não recebida em {nf.destino ?? 'destino não informado'}.</div>}
          {nf.situacao_exibida === 'sem_controle' && <div className="callout">{SITUACAO.sem_controle[2]}</div>}
          {nf.destino && nf.canteiro_recebimento && nf.destino !== nf.canteiro_recebimento && <div className="callout">Destino na NF: {nf.destino}. Recebida em {nf.canteiro_recebimento}.</div>}
          <div className="fields">
            <div><span>Destino (NF)</span><b>{nf.destino ?? '—'}</b></div>
            <div><span>Romaneio</span><b>{nf.romaneio ?? '—'}</b></div>
            <div><span>Valor</span><b>{nf.valor ? `R$ ${num(nf.valor, 2)}` : '—'}</b></div>
            <div><span>SAC / RNC</span><b>{[nf.sac && `SAC ${nf.sac}`, nf.rnc && `RNC ${nf.rnc}`].filter(Boolean).join(' · ') || '—'}</b></div>
            <div style={{ gridColumn: '1 / -1' }}><span>Arquivo</span><b style={{ fontSize: 13 }}>{nf.arquivo ?? 'sem PDF no índice'}</b></div>
          </div>
          <AcoesNF nf={nf} />
          <RomaneioXLancado nfId={nf.id} recebida={!!nf.recebida_em} />
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

// Romaneio do PDF (SKU → volume da matriz) × o que foi lançado para a NF (ENTRADA do controle ou lançamento do app).
function RomaneioXLancado({ nfId, recebida }: { nfId: number; recebida: boolean }) {
  const conf = useConferenciaNF();
  const leitura = useLeituraRomaneio();
  const l = leitura.dados.find((x) => x.id === nfId);
  const linhas = conf.dados.filter((c) => c.nota_fiscal_id === nfId).sort((a, b) => (a.volume ?? '~').localeCompare(b.volume ?? '~'));
  if (conf.carregando || leitura.carregando) return null;
  if (!l || l.romaneio_confere === null) return <p className="muted" style={{ fontSize: 13 }}>Romaneio: PDF não lido.</p>;
  if (!l.romaneio_confere) return <p className="muted" style={{ fontSize: 13 }}>Romaneio do PDF não conferido ({l.romaneio_obs}); sem comparação.</p>;
  const difs = linhas.filter((c) => Number(c.qtd_romaneio) !== Number(c.qtd_lancada));
  return (
    <>
      <h2>Romaneio × lançado</h2>
      {!recebida
        ? <p className="muted" style={{ fontSize: 13 }}>Romaneio lido e conferido com o peso{l.peso_danfe ? ` do DANFE (${num(l.peso_danfe, 1)} kg)` : ''}; a NF ainda não foi lançada.</p>
        : <div className={difs.length ? 'callout' : 'notes'}>{difs.length ? `${difs.length} volume(s) com diferença entre o romaneio e o lançado.` : 'Lançado igual ao romaneio em todos os volumes.'}</div>}
      <table>
        <thead><tr><th>Volume (matriz)</th><th className="r">Romaneio</th><th className="r">Lançado</th></tr></thead>
        <tbody>{linhas.map((c, i) => {
          const dif = Number(c.qtd_romaneio) !== Number(c.qtd_lancada);
          return (
            <tr key={i}>
              <td>{c.volume ?? <span className="muted">sem ligação com a matriz</span>}</td>
              <td className={`r num ${dif ? 'warn' : ''}`}>{num(c.qtd_romaneio)}</td>
              <td className={`r num ${dif ? 'warn' : ''}`}>{num(c.qtd_lancada)}</td>
            </tr>
          );
        })}</tbody>
      </table>
      <p className="muted" style={{ fontSize: 12 }}>Só volumes de estrutura; fixadores avulsos e peças (POS) ainda sem de-para. "Sem ligação": volume cuja numeração/peso no controle não bate com a matriz.</p>
    </>
  );
}
