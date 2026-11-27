import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router';
import { Abas, Titulo } from '../componentes/Titulo';
import { Gaveta } from '../componentes/Gaveta';
import { FiltroColuna } from '../componentes/FiltroColuna';
import { AcoesNF, PendenciasNF } from './NotasFluxo';
import { ResumoSelecao, useTabelaCruz } from '../componentes/TabelaCruz';
import { useEscopo } from '../lib/escopo';
import { colunaDaOrigem, data, num } from '../lib/formato';
import {
  useLancamentos, useNFItens, useNotasFiscais, usePendencias, useRecebimentos, useSaldos,
  type NotaFiscal, type Recebimento, type SituacaoNF,
} from '../dados/recebimento';

type Vista = 'lista' | 'planilha';
const ofCurtaTxt = (t: string | null) => (t ? t.replace(/^OF-\d+-EM-BRM-/, 'OF-') : '—');
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
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
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
  // filtros de coluna (autofiltro): valor da célula de cada coluna filtrável
  type Col = 'situacao' | 'nf' | 'emissao' | 'recebida' | 'of' | 'destino' | 'canteiro';
  const valorCol = (l: Linha, c: Col): string => {
    if (l.k === 'nf') {
      if (c === 'situacao') return SITUACAO[l.nf.situacao_exibida][0];
      if (c === 'nf') return l.nf.numero;
      if (c === 'emissao') return data(l.nf.emissao) || '—';
      if (c === 'recebida') return data(l.nf.recebida_em) || '—';
      if (c === 'of') return ofCurtaTxt(l.nf.of_texto);
      if (c === 'destino') return l.nf.destino ?? '—';
      return l.nf.canteiro_recebimento ?? '—';
    }
    if (c === 'situacao') return l.mov.tipo === 'ajuste' ? 'Ajuste' : 'Transferência';
    if (c === 'nf') return l.mov.documento ?? '—';
    if (c === 'recebida') return data(l.mov.data) || '—';
    return c === 'canteiro' ? l.mov.canteiro : '—';
  };
  const ordemData = (a: string, b: string) => a.split('/').reverse().join('').localeCompare(b.split('/').reverse().join(''));
  const [filtrosCol, setFiltrosCol] = useState<Partial<Record<Col, Set<string> | null>>>({});
  const doChip = useMemo(() => linhas.filter((l) => passa(l, filtro)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [linhas, filtro]);
  // ordem padrão: situação (emitidas, em conferência, recebidas, outras) e, dentro dela, a NF mais recente (maior número) primeiro
  const grupo = (l: Linha) => (l.k !== 'nf' ? 3 : ({ nao_recebida: 0, em_conferencia: 1, confirmada: 2 } as Record<string, number>)[l.nf.situacao_exibida] ?? 3);
  const [ordenar, setOrdenar] = useState<{ c: Col; d: 'asc' | 'desc' } | null>(null);
  const visiveis = useMemo(() => doChip
    .filter((l) => (Object.entries(filtrosCol) as [Col, Set<string> | null][]).every(([c, sel]) => !sel || sel.has(valorCol(l, c))))
    .sort((a, b) => {
      if (ordenar) {
        const [x, y] = [valorCol(a, ordenar.c), valorCol(b, ordenar.c)];
        const v = (ordenar.c === 'emissao' || ordenar.c === 'recebida') ? ordemData(x, y) : x.localeCompare(y, 'pt-BR', { numeric: true });
        if (v) return ordenar.d === 'asc' ? v : -v;
      }
      return grupo(a) - grupo(b) || valorCol(b, 'nf').localeCompare(valorCol(a, 'nf'), 'pt-BR', { numeric: true });
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doChip, filtrosCol, ordenar]);
  const fc = (c: Col, titulo: string, ordem?: (a: string, b: string) => number) => (
    <FiltroColuna titulo={titulo} valores={doChip.map((l) => valorCol(l, c))} selecionados={filtrosCol[c] ?? null} ordem={ordem}
                  aoMudar={(sel) => setFiltrosCol((f) => ({ ...f, [c]: sel }))}
                  ordenacao={ordenar?.c === c ? ordenar.d : null} aoOrdenar={(d) => setOrdenar(d ? { c, d } : null)} />
  );

  const carregando = nfs.carregando || rec.carregando;
  const erro = nfs.erro ?? rec.erro;
  if (carregando) return <><Titulo texto="Notas fiscais" /><p className="muted">Carregando…</p></>;
  if (erro) return <><Titulo texto="Notas fiscais" /><p className="warn">Não foi possível carregar: {erro}</p></>;

  const filtros: [Filtro, string][] = [['todas', 'Todas'], ['nao_recebida', 'Emitidas (não recebidas)'], ['recebidas', 'Recebidas'], ['em_conferencia', 'Em conferência'], ['reposicao', 'Reposições (SAC)'], ['sem_controle', 'Sem controle importado'], ['outros', 'Transferências e ajustes']];

  const abas = <Abas<Vista> abas={[['lista', 'Notas fiscais'], ['planilha', 'Planilha de entrada']]} atual={vista} aoMudar={setVista} />;
  const controles = vista === 'lista' ? (
    <div className="chips">
      {filtros.filter(([k]) => k === 'todas' || linhas.some((l) => passa(l, k))).map(([k, t]) => (
        <button key={k} className={`chip ${filtro === k ? 'on' : ''}`} onClick={() => setFiltro(k)}>{t}<span className="n">{linhas.filter((l) => passa(l, k)).length}</span></button>
      ))}
    </div>
  ) : <div className="titulo-slot" ref={setSlot} />;
  return (
    <div className="notas-tela cheia">
      <Titulo texto="Notas fiscais" meio={<div className="titulo-abas">{abas}</div>}>{controles}</Titulo>

      {vista === 'lista' ? (
        <>
          <div className="panel conteudo">
            <table className="lista-nf">
              <thead><tr>
                <th>{fc('situacao', 'Situação')}</th>
                <th>{fc('nf', 'NF / documento')}</th>
                <th>{fc('emissao', 'Emissão', ordemData)}</th><th>{fc('recebida', 'Recebida em', ordemData)}</th><th className="r">Dias</th><th>{fc('of', 'OF')}</th>
                <th>{fc('destino', 'Destino (NF)')}</th><th>{fc('canteiro', 'Canteiro')}</th><th className="r">Peso (kg)</th><th className="r">Itens</th><th>RNC / SAC</th>
              </tr></thead>
              <tbody>
                {visiveis.map((l) => l.k === 'nf' ? (
                  <tr key={l.id} className="clk" onClick={() => setAbertaNF(l.nf)}>
                    <td><span className={`st ${SITUACAO[l.nf.situacao_exibida][1]}`} title={SITUACAO[l.nf.situacao_exibida][2]}>{SITUACAO[l.nf.situacao_exibida][0]}</span></td>
                    <td className="num"><b>{l.nf.numero}</b></td>
                    <td className="num">{data(l.nf.emissao)}</td>
                    <td className="num">{data(l.nf.recebida_em)}</td>
                    <td className="r num">{l.nf.situacao_exibida === 'nao_recebida' ? <span className="warn">{dias(l.nf.emissao)}</span> : ''}</td>
                    <td>{ofCurtaTxt(l.nf.of_texto)}</td>
                    <td>{l.nf.destino ?? '—'}</td>
                    <td className={l.nf.destino && l.nf.canteiro_recebimento && l.nf.destino !== l.nf.canteiro_recebimento ? 'warn' : ''}>{l.nf.canteiro_recebimento ?? '—'}</td>
                    <td className="r num">{num(l.nf.peso, 1)}</td>
                    <td className="r num">{l.nf.itens || '—'}</td>
                    <td className="obs">{[l.nf.rnc ? `RNC ${l.nf.rnc}` : '', l.nf.sac ? `SAC ${l.nf.sac}` : ''].filter(Boolean).join(' · ')}</td>
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
                    <td className="obs" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <PlanilhaEntrada slot={slot} pares={paresEscopo} aoAbrir={setAbertoMov} aoAbrirNF={(id) => setAbertaNF(nfs.dados.find((x) => x.id === id) ?? null)}
                         recebimentos={rec.dados.filter((r) => inclui(r.linha, r.canteiro))} />
      )}

      <FichaNF nf={abertaNF} recebimentos={rec.dados} aoFechar={fechar} />
      <FichaRecebimento r={abertoMov} aoFechar={fechar} />
    </div>
  );
}

// Planilha de entrada como a aba ENTRADA do controle: cabeçalho completo por coluna (data de recebimento, fornecedor, NF,
// emissão, romaneio, valor, peso, OF) e uma coluna por recebimento. Com vários canteiros no escopo, uma linha a mais no
// cabeçalho diz o canteiro de recebimento de cada coluna, e previsto/recebido são a soma dos canteiros.
function PlanilhaEntrada({ slot, pares, recebimentos, aoAbrir, aoAbrirNF }: {
  slot: HTMLElement | null;
  pares: { linha: string; canteiro: string }[]; recebimentos: Recebimento[]; aoAbrir: (r: Recebimento) => void; aoAbrirNF: (nfId: number) => void;
}) {
  const saldos = useSaldos();
  const lanc = useLancamentos();
  const cruz = useTabelaCruz();  // cruz do mouse + seleção (clique, arrastar, Ctrl), como no Estoque
  const [soRecebidos, setSoRecebidos] = useState(false);
  const tabRef = cruz.ref;
  // congela como no Excel: as linhas do cabeçalho presas no topo e as 3 primeiras colunas presas à esquerda
  useLayoutEffect(() => {
    const t = tabRef.current;
    if (!t?.tHead) return;
    let top = 0;
    for (const tr of t.tHead.rows) {
      for (const c of tr.cells) { c.style.position = 'sticky'; c.style.top = `${top}px`; c.style.zIndex = '2'; }
      top += tr.offsetHeight;
    }
    const tit = t.tHead.rows[t.tHead.rows.length - 1];
    const w = [0, 1, 2].map((i) => tit.cells[i]?.offsetWidth ?? 0);
    const esq = [0, w[0], w[0] + w[1]];
    const ocupado: number[][] = [];  // colunas tomadas por rowSpan de linhas anteriores
    [...t.rows].forEach((tr, r) => {
      let col = 0;
      for (const c of tr.cells) {
        while (ocupado[r]?.includes(col)) col++;
        const ini = col;
        for (let k = 1; k < c.rowSpan; k++) for (let x = 0; x < c.colSpan; x++) (ocupado[r + k] ??= []).push(ini + x);
        col += c.colSpan;
        if (ini >= 3 || col > 3) continue;
        c.style.position = 'sticky'; c.style.left = `${esq[ini]}px`;
        c.style.zIndex = tr.parentElement === t.tHead ? '4' : '1';
        if (col === 3) c.classList.add('ult-cong');
      }
    });
  });
  const variasLinhas = new Set(pares.map((p) => p.linha)).size > 1;
  const pos = (l: string, c: string) => pares.findIndex((p) => p.linha === l && p.canteiro === c);

  const colunas = useMemo(() => recebimentos.filter((r) => pos(r.linha, r.canteiro) >= 0)
    // um canteiro: ordem do controle; vários: ordem de recebimento (data), sem separar por canteiro
    .sort((a, b) => (pares.length > 1 ? (a.data ?? '9999').localeCompare(b.data ?? '9999') : 0)
      || pos(a.linha, a.canteiro) - pos(b.linha, b.canteiro) || colunaDaOrigem(a.origem) - colunaDaOrigem(b.origem)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recebimentos, pares]);
  // SEM limite: todos os recebimentos do escopo aparecem (nada pode ser omitido — auditoria)
  const mostrar = colunas;
  const qtd = useMemo(() => {
    const ids = new Set(colunas.map((c) => c.id));
    const m = new Map<string, number>();
    for (const l of lanc.dados) if (ids.has(l.movimento_id)) m.set(`${l.material_id}|${l.movimento_id}`, Number(l.quantidade));
    return m;
  }, [lanc.dados, colunas]);
  const itens = useMemo(() => {
    const m = new Map<number, { material_id: number; secao: string; descricao: string; parte: string | null; unidade: string; ordem: number; previsto: number; recebido: number }>();
    for (const s of saldos.dados) {
      if (pos(s.linha, s.canteiro) < 0 || (Number(s.previsto) === 0 && Number(s.recebido) === 0)) continue;
      const a = m.get(s.material_id) ?? { material_id: s.material_id, secao: s.secao, descricao: s.descricao, parte: s.parte, unidade: s.unidade, ordem: s.ordem, previsto: 0, recebido: 0 };
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
    ['Nota fiscal', (c) => (
      <button className={`nfnum ${c.tipo !== 'recebimento' ? 'transf' : ''}`} onClick={() => (c.nf_id ? aoAbrirNF(c.nf_id) : aoAbrir(c))}>
        {c.tipo === 'recebimento' ? doc(c) : c.tipo === 'ajuste' ? 'Ajuste' : `Transf. ${(c.documento ?? '').replace(/^TRANSFER[ÊE]NCIA\s*/i, '')}`.trim()}
      </button>
    )],
    ['Recebimento', (c) => data(c.data)],
    ['Emissão', (c) => (c.emissao ? data(c.emissao) : '')],
    ['Remessa', (c) => c.romaneio ?? ''],
  ];
  const linhasItens = soRecebidos ? itens.filter((i) => i.recebido !== 0) : itens;
  let secao = '';
  let parteAnt: string | null = null;
  return (
    <>
      {slot && createPortal(
        <>
          <ResumoSelecao refSpan={cruz.resumoRef} />
          <label className="chk"><input type="checkbox" checked={soRecebidos} onChange={(e) => setSoRecebidos(e.target.checked)} /> Só itens recebidos</label>
        </>, slot)}
      <div className="panel planilha conteudo">
        <table ref={tabRef} className="cruz" onMouseDown={cruz.onMouseDown} onMouseOver={cruz.onMouseOver} onMouseLeave={cruz.onMouseLeave}>
          <thead>
            {cab.map(([rot, f], i) => (
              <tr key={rot} className={`cab ${rot === 'Nota fiscal' ? 'cab-nf' : ''}`}>
                <th className="rot" colSpan={3}>{rot}</th>
                {mostrar.map((c) => <td key={c.id} className={`cabv ${i === cab.length - 1 ? 'ult' : ''}`}>{f(c)}</td>)}
              </tr>
            ))}
            <tr className="tit">
              <th>Descrição</th><th className="r">Previsto</th><th className="r">Recebido</th>
              {mostrar.map((c) => <th key={c.id} className="colv">{variasLinhas ? `${c.linha} · ${c.canteiro}` : c.canteiro}</th>)}
            </tr>
          </thead>
          <tbody>
            {linhasItens.flatMap((s) => {
              const out = [];
              if (s.secao !== secao) {
                secao = s.secao;
                parteAnt = null;
                out.push(<tr key={`s${s.material_id}`} className="sec faixa"><td>{s.secao}</td><td /><td />{mostrar.length > 0 && <td colSpan={mostrar.length} />}</tr>);
              }
              const falta = s.recebido < s.previsto;
              const iniParte = parteAnt !== null && s.parte !== parteAnt;  // linha mais escura entre componentes
              parteAnt = s.parte;
              out.push(
                <tr key={s.material_id} data-k={s.material_id} className={iniParte ? 'ini-parte' : ''}>
                  <td className="desc">{s.descricao}</td>
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
  if (!movimentos.length) return <p className="muted" style={{ margin: 0 }}>Nenhum item lançado.</p>;
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

type AbaNF = 'itens' | 'pendencias';
function FichaNF({ nf, recebimentos, aoFechar }: { nf: NotaFiscal | null; recebimentos: Recebimento[]; aoFechar: () => void }) {
  const movs = useMemo(() => (nf ? recebimentos.filter((r) => r.nf_id === nf.id) : []), [nf, recebimentos]);
  const nfItens = useNFItens();
  const pend = usePendencias();
  const [aba, setAba] = useState<AbaNF>('itens');
  useEffect(() => { setAba('itens'); }, [nf?.id]);
  const s = nf ? SITUACAO[nf.situacao_exibida] : null;
  const temItensNF = !!nf && nfItens.dados.some((i) => i.nota_fiscal_id === nf.id);
  const nPend = nf ? pend.dados.filter((p) => p.nota_fiscal_id === nf.id).length : 0;
  const fora = !!nf?.destino && !!nf?.canteiro_recebimento && nf.destino !== nf.canteiro_recebimento;
  return (
    <Gaveta larga aberta={!!nf} aoFechar={aoFechar} sub={nf ? ['Nota fiscal', nf.linha].filter(Boolean).join(' · ') : ''} titulo={nf ? `NF ${nf.numero}` : ''}
            resumo={nf ? [
              ['Situação', <span className={`st ${s![1]}`}>{s![0]}</span>],
              ['Emissão', data(nf.emissao) || '—'],
              ['Recebida', nf.recebida_em ? <>{data(nf.recebida_em)} · <span className={fora ? 'warn' : ''}>{nf.canteiro_recebimento}</span></> : '—'],
              ['Destino', nf.destino ?? '—'],
              ['OF', nf.of_texto ? nf.of_texto.replace(/^OF-\d+-EM-BRM-/, 'OF-') : '—'],
              ['Remessa', nf.romaneio ?? '—'],
              ['Valor', nf.valor ? `R$ ${num(nf.valor, 2)}` : '—'],
              ['Peso', nf.peso ? `${num(nf.peso, 1)} kg` : '—'],
              ...(nf.sac || nf.rnc ? [['SAC / RNC', [nf.sac && `SAC ${nf.sac}`, nf.rnc && `RNC ${nf.rnc}`].filter(Boolean).join(' · ')] as [string, ReactNode]] : []),
            ] : []}>
      {nf && (
        <>
          <div className="ficha-abas">
            <Abas<AbaNF> abas={[['itens', `Itens (${nf.itens || 0})`], ['pendencias', `Pendências (${nPend})`]]} atual={aba} aoMudar={setAba} />
          </div>
          {aba === 'itens' && (temItensNF ? <AcoesNF nf={nf} /> : <ItensDosMovimentos movimentos={movs} />)}
          {aba === 'pendencias' && <PendenciasNF nf={nf} />}
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
        </>
      )}
    </Gaveta>
  );
}

