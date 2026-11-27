import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../lib/sessao';
import { data, num } from '../lib/formato';
import {
  confirmarNF, desfazerRecebimento, receberNF, salvarNF, sugerirItens, useCanteiros, useLancamentos, useNFItens, useNotasFiscais, usePendencias,
  useRecebimentos, useSaldos,
  type NotaFiscal, type PendenciaNova,
} from '../dados/recebimento';
import { lerNFsDeArquivos, problemasRomaneio, type LeituraNF } from '../lib/lerNF';
import { paginasDoPdf } from '../lib/pdfTexto';
import { ofCurta, useOFs } from '../dados/ofs';
import { useLinhas } from '../dados/torres';
import { Titulo } from '../componentes/Titulo';
import { createPortal } from 'react-dom';
import { FiltroColuna } from '../componentes/FiltroColuna';
import { useTabelaCruz } from '../componentes/TabelaCruz';

const hoje = () => new Date().toISOString().slice(0, 10);
const n = (v: number | string | null | undefined) => Number(v ?? 0);

// Pendências da NF (o que faltou ou chegou avariado; fora do estoque até a reposição)
export function PendenciasNF({ nf }: { nf: NotaFiscal }) {
  const pend = usePendencias();
  const pendencias = pend.dados.filter((p) => p.nota_fiscal_id === nf.id);
  if (!pendencias.length) return <p className="muted">Sem pendências.</p>;
  return (
          <table className="receber">
            <thead><tr><th>Item</th><th className="c">Qtd.</th><th className="c">RNC / SAC</th><th className="c">Situação</th></tr></thead>
            <tbody>{pendencias.map((p) => (
              <tr key={p.id}><td>{p.material ?? '—'}{p.descricao ? <span className="muted"> · {p.descricao}</span> : ''}</td>
                <td className="c num">{num(p.quantidade)}</td><td className="c">{[p.rnc && `RNC ${p.rnc}`, p.sac && `SAC ${p.sac}`].filter(Boolean).join(' · ') || '—'}</td>
                <td className="c">{p.situacao}</td></tr>
            ))}</tbody>
          </table>

  );
}

// ---------- Ações na ficha da NF: emitida → recebida (sem ou com pendências) ----------
// Recebimento em um passo: para cada item da NF, quanto chegou em condições; a diferença vira pendência (falta ou avaria,
// RNC opcional) e fica fora do estoque até a reposição. Peça faltante de um volume: linha própria (volume fica incompleto).
type PecaFalta = { material_id: number | null; descricao: string; quantidade: number; rnc: string };
export function AcoesNF({ nf }: { nf: NotaFiscal }) {
  const editor = useEditor();
  const itens = useNFItens();
  const saldos = useSaldos();
  const meus = itens.dados.filter((i) => i.nota_fiscal_id === nf.id);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [dataRec, setDataRec] = useState(hoje());
  const [canteiro, setCanteiro] = useState(nf.destino ?? '');
  const [chegou, setChegou] = useState<Record<number, string>>({});
  const [rnc, setRnc] = useState<Record<number, string>>({});
  const [pecas, setPecas] = useState<PecaFalta[]>([]);
  const canteiros = useMemo(() => [...new Set(saldos.dados.map((s) => s.canteiro))].sort(), [saldos.dados]);
  const aReceber = nf.situacao_exibida !== 'confirmada' && nf.situacao_exibida !== 'em_conferencia';
  const emConferencia = nf.situacao_exibida === 'em_conferencia';

  const qChegou = (id: number, nfQ: number) => (chegou[id] === undefined || chegou[id] === '' ? nfQ : n(chegou[id]));
  const novas: PendenciaNova[] = [
    ...meus.flatMap((i) => {
      const falta = n(i.quantidade) - qChegou(i.material_id, n(i.quantidade));
      return falta > 0 ? [{ tipo: (i.secao.startsWith('FIXADORES') ? 'fixador' : 'volume') as PendenciaNova['tipo'], material_id: i.material_id,
        quantidade: falta, motivo: 'falta' as const, rnc: rnc[i.material_id] }] : [];
    }),
    ...pecas.filter((x) => x.material_id && x.quantidade > 0).map((x) => ({ tipo: 'peca' as const, material_id: x.material_id, descricao: x.descricao,
      quantidade: x.quantidade, motivo: 'falta' as const, rnc: x.rnc })),
  ];
  const invalido = meus.some((i) => { const c = qChegou(i.material_id, n(i.quantidade)); return c < 0 || c > n(i.quantidade); })
    || pecas.some((x) => !x.material_id || !(x.quantidade > 0));

  const fazer = async (f: () => Promise<unknown>, ok: string) => {
    setOcupado(true); setMsg(null);
    try { await f(); setMsg(ok); setChegou({}); setRnc({}); setPecas([]); }
    catch (e) { setMsg(`Não foi possível: ${(e as Error).message}`); } finally { setOcupado(false); }
  };
  const registrar = () => (aReceber
    ? fazer(() => receberNF(nf.id, dataRec, canteiro, nf.linha, novas), novas.length ? `Recebida com ${novas.length} pendência(s)` : 'Recebida')
    : fazer(() => confirmarNF(nf.id, novas), novas.length ? `Confirmada com ${novas.length} pendência(s)` : 'Confirmada'));
  const editavel = editor && (aReceber || emConferencia) && meus.length > 0;

  return (
    <section className="fluxo">
      {meus.length > 0 && (
        <>
          <table className="receber">
            <colgroup><col /><col className="c-q" />{editavel && <><col className="c-q" /><col className="c-q" /><col className="c-rnc" /></>}</colgroup>
            <thead><tr><th>Item</th><th className="c">NF</th>{editavel && <><th className="c">Chegou</th><th className="c">Falta</th><th className="c">RNC</th></>}</tr></thead>
            <tbody>{meus.map((i) => {
              const q = n(i.quantidade);
              const falta = q - qChegou(i.material_id, q);
              return (
                <tr key={i.material_id} className={falta > 0 ? 'com-pend' : ''}>
                  <td>{i.descricao}</td><td className="c num">{num(q)}</td>
                  {editavel && <>
                    <td className="cel"><input inputMode="numeric" value={chegou[i.material_id] ?? String(q)}
                      onChange={(e) => setChegou({ ...chegou, [i.material_id]: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') })} /></td>
                    <td className="c num falta">{falta > 0 ? num(falta) : ''}</td>
                    <td className="cel">{falta > 0 && <input value={rnc[i.material_id] ?? ''} onChange={(e) => setRnc({ ...rnc, [i.material_id]: e.target.value })} />}</td>
                  </>}
                </tr>
              );
            })}</tbody>
          </table>
          {editavel && pecas.length > 0 && (
            <table className="receber pecas">
              <colgroup><col /><col className="c-pos" /><col className="c-q" /><col className="c-rnc" /><col className="c-x" /></colgroup>
              <thead><tr><th>Peça faltante · volume</th><th className="c">POS</th><th className="c">Qtd.</th><th className="c">RNC</th><th /></tr></thead>
              <tbody>{pecas.map((x, k) => {
                const muda = (y: Partial<PecaFalta>) => setPecas((ps) => ps.map((z, j) => (j === k ? { ...z, ...y } : z)));
                return (
                  <tr key={k} className="com-pend">
                    <td className="cel"><select value={x.material_id ?? ''} onChange={(e) => muda({ material_id: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">—</option>{meus.filter((i) => !i.secao.startsWith('FIXADORES')).map((i) => <option key={i.material_id} value={i.material_id}>{i.descricao}</option>)}</select></td>
                    <td className="cel"><input value={x.descricao} onChange={(e) => muda({ descricao: e.target.value })} /></td>
                    <td className="cel"><input inputMode="numeric" value={x.quantidade} onChange={(e) => muda({ quantidade: Number(e.target.value.replace(/\D/g, '')) })} /></td>
                    <td className="cel"><input value={x.rnc} onChange={(e) => muda({ rnc: e.target.value })} /></td>
                    <td className="c"><button className="x" title="Remover" onClick={() => setPecas((ps) => ps.filter((_, j) => j !== k))}>×</button></td>
                  </tr>
                );
              })}</tbody>
            </table>
          )}
        </>
      )}

      {editor && (
        <div className="acoes-nf">
          {aReceber && meus.length === 0 && <p className="muted">Sem itens lançados.</p>}
          {editavel && aReceber && (
            <div className="rec-campos">
              <label>Recebida em <input type="date" value={dataRec} onChange={(e) => setDataRec(e.target.value)} /></label>
              <label>Canteiro <select value={canteiro} onChange={(e) => setCanteiro(e.target.value)}>
                <option value="">—</option>{canteiros.map((c) => <option key={c}>{c}</option>)}</select></label>
            </div>
          )}
          {(editavel || (nf.lancamento && (emConferencia || nf.situacao_exibida === 'confirmada'))) && (
            <div className="rec-barra">
              {editavel && <button className="link" onClick={() => setPecas((ps) => [...ps, { material_id: null, descricao: '', quantidade: 1, rnc: '' }])}>+ peça faltante</button>}
              {nf.lancamento && (emConferencia || nf.situacao_exibida === 'confirmada') && (
                <button className="link" disabled={ocupado} onClick={() => fazer(() => desfazerRecebimento(nf.id), 'Recebimento desfeito: voltou para emitida')}>Desfazer recebimento</button>
              )}
              <span className="grow" />
              {editavel && (
                <button className={novas.length ? 'pri com-pend' : 'pri'} disabled={ocupado || invalido || (aReceber && (!canteiro || !dataRec))} onClick={registrar}>
                  {aReceber ? (novas.length ? `Recebida com ${novas.length} pendência(s)` : 'Recebida sem pendências')
                    : (novas.length ? `Confirmar com ${novas.length} pendência(s)` : 'Confirmar sem pendências')}
                </button>
              )}
            </div>
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
const paraBR = (v: number | null, casas: number) => (v === null ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }));
const normaliza = (t: string | null | undefined) => (t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().toUpperCase();
type Lida = { arquivo: string; l: LeituraNF; arquivos: string[] };
type SemPar = { seq: number; descricao: string; quantidade: number; como: string };
// diferença entre a NF já cadastrada e o que está sendo lançado (o usuário escolhe o que fica)
type Dif = { k: string; rotulo: string; cad: string; novo: string; item?: { material_id: number; cad: number; novo: number } };
const numOF = (t: string | null | undefined) => (t ?? '').match(/BRM-(\d+)|^\s*OF\s*-\s*(\d+)/)?.slice(1).find(Boolean) ?? (t ?? '').trim();

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
  const cantCad = useCanteiros();
  const nfsCad = useNotasFiscais();
  const [lidas, setLidas] = useState<Lida[]>([]);
  const [atual, setAtual] = useState<Lida | null>(null);
  const [semPar, setSemPar] = useState<SemPar[]>([]);
  const [lendo, setLendo] = useState(false);
  // PDFs ficam só na memória do navegador enquanto a tela está aberta (endereço temporário para o visualizador)
  const urls = useRef(new Map<string, string>());
  const [verPdf, setVerPdf] = useState(true);
  const [pdfAberto, setPdfAberto] = useState<string | null>(null);
  useEffect(() => () => { for (const u of urls.current.values()) URL.revokeObjectURL(u); }, []);
  const [arrastando, setArrastando] = useState(false);
  const nfItens = useNFItens();
  const recs = useRecebimentos();
  const lancs = useLancamentos();
  const [escolha, setEscolha] = useState<Record<string, 'cad' | 'novo'>>({});
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
    const lista = [...m.values()].filter((s) => n(s.previsto) > 0 || canteiros.includes(destino) === false);
    const tem = new Set(lista.map((s) => s.material_id));
    for (const id of Object.keys(qtd).map(Number)) {
      if (tem.has(id)) continue;
      const base = saldos.dados.find((s) => s.material_id === id);
      if (base) { lista.push({ ...base, linha, canteiro: destino, previsto: 0, recebido: 0, saido: 0, saldo: 0 }); tem.add(id); }
    }
    return lista.sort((a, b) => a.ordem - b.ordem);
  }, [saldos.dados, linha, destino, canteiros, qtd]);
  const ofs = useOFs();
  const ofsLinha = useMemo(() => ofs.dados.filter((o) => o.linha === linha).sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0)), [ofs.dados, linha]);
  // tipos de torre na ordem do controle; itens sem tipo = fixadores
  const tipos = useMemo(() => [...new Set(itens.map((i) => i.tipo ?? 'Fixadores'))], [itens]);
  const doTipo = useMemo(() => itens.filter((i) => !tipo || (i.tipo ?? 'Fixadores') === tipo), [itens, tipo]);
  const visiveis = useMemo(() => doTipo.filter((i) => !filtroDesc || filtroDesc.has(i.descricao)), [doTipo, filtroDesc]);
  const peso = itens.reduce((s, i) => s + n(qtd[i.material_id]) * n(i.peso_unit), 0);
  const preenchidos = itens.filter((i) => n(qtd[i.material_id]) !== 0);

  // ---------- NF já cadastrada: diferenças campo a campo e item a item ----------
  const numero = cab.numero.replace(/^0+/, '');
  const existente = useMemo(() => nfsCad.dados.find((x) => x.numero === numero) ?? null, [nfsCad.dados, numero]);
  const nomeMat = useMemo(() => new Map(saldos.dados.map((s) => [s.material_id, s.descricao])), [saldos.dados]);
  const itensCad = useMemo(() => {
    const m = new Map<number, number>();
    if (!existente) return m;
    for (const i of nfItens.dados) if (i.nota_fiscal_id === existente.id) m.set(i.material_id, (m.get(i.material_id) ?? 0) + n(i.quantidade));
    if (!m.size) {  // recebida pelo controle: o que foi lançado na ENTRADA
      const movs = new Set(recs.dados.filter((r) => r.nf_id === existente.id).map((r) => r.id));
      for (const l of lancs.dados) if (movs.has(l.movimento_id)) m.set(l.material_id, (m.get(l.material_id) ?? 0) + n(l.quantidade));
    }
    return m;
  }, [existente, nfItens.dados, recs.dados, lancs.dados]);
  const recebida = !!existente && (!!existente.recebida_em || recs.dados.some((r) => r.nf_id === existente.id));
  const comItens = !!existente && (itensCad.size > 0 || !!existente.lancamento);
  const difs = useMemo<Dif[]>(() => {
    if (!existente) return [];
    const out: Dif[] = [];
    const campo = (k: string, rotulo: string, cad: string | null, novo: string, igual: boolean) => {
      if (cad && novo && !igual) out.push({ k, rotulo, cad, novo });
    };
    const vNovo = cab.valor ? Number(deBR(cab.valor)) : null;
    const pNovo = cab.peso ? Number(deBR(cab.peso)) : null;
    campo('emissao', 'Data de emissão', existente.emissao, cab.emissao, existente.emissao === cab.emissao);
    campo('linha', 'Linha', existente.linha, linha, existente.linha === linha);
    campo('destino', 'Canteiro de destino', existente.destino, destino, existente.destino === destino);
    campo('of', 'OF', existente.of_texto, cab.of, numOF(existente.of_texto) === numOF(cab.of));
    campo('valor', 'Valor NF', existente.valor !== null ? `R$ ${paraBR(n(existente.valor), 2)}` : null, vNovo !== null ? `R$ ${cab.valor}` : '',
      vNovo !== null && Math.abs(n(existente.valor) - vNovo) < 0.01);
    campo('peso', 'Peso NF (kg)', existente.peso !== null ? paraBR(n(existente.peso), 3) : null, pNovo !== null ? cab.peso : '',
      pNovo !== null && Math.abs(n(existente.peso) - pNovo) < 0.001);
    campo('romaneio', 'Remessa', existente.romaneio, cab.romaneio, (existente.romaneio ?? '').replace(/^0+/, '') === cab.romaneio.replace(/^0+/, ''));
    if (preenchidos.length) {
      const novos = new Map(preenchidos.map((i) => [i.material_id, n(qtd[i.material_id])]));
      for (const id of new Set([...itensCad.keys(), ...novos.keys()])) {
        const c = itensCad.get(id) ?? 0, v = novos.get(id) ?? 0;
        if (Math.abs(c - v) > 1e-9) out.push({ k: `m${id}`, rotulo: nomeMat.get(id) ?? `material ${id}`, cad: num(c), novo: num(v), item: { material_id: id, cad: c, novo: v } });
      }
    }
    return out;
  }, [existente, cab, linha, destino, preenchidos, qtd, itensCad, nomeMat]);
  const lado = (d: Dif) => escolha[d.k] ?? 'cad';
  useEffect(() => { setEscolha({}); }, [numero]);

  if (!editor) return <p className="muted">Lançamento só para quem tem perfil de edição.</p>;

  // ---------- leitura do PDF: preenche cabeçalho, linha, destino, OF e as quantidades sugeridas pelo romaneio ----------
  const aplicar = async (x: Lida) => {
    const l = x.l;
    setAtual(x); setPdfAberto(x.arquivos[0] ?? null); setMsg(null); setTipo(''); setFiltroDesc(null); setSemPar([]); setQtd({});
    const nOF = Number(l.oc?.match(/BRM-(\d+)/)?.[1] ?? l.oc?.match(/^\s*OF\s*-\s*(\d+)/)?.[1] ?? NaN);
    const doLt = linhas.dados.find((li) => l.lt && normaliza(l.lt).startsWith(normaliza(li.nome)))?.sigla;
    const cands = ofs.dados.filter((o) => o.numero === nOF);
    const of = cands.find((o) => o.linha === doLt) ?? (cands.length === 1 ? cands[0] : undefined);
    const lin = of?.linha ?? doLt ?? '';
    const mun = normaliza(l.municipio_entrega ?? l.municipio_destinatario);
    const can = cantCad.dados.find((c) => c.municipio && c.municipio === mun)?.nome ?? '';
    setLinha(lin); setDestino(can);
    setCab({ numero: l.nf ?? '', emissao: l.emissao ?? '', of: of?.codigo ?? '', romaneio: l.remessa ?? '', valor: paraBR(l.valor, 2), peso: paraBR(l.peso_liquido, 3) });
    if (!lin || !can || !l.romaneio.length) {
      setSemPar(l.romaneio.map((r) => ({ seq: r.seq, descricao: `${r.descricao_pa} ${r.descricao}`.trim(), quantidade: r.quantidade, como: 'sem' })));
      return;
    }
    try {
      const sug = await sugerirItens(lin, can, l.romaneio.map((r) => ({ seq: r.seq, sku: r.sku, descricao: r.descricao, descricao_pa: r.descricao_pa, tipo_ud: r.tipo_ud, peso_unit: r.peso_unit })));
      const porSeq = new Map(sug.map((g) => [g.seq, g]));
      const q: Record<number, number> = {};
      const sem: SemPar[] = [];
      for (const r of l.romaneio) {
        const g = porSeq.get(r.seq);
        if (g?.material_id) q[g.material_id] = (q[g.material_id] ?? 0) + r.quantidade;
        else sem.push({ seq: r.seq, descricao: `${r.descricao_pa} ${r.descricao}`.trim(), quantidade: r.quantidade, como: g?.como ?? 'sem' });
      }
      setQtd(Object.fromEntries(Object.entries(q).map(([k, v]) => [k, String(v)])));
      setSemPar(sem);
    } catch (e) { setMsg(`Não foi possível: ${(e as Error).message}`); }
  };
  const lerArquivos = async (arqs: File[]) => {
    const pdfs = arqs.filter((a) => /\.pdf$/i.test(a.name));
    if (!pdfs.length) return;
    setLendo(true); setMsg(null);
    try {
      const lidosArq = [];
      for (const a of pdfs) lidosArq.push({ nome: a.name, paginas: await paginasDoPdf(a) });
      for (const u of urls.current.values()) URL.revokeObjectURL(u);
      urls.current = new Map(pdfs.map((a) => [a.name, URL.createObjectURL(a)]));
      const novas: Lida[] = lerNFsDeArquivos(lidosArq);
      const semNF = lidosArq.filter((a) => !novas.some((x) => x.arquivos.includes(a.nome)));
      if (semNF.length) novas.push(...semNF.map((a) => ({ arquivo: a.nome, arquivos: [a.nome], l: { erro: 'sem NF correspondente' } as LeituraNF })));
      const erros = novas.filter((x) => x.l.erro || !x.l.nf);
      if (erros.length) setMsg(`Não foi possível ler: ${erros.map((x) => `${x.arquivo} (${x.l.erro ?? 'número da NF não encontrado'})`).join(', ')}`);
      const ok = novas.filter((x) => !x.l.erro && x.l.nf);
      setLidas(ok);
      if (ok.length) await aplicar(ok[0]);
    } catch (e) { setMsg(`Não foi possível ler o PDF: ${(e as Error).message}`); } finally { setLendo(false); }
  };
  const mostraPdf = verPdf && !!atual && atual.arquivos.some((a) => urls.current.has(a));
  // NF de reposição (SAC) não traz OF no DANFE: lança sem OF
  const semOFnoDanfe = !!atual && !/BRM-\d+|^\s*OF\s*-\s*\d+/.test(atual.l.oc ?? '');
  const jaCadastrada = (nf: string | null) => nfsCad.dados.some((x) => x.numero === nf && (x.itens > 0 || x.recebida_em));

  const limpar = () => {
    setCab({ numero: '', emissao: '', of: '', romaneio: '', valor: '', peso: '' }); setQtd({}); setSemPar([]); setEscolha({});
    setLinha(''); setDestino(''); setTipo(''); setFiltroDesc(null); setMsg(null);
  };
  const fechar = async () => {
    const resto = lidas.filter((x) => x !== atual);
    limpar(); setAtual(null); setPdfAberto(null); setLidas(resto);
    const prox = resto.find((x) => !jaCadastrada(x.l.nf));
    if (prox) await aplicar(prox);
  };
  const fecharTodas = () => { limpar(); setAtual(null); setPdfAberto(null); setLidas([]); };
  const salvar = async () => {
    setOcupado(true); setMsg(null);
    try {
      const l = atual?.l;
      const probs = l ? problemasRomaneio(l) : [];
      const fica = (k: string) => difs.some((d) => d.k === k && lado(d) === 'cad');
      const ex = existente;
      let itensEnv = preenchidos.map((i) => ({ material_id: i.material_id, quantidade: n(qtd[i.material_id]) }));
      if (ex && comItens) {
        const m = new Map(itensCad);
        for (const d of difs) if (d.item && lado(d) === 'novo') m.set(d.item.material_id, d.item.novo);
        itensEnv = [...m].filter(([, q]) => q !== 0).map(([material_id, quantidade]) => ({ material_id, quantidade }));
      }
      await salvarNF({
        ...cab, valor: deBR(cab.valor), peso: deBR(cab.peso), linha, destino, lancamento: l ? 'pdf' : 'manual',
        ...(ex && fica('emissao') ? { emissao: ex.emissao ?? '' } : {}),
        ...(ex && fica('of') ? { of: ex.of_texto ?? '' } : {}),
        ...(ex && fica('romaneio') ? { romaneio: ex.romaneio ?? '' } : {}),
        ...(ex && fica('valor') ? { valor: String(ex.valor) } : {}),
        ...(ex && fica('peso') ? { peso: String(ex.peso) } : {}),
        ...(ex && fica('linha') ? { linha: ex.linha ?? '' } : {}),
        ...(ex && fica('destino') ? { destino: ex.destino ?? '' } : {}),
        substituir: !!ex && comItens,
        itens: itensEnv,
        ...(l ? { arquivo: atual!.arquivo, peso_danfe: l.peso_liquido, romaneio_itens: l.romaneio, romaneio_confere: !probs.length, romaneio_obs: probs.join('; ') } : {}),
      });
      setAviso({ id: Date.now(), texto: `NF ${cab.numero} ${existente && comItens ? 'atualizada' : 'cadastrada'}` });
      setCab({ numero: '', emissao: '', of: '', romaneio: '', valor: '', peso: '' }); setQtd({}); setSemPar([]);
      const prox = lidas.find((x) => x !== atual && x.l.nf !== cab.numero && !jaCadastrada(x.l.nf));
      setLidas((ls) => ls.filter((x) => x !== atual));
      setAtual(null); setPdfAberto(null);
      if (prox) await aplicar(prox);
    } catch (e) { setMsg(`Não foi possível: ${(e as Error).message}`); } finally { setOcupado(false); }
  };
  let secao = '';
  let parteAnt: string | null = null;
  return (
    <div className={`lancar conteudo ${arrastando ? 'arrastando' : ''} ${mostraPdf ? 'com-pdf' : ''}`}
         onDragOver={(e) => { e.preventDefault(); setArrastando(true); }} onDragLeave={() => setArrastando(false)}
         onDrop={(e) => { e.preventDefault(); setArrastando(false); lerArquivos([...e.dataTransfer.files]); }}>
      {slot && createPortal(
        <>
          {atual && <label className="chk"><input type="checkbox" checked={verPdf} onChange={(e) => setVerPdf(e.target.checked)} /> Ver PDF</label>}
          <label className={`bt-pdf ${lendo ? 'lendo' : ''}`}>
            {lendo ? 'Lendo…' : 'Ler PDF'}
            <input type="file" accept="application/pdf,.pdf" multiple hidden disabled={lendo}
                   onChange={(e) => { lerArquivos([...(e.target.files ?? [])]); e.target.value = ''; }} />
          </label>
        </>, slot)}
      <div className="lancar-esq">
      {lidas.length > 1 && (
        <div className="nfs-lidas">
          {lidas.map((x) => (
            <button key={`${x.arquivo}|${x.l.nf}`} className={`chip ${x === atual ? 'on' : ''} ${jaCadastrada(x.l.nf) ? 'feita' : ''}`} onClick={() => aplicar(x)}>NF {x.l.nf}</button>
          ))}
        </div>
      )}
      <div className="panel" style={{ padding: 12, marginBottom: 10 }}>
        <div className="campos">
          <label>Nota fiscal <input value={cab.numero} inputMode="numeric" onChange={(e) => setCab({ ...cab, numero: e.target.value.replace(/\D/g, '') })} /></label>
          <label>Data de emissão <input type="date" value={cab.emissao} onChange={(e) => setCab({ ...cab, emissao: e.target.value })} /></label>
          <label>Linha <select value={linha} onChange={(e) => { setLinha(e.target.value); setDestino(''); setQtd({}); setTipo(""); setFiltroDesc(null); setCab({ ...cab, of: '' }); }}>
            <option value="">—</option>{linhas.dados.map((l) => <option key={l.sigla} value={l.sigla}>{l.codigo} - {l.sigla}</option>)}</select></label>
          <label>Canteiro de destino <select value={destino} disabled={!linha} onChange={(e) => { setDestino(e.target.value); setQtd({}); setTipo(""); setFiltroDesc(null); }}>
            <option value="">—</option>{canteiros.map((c) => <option key={c}>{c}</option>)}
            {outros.length > 0 && <option disabled>──────────</option>}{outros.map((c) => <option key={c}>{c}</option>)}</select></label>
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
          <button className="pri" disabled={ocupado || !cab.numero || !destino || (!cab.of && !semOFnoDanfe) || !preenchidos.length || recebida
                                           || (comItens && !difs.some((d) => lado(d) === 'novo'))} onClick={salvar}>
            {comItens ? 'Atualizar NF' : 'Lançar como emitida'}</button>
          {(atual || cab.numero) && <button onClick={fechar}>Fechar NF</button>}
          {lidas.length > 1 && <button className="link" onClick={fecharTodas}>Fechar todas</button>}
        </div>
        {msg && <div className="callout" style={{ marginTop: 8 }}>{msg}</div>}
        {existente && (recebida || comItens) && !difs.length && (
          <div className="callout" style={{ marginTop: 8 }}>NF {existente.numero} já cadastrada{recebida ? `, recebida em ${data(existente.recebida_em)}` : ''}, sem diferenças</div>
        )}
      </div>
      {existente && difs.length > 0 && (
        <div className="panel comparacao">
          <table>
            <thead><tr><th>NF {existente.numero} já cadastrada{recebida ? ` · recebida em ${data(existente.recebida_em)}` : ''}</th><th>Cadastrado</th><th>Novo</th></tr></thead>
            <tbody>{difs.map((d) => (
              <tr key={d.k}>
                <td>{d.rotulo}</td>
                {(['cad', 'novo'] as const).map((o) => (
                  <td key={o} className={`opc ${lado(d) === o ? 'on' : ''} ${recebida ? 'trava' : ''}`}
                      onClick={() => !recebida && setEscolha((e) => ({ ...e, [d.k]: o }))}>{o === 'cad' ? d.cad : d.novo}</td>
                ))}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {semPar.length > 0 && (
        <div className="panel sem-par">
          <table>
            <thead><tr><th colSpan={3}>Romaneio sem correspondência no controle ({semPar.length})</th></tr></thead>
            <tbody>{semPar.map((r) => (
              <tr key={r.seq}><td className="r num">{r.seq}</td><td>{r.descricao}</td><td className="r num">{num(r.quantidade)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {slot && destino && createPortal(
        <label className="chk">Tipo <select value={tipo} onChange={(e) => { setTipo(e.target.value); setFiltroDesc(null); }}>
          <option value="">Todos</option>{tipos.map((t) => <option key={t}>{t}</option>)}</select></label>, slot)}
      {destino && (
        <div className="panel planilha lancar-grade">
          <table ref={cruz.ref} className="cruz" onMouseDown={cruz.onMouseDown} onMouseOver={cruz.onMouseOver} onMouseLeave={cruz.onMouseLeave}>
            <thead><tr className="tit">
              <th>{<FiltroColuna titulo="Descrição" valores={doTipo.map((i) => i.descricao)} selecionados={filtroDesc} aoMudar={setFiltroDesc} />}</th>
              <th className="r">Previsto</th><th className="r">Recebido</th><th className="nfcolh">{cab.numero ? `NF - ${cab.numero}` : '-'}</th>
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
      </div>
      {mostraPdf && atual && (
        <aside className="lancar-pdf panel">
          <div className="pdf-abas">
            {atual.arquivos.map((a) => <button key={a} className={a === pdfAberto ? 'on' : ''} onClick={() => setPdfAberto(a)}>{a.replace(/\.pdf$/i, '')}</button>)}
          </div>
          {pdfAberto && urls.current.get(pdfAberto) && <iframe key={pdfAberto} title={pdfAberto} src={urls.current.get(pdfAberto)} />}
        </aside>
      )}
      {aviso && <div key={aviso.id} className="aviso-flutuante">{aviso.texto}</div>}
    </div>
  );
}
