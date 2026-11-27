import { useEffect, useMemo, useState } from 'react';
import { useEditor } from '../lib/sessao';
import { num } from '../lib/formato';
import {
  confirmarNF, desfazerRecebimento, marcarRecebida, salvarNF, useNFItens, usePendencias, useSaldos,
  type NotaFiscal, type PendenciaNova,
} from '../dados/recebimento';
import { ofCurta, useOFs } from '../dados/ofs';
import { useLinhas } from '../dados/torres';
import { Titulo } from '../componentes/Titulo';
import { createPortal } from 'react-dom';
import { FiltroColuna } from '../componentes/FiltroColuna';
import { useTabelaCruz } from '../componentes/TabelaCruz';

const hoje = () => new Date().toISOString().slice(0, 10);
const n = (v: number | string | null | undefined) => Number(v ?? 0);
const TIPOS: [PendenciaNova['tipo'], string][] = [['volume', 'Volume'], ['peca', 'Peça'], ['fixador', 'Fixador']];

// ---------- Ações na ficha da NF: emitida → recebida (em conferência) → confirmada (com ou sem pendências) ----------
export function AcoesNF({ nf }: { nf: NotaFiscal }) {
  const editor = useEditor();
  const itens = useNFItens();
  const pend = usePendencias();
  const saldos = useSaldos();
  const meus = itens.dados.filter((i) => i.nota_fiscal_id === nf.id);
  const pendencias = pend.dados.filter((p) => p.nota_fiscal_id === nf.id);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [dataRec, setDataRec] = useState(hoje());
  const [canteiro, setCanteiro] = useState(nf.destino ?? '');
  const [comPend, setComPend] = useState(false);
  const [linhas, setLinhas] = useState<PendenciaNova[]>([{ tipo: 'volume', material_id: null, quantidade: 1, motivo: 'falta' }]);
  const canteiros = useMemo(() => [...new Set(saldos.dados.map((s) => s.canteiro))].sort(), [saldos.dados]);
  // itens da NF para escolher na pendência (o fluxo de conferência é das NFs lançadas no app, que têm itens)
  const recebidos = useMemo(() => meus.map((i) => [i.material_id, i.descricao] as [number, string]), [meus]);

  const fazer = async (f: () => Promise<unknown>, ok: string) => {
    setOcupado(true); setMsg(null);
    try { await f(); setMsg(ok); } catch (e) { setMsg(`Não foi possível: ${(e as Error).message}`); } finally { setOcupado(false); }
  };

  return (
    <section className="fluxo">
      {meus.length > 0 && (
        <>
          <h2>Itens da NF {nf.lancamento ? `(lançados ${nf.lancamento === 'pdf' ? 'pelo PDF' : 'manualmente'})` : ''}</h2>
          <table>
            <thead><tr><th>Item</th><th className="r">Qtd.</th><th className="r">Peso (kg)</th></tr></thead>
            <tbody>{meus.map((i) => (
              <tr key={i.material_id}><td>{i.descricao}</td><td className="r num">{num(i.quantidade)}</td><td className="r num">{i.peso_unit ? num(n(i.quantidade) * n(i.peso_unit), 1) : '—'}</td></tr>
            ))}</tbody>
          </table>
        </>
      )}

      {pendencias.length > 0 && (
        <>
          <h2>Pendências</h2>
          <table>
            <thead><tr><th>Tipo</th><th>Item</th><th className="r">Qtd.</th><th>Motivo</th><th>RNC / SAC</th><th>Situação</th></tr></thead>
            <tbody>{pendencias.map((p) => (
              <tr key={p.id}><td>{TIPOS.find(([k]) => k === p.tipo)?.[1]}</td><td>{p.material ?? '—'}{p.descricao ? <span className="muted"> · {p.descricao}</span> : ''}</td>
                <td className="r num">{num(p.quantidade)}</td><td>{p.motivo}</td><td>{[p.rnc && `RNC ${p.rnc}`, p.sac && `SAC ${p.sac}`].filter(Boolean).join(' · ') || <span className="muted">a preencher</span>}</td>
                <td>{p.situacao}</td></tr>
            ))}</tbody>
          </table>
        </>
      )}

      {editor && (
        <div className="acoes-nf">
          {nf.situacao_exibida !== 'confirmada' && nf.situacao_exibida !== 'em_conferencia' && (
            meus.length === 0
              ? <p className="muted">Sem itens lançados.</p>
              : (
                <div className="linha-acao">
                  <b>Pátio informou o recebimento?</b>
                  <label>Data <input type="date" value={dataRec} onChange={(e) => setDataRec(e.target.value)} /></label>
                  <label>Canteiro <select value={canteiro} onChange={(e) => setCanteiro(e.target.value)}>
                    <option value="">—</option>{canteiros.map((c) => <option key={c}>{c}</option>)}</select></label>
                  <button className="pri" disabled={ocupado || !canteiro || !dataRec}
                          onClick={() => fazer(() => marcarRecebida(nf.id, dataRec, canteiro, nf.linha ?? undefined), 'Marcada como recebida: em conferência.')}>Marcar como recebida</button>
                </div>
              )
          )}
          {nf.situacao_exibida === 'em_conferencia' && (
            <>
              <div className="linha-acao">
                <b>Conferência</b>
                <button className="pri" disabled={ocupado} onClick={() => fazer(() => confirmarNF(nf.id), 'Confirmada: entrou no estoque.')}>Confirmar (tudo certo)</button>
                <button disabled={ocupado} onClick={() => setComPend((v) => !v)}>{comPend ? 'Cancelar pendência' : 'Confirmar com pendência'}</button>
                {nf.lancamento && <button className="link" disabled={ocupado} onClick={() => fazer(() => desfazerRecebimento(nf.id), 'Recebimento desfeito: voltou para emitida.')}>Desfazer recebimento</button>}
              </div>
              {comPend && (
                <div className="pend-form">
                  <table>
                    <thead><tr><th>Tipo</th><th>Item da NF</th><th>Peça / descrição</th><th className="r">Qtd.</th><th>Motivo</th><th>Observação</th><th /></tr></thead>
                    <tbody>{linhas.map((l, i) => {
                      const muda = (x: Partial<PendenciaNova>) => setLinhas((ls) => ls.map((y, j) => (j === i ? { ...y, ...x } : y)));
                      return (
                        <tr key={i}>
                          <td><select value={l.tipo} onChange={(e) => muda({ tipo: e.target.value as PendenciaNova['tipo'] })}>{TIPOS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></td>
                          <td><select value={l.material_id ?? ''} onChange={(e) => muda({ material_id: e.target.value ? Number(e.target.value) : null })}>
                            <option value="">—</option>{recebidos.map(([id, d]) => <option key={id} value={id}>{d}</option>)}</select></td>
                          <td><input value={l.descricao ?? ''} placeholder={l.tipo === 'peca' ? 'ex. POS 381' : ''} onChange={(e) => muda({ descricao: e.target.value })} /></td>
                          <td><input type="number" min={1} style={{ width: 70 }} value={l.quantidade} onChange={(e) => muda({ quantidade: Number(e.target.value) })} /></td>
                          <td><select value={l.motivo} onChange={(e) => muda({ motivo: e.target.value as PendenciaNova['motivo'] })}><option value="falta">falta</option><option value="avaria">avaria</option></select></td>
                          <td><input value={l.observacao ?? ''} onChange={(e) => muda({ observacao: e.target.value })} /></td>
                          <td><button className="link" onClick={() => setLinhas((ls) => ls.filter((_, j) => j !== i))}>remover</button></td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                  <div className="linha-acao">
                    <button onClick={() => setLinhas((ls) => [...ls, { tipo: 'volume', material_id: null, quantidade: 1, motivo: 'falta' }])}>+ pendência</button>
                    <button className="pri" disabled={ocupado || !linhas.length || linhas.some((l) => !l.material_id || !(l.quantidade > 0))}
                            onClick={() => fazer(() => confirmarNF(nf.id, linhas), 'Confirmada com pendência: o que faltou ficou fora do estoque.')}>Confirmar com {linhas.length} pendência(s)</button>
                  </div>
                </div>
              )}
            </>
          )}
          {msg && <div className={msg.startsWith('Não foi') ? 'callout' : 'notes'}>{msg}</div>}
        </div>
      )}
    </section>
  );
}

// digitação de número no formato brasileiro: ponto no milhar, vírgula no decimal
function numeroBR(texto: string, casas: number): string {
  const limpo = texto.replace(/[^\d,]/g, '');
  const [int, ...resto] = limpo.split(',');
  const milhar = int.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return resto.length ? `${milhar},${resto.join('').slice(0, casas)}` : milhar;
}
const deBR = (texto: string) => texto.replace(/\./g, '').replace(',', '.');

// ---------- Lançar NF manualmente: uma "coluna da ENTRADA" (cabeçalho + quantidade por item, na ordem do controle) ----------
export function LancarNFTela() {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  return (
    <div className="notas-tela cheia">
      <Titulo texto="Lançar NF"><div className="titulo-slot" ref={setSlot} /></Titulo>
      <LancarNF slot={slot} />
    </div>
  );
}

export function LancarNF({ slot }: { slot: HTMLElement | null }) {
  const editor = useEditor();
  const saldos = useSaldos();
  const linhas = useLinhas();
  const [cab, setCab] = useState({ numero: '', emissao: '', of: '', romaneio: '', valor: '', peso: '' });
  const [linha, setLinha] = useState('');
  const [destino, setDestino] = useState('');
  const [qtd, setQtd] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ id: number; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [tipo, setTipo] = useState('');
  const [filtroDesc, setFiltroDesc] = useState<Set<string> | null>(null);
  const cruz = useTabelaCruz();
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 3600);
    return () => clearTimeout(t);
  }, [aviso]);

  const canteiros = useMemo(() => [...new Set(saldos.dados.filter((s) => s.linha === linha && n(s.previsto) > 0).map((s) => s.canteiro))], [saldos.dados, linha]);
  const outros = useMemo(() => [...new Set(saldos.dados.map((s) => s.canteiro))].filter((c) => !canteiros.includes(c)), [saldos.dados, canteiros]);
  const itens = useMemo(() => {
    if (!linha || !destino) return [];
    const m = new Map<number, (typeof saldos.dados)[number]>();
    for (const s of saldos.dados) {
      if (s.linha !== linha) continue;
      if (s.canteiro === destino) m.set(s.material_id, s);
      else if (n(s.previsto) > 0 && !m.has(s.material_id)) m.set(s.material_id, { ...s, canteiro: destino, previsto: 0, recebido: 0, saido: 0, saldo: 0 });
    }
    return [...m.values()].filter((s) => n(s.previsto) > 0 || canteiros.includes(destino) === false).sort((a, b) => a.ordem - b.ordem);
  }, [saldos.dados, linha, destino, canteiros]);
  const ofs = useOFs();
  const ofsLinha = useMemo(() => ofs.dados.filter((o) => o.linha === linha).sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0)), [ofs.dados, linha]);
  // tipos de torre na ordem do controle; itens sem tipo = fixadores
  const tipos = useMemo(() => [...new Set(itens.map((i) => i.tipo ?? 'Fixadores'))], [itens]);
  const doTipo = useMemo(() => itens.filter((i) => !tipo || (i.tipo ?? 'Fixadores') === tipo), [itens, tipo]);
  const visiveis = useMemo(() => doTipo.filter((i) => !filtroDesc || filtroDesc.has(i.descricao)), [doTipo, filtroDesc]);
  const peso = itens.reduce((s, i) => s + n(qtd[i.material_id]) * n(i.peso_unit), 0);
  const preenchidos = itens.filter((i) => n(qtd[i.material_id]) !== 0);

  if (!editor) return <p className="muted">Lançamento só para quem tem perfil de edição.</p>;
  const salvar = async () => {
    setOcupado(true); setMsg(null);
    try {
      await salvarNF({ ...cab, valor: deBR(cab.valor), peso: deBR(cab.peso), linha, destino, lancamento: 'manual', itens: preenchidos.map((i) => ({ material_id: i.material_id, quantidade: n(qtd[i.material_id]) })) });
      setAviso({ id: Date.now(), texto: `NF ${cab.numero} cadastrada` });
      setCab({ numero: '', emissao: '', of: '', romaneio: '', valor: '', peso: '' }); setQtd({});
    } catch (e) { setMsg(`Não foi possível: ${(e as Error).message}`); } finally { setOcupado(false); }
  };
  let secao = '';
  let parteAnt: string | null = null;
  return (
    <div className="lancar conteudo">
      <div className="panel" style={{ padding: 12, marginBottom: 10 }}>
        <div className="campos">
          <label>Nota fiscal <input value={cab.numero} inputMode="numeric" onChange={(e) => setCab({ ...cab, numero: e.target.value.replace(/\D/g, '') })} /></label>
          <label>Data de emissão <input type="date" value={cab.emissao} onChange={(e) => setCab({ ...cab, emissao: e.target.value })} /></label>
          <label>Linha <select value={linha} onChange={(e) => { setLinha(e.target.value); setDestino(''); setQtd({}); setTipo(""); setFiltroDesc(null); setCab({ ...cab, of: '' }); }}>
            <option value="">—</option>{linhas.dados.map((l) => <option key={l.sigla} value={l.sigla}>{l.codigo} - {l.sigla}</option>)}</select></label>
          <label>Canteiro de destino <select value={destino} disabled={!linha} onChange={(e) => { setDestino(e.target.value); setQtd({}); setTipo(""); setFiltroDesc(null); }}>
            <option value="">—</option>{canteiros.map((c) => <option key={c}>{c}</option>)}
            {outros.length > 0 && <optgroup label="Fora do trecho">{outros.map((c) => <option key={c}>{c}</option>)}</optgroup>}</select></label>
          <label>OF <select value={cab.of} disabled={!linha} onChange={(e) => setCab({ ...cab, of: e.target.value })}>
            <option value="">—</option>{ofsLinha.map((o) => <option key={o.id} value={o.codigo}>{[ofCurta(o), o.canteiro].filter(Boolean).join(' · ')}</option>)}</select></label>
          <label>Valor NF <span className="campo-pre"><i>R$</i><input value={cab.valor} inputMode="decimal" onChange={(e) => setCab({ ...cab, valor: numeroBR(e.target.value, 2) })} /></span></label>
          <label>Peso NF (kg) <input value={cab.peso} inputMode="decimal" onChange={(e) => setCab({ ...cab, peso: numeroBR(e.target.value, 3) })} /></label>
          <label>Remessa <input value={cab.romaneio} onChange={(e) => setCab({ ...cab, romaneio: e.target.value })} /></label>
        </div>
        <div className="linha-acao" style={{ marginTop: 8 }}>
          <span className="num">Peso pelos itens: <b>{num(peso, 1)} kg</b>{cab.peso && <> · NF: <b>{num(Number(deBR(cab.peso)), 1)} kg</b>
            {Math.abs(peso - Number(deBR(cab.peso))) > 1 && <span className="warn"> (diferença {num(peso - Number(deBR(cab.peso)), 1)} kg)</span>}</>}</span>
          <span className="grow" />
          {destino && (
            <label className="chk">Tipo <select value={tipo} onChange={(e) => { setTipo(e.target.value); setFiltroDesc(null); }}>
              <option value="">Todos</option>{tipos.map((t) => <option key={t}>{t}</option>)}</select></label>
          )}
          <button className="pri" disabled={ocupado || !cab.numero || !destino || !cab.of || !preenchidos.length} onClick={salvar}>Lançar como emitida</button>
        </div>
        {msg && <div className="callout" style={{ marginTop: 8 }}>{msg}</div>}
      </div>
      {slot && destino && createPortal(
        <label className="chk">Tipo <select value={tipo} onChange={(e) => { setTipo(e.target.value); setFiltroDesc(null); }}>
          <option value="">Todos</option>{tipos.map((t) => <option key={t}>{t}</option>)}</select></label>, slot)}
      {destino && (
        <div className="panel planilha lancar-grade">
          <table ref={cruz.ref} className="cruz" onMouseDown={cruz.onMouseDown} onMouseOver={cruz.onMouseOver} onMouseLeave={cruz.onMouseLeave}>
            <thead><tr className="tit">
              <th>{<FiltroColuna titulo="Descrição" valores={doTipo.map((i) => i.descricao)} selecionados={filtroDesc} aoMudar={setFiltroDesc} />}</th>
              <th className="r">Previsto</th><th className="r">Recebido</th><th className="nfcolh">{cab.numero}</th>
            </tr></thead>
            <tbody>{visiveis.flatMap((i) => {
              const out = [];
              if (i.secao !== secao) {
                secao = i.secao; parteAnt = null;
                out.push(<tr key={`s${i.material_id}`} className="sec faixa"><td>{i.secao}</td><td /><td /><td /></tr>);
              }
              const iniParte = parteAnt !== null && i.parte !== parteAnt;
              parteAnt = i.parte;
              out.push(
                <tr key={i.material_id} data-k={i.material_id} className={iniParte ? 'ini-parte' : ''}>
                  <td className="desc">{i.descricao}</td>
                  <td className="r num prev">{num(i.previsto)}</td>
                  <td className={`r num rec ${n(i.recebido) < n(i.previsto) ? 'warn' : ''}`}>{num(i.recebido)}</td>
                  <td className="r"><input className="qtd" inputMode="numeric" value={qtd[i.material_id] ?? ''}
                    onChange={(e) => setQtd({ ...qtd, [i.material_id]: e.target.value.replace(/[^\d,.-]/g, '').replace(',', '.') })} /></td>
                </tr>,
              );
              return out;
            })}</tbody>
          </table>
        </div>
      )}
      {aviso && <div key={aviso.id} className="aviso-flutuante">{aviso.texto}</div>}
    </div>
  );
}
