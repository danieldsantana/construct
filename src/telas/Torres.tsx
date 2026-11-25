import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { COMPOSICAO, formatarMetros, statusDaTorre, useLinhas, useStatusAuto, useTorreComponentes, useTorres, type ClasseStatus, type Torre, type TorreComponente } from '../dados/torres';
import { useEscopo } from '../lib/escopo';
import { num } from '../lib/formato';
import { Titulo } from '../componentes/Titulo';
import { Gaveta } from '../componentes/Gaveta';
import './Torres.css';

export type Aba = 'lista' | 'mapa';

// Lista e Mapa = abas LISTA e MAPA ESTRUTURA de cada controle (status digitado, composição e sequência de ataque) sobre a LC.
// São dois menus separados (como no controle); filtros, busca e ficha são os mesmos.
// Nada é calculado aqui: o status é o do controle. Linha e canteiro vêm do escopo; o resto fica na URL.
export function Torres({ aba }: { aba: Aba }) {
  const base = useTorres();
  const auto = useStatusAuto();
  // status automático (a LISTA manda); o digitado no controle fica em status_controle só para comparação
  const torres = useMemo(() => {
    const m = new Map(auto.dados.map((a) => [a.torre_id, a.status]));
    return base.torres.map((t) => ({ ...t, status_controle: t.status, status: t.status === null ? null : m.get(t.id) ?? 'Faltante' }));
  }, [base.torres, auto.dados]);
  const carregando = base.carregando || auto.carregando;
  const erro = base.erro ?? auto.erro;
  const pintura = useTorreComponentes();
  const cores = useMemo(() => new Map(pintura.dados.map((p) => [`${p.torre_id}|${p.chave}`, p])), [pintura.dados]);
  const linhasCad = useLinhas();
  const { inclui } = useEscopo();
  const [params, setParams] = useSearchParams();
  const tipos = (params.get('tipos') ?? '').split(',').filter(Boolean);
  const busca = params.get('q') ?? '';
  const tramo = params.get('tramo') ?? '';
  const st = params.get('st') ?? '';
  const ordem = params.get('ordem') === 'seq' ? 'seq' : 'torre';
  const vistaMapa = params.get('vista') === 'tramo' ? 'tramo' : 'continuo';
  const selId = Number(params.get('torre')) || null;

  function mudar(chave: string, valor: string) {
    const p = new URLSearchParams(params);
    if (valor) p.set(chave, valor); else p.delete(chave);
    setParams(p, { replace: true });
  }
  const alternarTipo = (tipo: string) =>
    mudar('tipos', (tipos.includes(tipo) ? tipos.filter((t) => t !== tipo) : [...tipos, tipo]).join(','));

  const doRecorte = useMemo(() => torres.filter((t) => t.canteiro && inclui(t.linha_sigla, t.canteiro)), [torres, inclui]);
  const contagemTipos = useMemo(() => contar(doRecorte, (t) => t.tipo).sort((a, b) => b[1] - a[1]), [doRecorte]);
  const contagemStatus = useMemo(() => contar(doRecorte, (t) => statusDaTorre(t).texto), [doRecorte]);
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return doRecorte.filter((t) =>
      (tipos.length === 0 || tipos.includes(t.tipo)) &&
      (!st || statusDaTorre(t).texto === st) &&
      (!q || t.numero.startsWith(q)) &&
      (!tramo || `${t.linha_sigla}-${t.tramo}` === tramo));
  }, [doRecorte, tipos, st, busca, tramo]);
  const sel = selId ? torres.find((t) => t.id === selId) ?? null : null;
  // linha inteira no escopo (todos os canteiros dela) -> cabeçalho "LISTA COMPLETA <código>"
  const completas = useMemo(() => {
    const todos = new Map<string, Set<string>>(), noEscopo = new Map<string, Set<string>>();
    for (const t of torres) if (t.canteiro) todos.set(t.linha_sigla, (todos.get(t.linha_sigla) ?? new Set()).add(t.canteiro));
    for (const t of doRecorte) if (t.canteiro) noEscopo.set(t.linha_sigla, (noEscopo.get(t.linha_sigla) ?? new Set()).add(t.canteiro));
    const codigo = new Map(linhasCad.dados.map((l) => [l.sigla, l.codigo]));
    const m = new Map<string, string>();
    for (const [l, cs] of noEscopo) if (cs.size === todos.get(l)?.size) m.set(l, codigo.get(l) ?? l);
    return m;
  }, [torres, doRecorte, linhasCad.dados]);

  const titulo = aba === 'lista' ? 'Lista' : 'Mapa de estruturas';
  if (carregando) return <><Titulo texto={titulo} /><p className="muted">Carregando torres…</p></>;
  if (erro) return <><Titulo texto={titulo} /><p className="warn">Não foi possível carregar as torres: {erro}</p></>;

  const semControle = doRecorte.filter((t) => t.status === null).length;

  return (
    <div className={`torres ${aba === 'lista' ? 'cheia' : ''}`}>
      <Titulo texto={titulo}><span className="num">{visiveis.length} de {doRecorte.length} torres</span></Titulo>

      <div className="toolbar">
        <input type="search" aria-label="Buscar torre" placeholder="Buscar torre (ex. 8/2)" value={busca}
               onChange={(e) => mudar('q', e.target.value)} />
        <div className="chips" role="group" aria-label="Status no controle">
          {contagemStatus.map(([s, n]) => (
            <button key={s} className={`chip ${st === s ? 'on' : ''}`} onClick={() => mudar('st', st === s ? '' : s)}>
              <i className={`b ${classeDoTexto(s, doRecorte)}`} />{s}<span className="n">{n}</span>
            </button>
          ))}
        </div>
        <span className="grow" />
        {aba === 'mapa' && (
          <div className="seg" role="group" aria-label="Visualização do mapa">
            <button className={vistaMapa === 'continuo' ? 'on' : ''} onClick={() => mudar('vista', '')}>Contínuo</button>
            <button className={vistaMapa === 'tramo' ? 'on' : ''} onClick={() => mudar('vista', 'tramo')}>Por tramo</button>
          </div>
        )}
        {aba === 'lista' && (
          <div className="seg" role="group" aria-label="Ordem">
            <button className={ordem === 'torre' ? 'on' : ''} onClick={() => mudar('ordem', '')}>Ordem da linha</button>
            <button className={ordem === 'seq' ? 'on' : ''} onClick={() => mudar('ordem', 'seq')}>Sequência de ataque</button>
          </div>
        )}
      </div>

      <div className="chips torres-tipos" role="group" aria-label="Tipos de torre">
        {contagemTipos.map(([t, n]) => (
          <button key={t} className={`chip ${tipos.includes(t) ? 'on' : ''}`} onClick={() => alternarTipo(t)}>{t}<span className="n">{n}</span></button>
        ))}
        {tipos.length > 0 && <button className="chip limpar" onClick={() => mudar('tipos', '')}>Limpar tipos</button>}
        {tramo && <button className="chip limpar" onClick={() => mudar('tramo', '')}>Tramo {tramo.split('-')[1]} de {tramo.split('-')[0]} ✕</button>}
      </div>

      {semControle > 0 && (
        <div className="callout">{semControle} torre(s) deste escopo sem status: o controle do canteiro ainda não foi importado.</div>
      )}

      {aba === 'lista'
        ? <Lista torres={visiveis} cores={cores} completas={completas} ordem={ordem} selId={selId} abrir={(id) => mudar('torre', String(id))} escolherTramo={(t) => mudar('tramo', `${t.linha_sigla}-${t.tramo}`)} />
        : vistaMapa === 'continuo'
          ? <MapaContinuo torres={visiveis} selId={selId} abrir={(id) => mudar('torre', String(id))} />
          : <Mapa torres={visiveis} selId={selId} abrir={(id) => mudar('torre', String(id))} />}

      <FichaTorre t={sel} cores={cores} aoFechar={() => mudar('torre', '')} />
    </div>
  );
}

function contar(ts: Torre[], f: (t: Torre) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const t of ts) m.set(f(t), (m.get(f(t)) ?? 0) + 1);
  return [...m];
}

function classeDoTexto(texto: string, ts: Torre[]): ClasseStatus {
  const t = ts.find((x) => statusDaTorre(x).texto === texto);
  return t ? statusDaTorre(t).classe : 'sem';
}

const CLASSE_PILL: Record<ClasseStatus, string> = { ok: 'ok', falta: 'falta', sf: 'sf', sem: 'neutro' };
function Status({ t }: { t: Torre }) {
  const s = statusDaTorre(t);
  return <span className={`st ${CLASSE_PILL[s.classe]}`}>{s.texto}</span>;
}

function valorComp(t: Torre, chave: string, metros?: boolean) {
  const v = t.composicao?.[chave];
  if (v === undefined || v === null) return '';
  return metros ? formatarMetros(v) : num(v);
}

// Uma tabela só (como a aba LISTA), com todos os canteiros do escopo em sequência; na divisa entre canteiros, uma
// linha levemente mais escura. Só mostra o grupo de composição (AUTOPORTANTE/ESTAIADA) que existe no recorte.
export function Lista({ torres, cores, completas, ordem, selId, abrir, escolherTramo }: {
  torres: Torre[]; cores: Map<string, TorreComponente>; completas: Map<string, string>; ordem: 'torre' | 'seq'; selId: number | null; abrir: (id: number) => void; escolherTramo: (t: Torre) => void;
}) {
  const grupos = useMemo(() => {
    const m = new Map<string, Torre[]>();
    for (const t of torres) { const k = `${t.linha_sigla} · ${t.canteiro}`; m.set(k, [...(m.get(k) ?? []), t]); }
    if (ordem === 'seq') for (const g of m.values()) g.sort((a, b) => (a.sequencia ?? 1e9) - (b.sequencia ?? 1e9) || a.ordem - b.ordem);
    return [...m];
  }, [torres, ordem]);
  if (!torres.length) return <p className="muted">Nenhuma torre neste recorte.</p>;
  const comp = COMPOSICAO.filter((g) => torres.some((t) => t.categoria === (g.grupo === 'AUTOPORTANTE' ? 'autoportante' : 'estaiada')));
  const varios = grupos.length > 1;
  const linhas = [...new Set(grupos.map(([, ts]) => ts[0].linha_sigla))];
  const titulo = linhas.map((l) => `${l} · ${grupos.filter(([, ts]) => ts[0].linha_sigla === l).map(([, ts]) => ts[0].canteiro).join(' + ')}`).join(' | ');
  // por linha: "LISTA COMPLETA JZTIII-CAFII" se todos os canteiros dela estão no escopo; senão as abas dos canteiros
  const abas = linhas.flatMap((l) => completas.has(l) ? [`LISTA COMPLETA ${completas.get(l)}`]
    : [...new Set(grupos.filter(([, ts]) => ts[0].linha_sigla === l).map(([, ts]) => ts.find((t) => t.fonte)?.fonte)
        .filter((f): f is string => !!f).map(abaDaFonte))]);
  return (
    <section className="panel lista-painel">
      <div className="tramo-h">
        <b>{titulo.toUpperCase()}</b>
        <span className="muted num">{torres.length} torres</span>
        <span className="grow" />
        {abas.length > 0 && <span className="muted" style={{ fontSize: 12 }}>{abas.join(' · ')}</span>}
      </div>
      <div className="torres-tabela">
        <table className="lista">
          <thead>
            <tr>
              <th rowSpan={2} className="r">Seq.</th><th rowSpan={2}>Torre</th><th rowSpan={2}>Tipo</th>
              <th rowSpan={2} className="r">Altura (m)</th><th rowSpan={2} className="r">Tramo</th><th rowSpan={2}>Status</th>
              {comp.map((g) => <th key={g.grupo} colSpan={g.colunas.length} className="grp">{g.grupo}</th>)}
              {varios && <th rowSpan={2} className="g0">Canteiro</th>}
            </tr>
            <tr>{comp.flatMap((g) => g.colunas.map((c, ci) => <th key={c.chave} className={`r sub ${ci === 0 ? 'g0' : ''}`}>{c.rotulo}</th>))}</tr>
          </thead>
          <tbody>
            {grupos.flatMap(([nome, ts], gi) => ts.map((t, i) => (
              <tr key={t.id} className={`${t.ancoragem ? 'ancoragem' : ''} ${t.id === selId ? 'sel' : ''} ${gi > 0 && i === 0 ? 'divisa' : ''}`}
                  onClick={() => abrir(t.id)} title={varios && i === 0 ? nome : undefined}>
                <td className="r num">{t.sequencia ?? ''}</td>
                <td className="tnum">{t.numero}</td>
                <td className="tipo">{t.tipo}{t.ancoragem && <span className="marca" title={t.arranjo_ferragens ?? ''}>anc.</span>}</td>
                <td className="r num">{formatarMetros(t.altura_util)}</td>
                <td className="r num">
                  <button className="tramo" onClick={(e) => { e.stopPropagation(); escolherTramo(t); }} title="Ver só este tramo">{t.tramo}</button>
                </td>
                <td><Status t={t} /></td>
                {comp.flatMap((g) => g.colunas.map((c, ci) => <td key={c.chave} className={`r num comp ${ci === 0 ? 'g0' : ''} ${valorComp(t, c.chave, c.metros) ? classeCor(cores.get(`${t.id}|${c.chave}`)) : 'vazio'}`}>{valorComp(t, c.chave, c.metros)}</td>))}
                {varios && <td className="cant g0">{t.canteiro}</td>}
              </tr>
            )))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Mapa: uma faixa por tramo (ancoragem a ancoragem, pela LC), cada torre colorida pelo status do controle.
export function Mapa({ torres, selId, abrir }: { torres: Torre[]; selId: number | null; abrir: (id: number) => void }) {
  const tramos = useMemo(() => {
    const m = new Map<string, Torre[]>();
    for (const t of torres) { const k = `${t.linha_sigla}|${t.tramo}`; m.set(k, [...(m.get(k) ?? []), t]); }
    return [...m];
  }, [torres]);
  if (!torres.length) return <p className="muted">Nenhuma torre neste recorte.</p>;
  return (
    <>
      <div className="legend muted" style={{ fontSize: 12.5, display: 'flex', gap: 14, marginBottom: 8, flexWrap: 'wrap' }}>
        <span><i className="b ok" />Entregue (todos os componentes completos na Lista)</span><span><i className="b falta" />Faltante</span>
        <span><i className="b sf" />Outro status</span><span><i className="b sem" />Sem controle importado</span>
        <span>· traço laranja fino sob o número = ancoragem</span>
      </div>
      {tramos.map(([k, ts]) => {
        const [linha, tr] = k.split('|');
        const entregues = ts.filter((t) => statusDaTorre(t).classe === 'ok').length;
        const canteiros = [...new Set(ts.map((t) => t.canteiro))].join(', ');
        return (
          <section key={k} className="panel tramo-leve" style={{ marginBottom: 6 }}>
            <div className="tramo-h">
              <b>{linha} · Tramo {tr}</b>
              <span className="muted num">{ts[0].numero} a {ts[ts.length - 1].numero} · {ts.length} torres · {canteiros}</span>
              <span className="grow" />
              <span className="num" style={{ fontSize: 13 }}>{entregues} entregue{entregues === 1 ? '' : 's'}</span>
            </div>
            <div className="cells">
              {ts.map((t) => (
                <button key={t.id} className={`cell ${t.ancoragem ? 'anc' : ''} ${t.id === selId ? 'sel' : ''}`} onClick={() => abrir(t.id)}
                        title={`${t.numero} · ${t.tipo} · ${statusDaTorre(t).texto}`}>
                  <span className="n">{t.numero}</span>
                  <span className="t">{t.tipo} · {formatarMetros(t.altura_util)}</span>
                  <span className={`b ${statusDaTorre(t).classe}`} />
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

// Mapa contínuo (como a aba MAPA ESTRUTURA do controle): um mapa por canteiro, 24 torres por linha na ordem da linha.
// Mesma célula da visão por tramo: número, tipo · altura e a faixa de status (automático, pela Lista), sem texto de status.
export function MapaContinuo({ torres, selId, abrir }: { torres: Torre[]; selId: number | null; abrir: (id: number) => void }) {
  const canteiros = useMemo(() => {
    const m = new Map<string, Torre[]>();
    for (const t of torres) { const k = `${t.linha_sigla} · ${t.canteiro}`; m.set(k, [...(m.get(k) ?? []), t]); }
    return [...m];
  }, [torres]);
  if (!torres.length) return <p className="muted">Nenhuma torre neste recorte.</p>;
  return (
    <>
      <div className="legend muted" style={{ fontSize: 12.5, display: 'flex', gap: 14, marginBottom: 8, flexWrap: 'wrap' }}>
        <span><i className="b ok" />Entregue (todos os componentes completos na Lista)</span><span><i className="b falta" />Faltante</span>
        <span><i className="b sem" />Sem controle importado</span>
      </div>
      {canteiros.map(([nome, ts]) => {
        const entregues = ts.filter((t) => statusDaTorre(t).classe === 'ok').length;
        return (
          <section key={nome} className="panel mapa-cont" style={{ marginBottom: 12 }}>
            <div className="tramo-h">
              <b>{nome.toUpperCase()}</b>
              <span className="muted num">{ts[0].numero} a {ts[ts.length - 1].numero} · {ts.length} torres</span>
              <span className="grow" />
              <span className="num" style={{ fontSize: 13 }}>{entregues} entregue{entregues === 1 ? '' : 's'}</span>
            </div>
            <div className="mapa-grade">
              {ts.map((t) => (
                <button key={t.id} className={`cell ${t.ancoragem ? 'anc' : ''} ${t.id === selId ? 'sel' : ''}`} onClick={() => abrir(t.id)}
                        title={`${t.numero} · ${t.tipo} · ${formatarMetros(t.altura_util)} m · ${statusDaTorre(t).texto}`}>
                  <span className="n">{t.numero}</span>
                  <span className="t">{t.tipo} · {formatarMetros(t.altura_util)}</span>
                  <span className={`b ${statusDaTorre(t).classe}`} />
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

export function FichaTorre({ t, cores, aoFechar }: { t: Torre | null; cores: Map<string, TorreComponente>; aoFechar: () => void }) {
  const pernas = t ? [t.perna_a, t.perna_b, t.perna_c, t.perna_d] : [];
  const grupo = t ? COMPOSICAO.find((g) => g.grupo === (t.categoria === 'autoportante' ? 'AUTOPORTANTE' : 'ESTAIADA')) : undefined;
  return (
    <Gaveta aberta={!!t} aoFechar={aoFechar} sub={t ? `${t.linha_sigla} · ${t.canteiro ?? 'sem canteiro'} · tramo ${t.tramo ?? '—'}` : ''}
            titulo={t ? <>Torre {t.numero} <span style={{ fontWeight: 400, fontSize: 16 }}>{t.tipo}</span></> : ''}
            resumo={t ? [
              ['Status (automático)', <Status key="s" t={t} />],
              ['Seq. de ataque', t.sequencia ?? '—'],
              ['Altura útil', `${formatarMetros(t.altura_util)} m`],
              ['Categoria', t.categoria],
            ] : undefined}>
      {t && (
        <>
          <section>
            <h3 className="dr-t">Lista de construção</h3>
            <table>
              <tbody>
                <tr><td className="muted">Extensão</td><td className="num">{t.extensao === null ? '—' : `${formatarMetros(t.extensao)} m`}</td></tr>
                <tr><td className="muted">Pernas A / B / C / D</td><td className="num">
                  {pernas.some((p) => p !== null)
                    ? pernas.map((p, i) => <span key={i} className={'ABCD'[i] === t.perna_referencia ? 'ref' : undefined}>{i > 0 && ' / '}{formatarMetros(p)}</span>)
                    : '—'}
                  {t.perna_referencia && <span className="muted"> · referência {t.perna_referencia}</span>}
                </td></tr>
                {t.status_controle && t.status_controle.trim().toLowerCase() !== (t.status ?? '').toLowerCase() && (
                  <tr><td className="muted">Status digitado no controle</td><td>{t.status_controle} <span className="muted">(difere do automático)</span></td></tr>
                )}
                <tr><td className="muted">Ancoragem</td><td>{t.ancoragem ? 'sim' : 'não'}</td></tr>
                <tr><td className="muted">Arranjo de ferragens</td><td>{t.arranjo_ferragens ?? '—'}</td></tr>
              </tbody>
            </table>
          </section>
          <section>
            <h3 className="dr-t">Composição na LISTA do controle · pintura pelo estoque</h3>
            {t.composicao && grupo ? (
              <table>
                <thead><tr><th>{grupo.grupo}</th><th className="r">Qtd. / m</th><th>No estoque</th></tr></thead>
                <tbody>
                  {grupo.colunas.filter((c) => t.composicao?.[c.chave] !== undefined).map((c) => {
                    const p = cores.get(`${t.id}|${c.chave}`);
                    return (
                      <tr key={c.chave}><td>{c.rotulo}</td><td className={`r num ${classeCor(p)}`}>{valorComp(t, c.chave, c.metros)}</td>
                        <td>{p ? (p.completo ? 'completo' : <span className="warn">falta</span>) : '—'}</td></tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <p className="muted">Controle deste canteiro ainda não importado.</p>}
            {t.fonte && <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>Fonte: aba {abaDaFonte(t.fonte)} do controle</p>}
          </section>
          <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Verde = o conjunto completo em estoque chega até esta torre na sequência de ataque; vermelho = ainda não. Situações da torre (zerada, pré-montagem…) entram quando definirmos as regras.</p>
        </>
      )}
    </Gaveta>
  );
}

// 'controle:1 - Controle de estruturas - Juazeiro.xlsx · LISTA - JUAZEIRO' -> 'LISTA - JUAZEIRO' (sem o nome do arquivo)
function abaDaFonte(fonte: string) {
  return fonte.split(' · ').pop() ?? fonte;
}

// Pintura da célula pelo estoque (verde = completo para a torre na sequência de ataque; vermelho = falta)
function classeCor(p: TorreComponente | undefined) {
  return p ? (p.completo ? 'pint-ok' : 'pint-falta') : '';
}
