import { useCallback, useMemo, useState } from 'react';
import { Abas, Titulo } from '../componentes/Titulo';
import { Gaveta } from '../componentes/Gaveta';
import { useEscopo } from '../lib/escopo';
import { colunaDaOrigem, data, num } from '../lib/formato';
import { useLancamentos, useRecebimentos, useSaldos, type Recebimento } from '../dados/recebimento';

type Vista = 'lista' | 'planilha';
type Filtro = 'todos' | 'nf' | 'transf';

// Notas fiscais = cada recebimento da ENTRADA (uma coluna do controle).
export function Notas() {
  const { inclui, canteiroUnico } = useEscopo();
  const rec = useRecebimentos();
  const [vista, setVista] = useState<Vista>('lista');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [of, setOf] = useState('');
  const [aberto, setAberto] = useState<Recebimento | null>(null);
  const fechar = useCallback(() => setAberto(null), []);

  const doEscopo = useMemo(() => rec.dados.filter((r) => inclui(r.linha, r.canteiro)), [rec.dados, inclui]);
  const ofs = useMemo(() => [...new Set(doEscopo.map((r) => r.of_texto).filter(Boolean) as string[])].sort(), [doEscopo]);
  const visiveis = useMemo(() => doEscopo
    .filter((r) => (filtro === 'todos' || (filtro === 'nf' ? r.tipo === 'recebimento' : r.tipo === 'transferencia')) && (!of || r.of_texto === of))
    .sort((a, b) => b.data.localeCompare(a.data) || colunaDaOrigem(b.origem) - colunaDaOrigem(a.origem)), [doEscopo, filtro, of]);
  const variosCanteiros = new Set(doEscopo.map((r) => r.linha + r.canteiro)).size > 1;

  if (rec.carregando) return <><Titulo texto="Notas fiscais" /><p className="muted">Carregando…</p></>;
  if (rec.erro) return <><Titulo texto="Notas fiscais" /><p className="warn">Não foi possível carregar: {rec.erro}</p></>;

  const contagem = (f: Filtro) => doEscopo.filter((r) => f === 'todos' || (f === 'nf' ? r.tipo === 'recebimento' : r.tipo === 'transferencia')).length;

  return (
    <>
      <Titulo texto="Notas fiscais"><span className="num">{visiveis.length} recebimentos</span></Titulo>
      <Abas<Vista> abas={[['lista', 'Recebimentos'], ['planilha', 'Planilha de entrada']]} atual={vista} aoMudar={setVista} />
      {doEscopo.length === 0 && <div className="callout">Nenhum recebimento importado para este escopo. Por enquanto só os controles do T4 (Juazeiro e Laje dos Negros) estão no banco.</div>}

      {vista === 'lista' ? (
        <>
          <div className="toolbar">
            <div className="chips">
              {([['todos', 'Todos'], ['nf', 'Notas fiscais'], ['transf', 'Transferências']] as [Filtro, string][]).map(([k, t]) => (
                <button key={k} className={`chip ${filtro === k ? 'on' : ''}`} onClick={() => setFiltro(k)}>{t}<span className="n">{contagem(k)}</span></button>
              ))}
            </div>
            <span className="grow" />
            <div className="chips">
              <button className={`chip ${!of ? 'on' : ''}`} onClick={() => setOf('')}>Todas as OFs</button>
              {ofs.map((o) => <button key={o} className={`chip ${of === o ? 'on' : ''}`} onClick={() => setOf(o)}>{o}</button>)}
            </div>
          </div>
          <div className="panel" style={{ overflow: 'auto', maxHeight: 'calc(100vh - 290px)' }}>
            <table>
              <thead><tr>
                <th>Situação</th><th>NF / documento</th><th>Emissão</th><th>Recebida</th><th>OF</th><th>Romaneio</th>
                {variosCanteiros && <th>Canteiro</th>}<th className="r">Peso NF (kg)</th><th className="r">Valor (R$)</th><th className="r">Itens</th>
              </tr></thead>
              <tbody>
                {visiveis.map((r) => (
                  <tr key={r.id} className="clk" onClick={() => setAberto(r)}>
                    <td>{r.tipo === 'transferencia' ? <span className="st info">Transferência</span> : <span className="st ok">Recebida</span>}</td>
                    <td className="num"><b>{r.numero ?? r.documento ?? '—'}</b></td>
                    <td className="num">{data(r.emissao)}</td>
                    <td className="num">{data(r.data)}</td>
                    <td>{r.of_texto ?? '—'}</td>
                    <td className="num">{r.romaneio ?? '—'}</td>
                    {variosCanteiros && <td>{r.linha} · {r.canteiro}</td>}
                    <td className="r num">{num(r.peso, 1)}</td>
                    <td className="r num">{num(r.valor, 2)}</td>
                    <td className="r num">{r.itens}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : canteiroUnico ? (
        <PlanilhaEntrada linha={canteiroUnico.linha} canteiro={canteiroUnico.canteiro} aoAbrir={setAberto} recebimentos={doEscopo} />
      ) : (
        <div className="callout">A planilha de entrada é por canteiro, como no controle. Escolha uma linha e um canteiro na barra de escopo.</div>
      )}

      <FichaRecebimento r={aberto} aoFechar={fechar} />
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
  const linhas = useMemo(() => saldos.dados
    .filter((s) => s.linha === linha && s.canteiro === canteiro && (Number(s.previsto) !== 0 || Number(s.recebido) !== 0))
    .sort((a, b) => a.ordem - b.ordem), [saldos.dados, linha, canteiro]);

  if (saldos.carregando || lanc.carregando) return <p className="muted">Carregando…</p>;
  if (saldos.erro || lanc.erro) return <p className="warn">Não foi possível carregar: {saldos.erro ?? lanc.erro}</p>;

  let secao = '';
  return (
    <>
      <div className="toolbar">
        <span className="muted">{mostrar.length} de {colunas.length} colunas · só itens com previsto ou recebimento · clique no número da NF para abrir</span>
        <button onClick={() => setTodas(!todas)}>{todas ? 'Só as 25 mais recentes' : 'Todas as colunas'}</button>
      </div>
      <div className="panel planilha" style={{ overflow: 'auto', maxHeight: 'calc(100vh - 300px)' }}>
        <table>
          <thead><tr>
            <th className="stk">Descrição</th><th className="r">Previsto</th><th className="r">Recebido</th>
            {mostrar.map((c) => (
              <th key={c.id} className="nfcol" title={`${c.of_texto ?? ''} · recebida ${data(c.data)}`} onClick={() => aoAbrir(c)}>
                <span>{c.numero ?? 'TRANSF.'}</span><small>{data(c.data, true)}</small>
              </th>
            ))}
          </tr></thead>
          <tbody>
            {linhas.flatMap((s) => {
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

function FichaRecebimento({ r, aoFechar }: { r: Recebimento | null; aoFechar: () => void }) {
  const saldos = useSaldos();
  const lanc = useLancamentos();
  const itens = useMemo(() => {
    if (!r) return [];
    const mat = new Map(saldos.dados.filter((s) => s.linha_id === r.linha_id && s.canteiro_id === r.canteiro_id).map((s) => [s.material_id, s]));
    return lanc.dados.filter((l) => l.movimento_id === r.id)
      .map((l) => ({ q: Number(l.quantidade), m: mat.get(l.material_id) }))
      .sort((a, b) => (a.m?.ordem ?? 0) - (b.m?.ordem ?? 0));
  }, [r, saldos.dados, lanc.dados]);

  let secao = '';
  return (
    <Gaveta aberta={!!r} aoFechar={aoFechar}
            sub={r ? `${r.tipo === 'transferencia' ? 'Transferência' : 'Nota fiscal'} · ${r.linha} · ${r.canteiro}` : ''}
            titulo={r ? (r.numero ? `NF ${r.numero}` : r.documento ?? 'Transferência') : ''}
            resumo={r ? [['Recebida', data(r.data)], ['OF', r.of_texto ?? '—'], ['Peso', r.peso ? `${num(r.peso, 1)} kg` : '—'], ['Itens', r.itens]] : []}>
      {r && (
        <>
          <div className="fields">
            <div><span>Emissão</span><b>{data(r.emissao)}</b></div>
            <div><span>Romaneio</span><b>{r.romaneio ?? '—'}</b></div>
            <div><span>Fornecedor</span><b>{r.fornecedor ?? '—'}</b></div>
            <div><span>Valor</span><b>{r.valor ? `R$ ${num(r.valor, 2)}` : '—'}</b></div>
          </div>
          <h2>Itens recebidos</h2>
          <table>
            <thead><tr><th>Item</th><th className="r">Qtd</th></tr></thead>
            <tbody>
              {itens.flatMap(({ q, m }, i) => {
                const out = [];
                if (m && m.secao !== secao) { secao = m.secao; out.push(<tr key={`s${i}`} className="sec"><td colSpan={2}>{m.secao}</td></tr>); }
                out.push(<tr key={i}><td>{m?.descricao ?? '?'}</td><td className={`r num ${q < 0 ? 'warn' : ''}`}>{num(q)} {m?.unidade}</td></tr>);
                return out;
              })}
            </tbody>
          </table>
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Origem: {r.origem.replace('controle:', 'controle ').replace('#', ', coluna ')}</p>
        </>
      )}
    </Gaveta>
  );
}
