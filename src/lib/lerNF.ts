// Leitura do PDF digital da NF Brametal (DANFE + ROMANEIO) a partir do texto posicionado de cada página (pdf.js).
// Sem dependências: recebe as páginas já extraídas, para rodar igual no navegador e na conferência em Node.
// DANFE: número pela chave de acesso; demais campos pelo rótulo do quadro (valor logo abaixo, dentro do quadro).
// ROMANEIO: colunas pelo centro dos títulos; cada linha começa no nº sequencial; célula quebrada fica em volta da linha.

export type ItemTexto = { s: string; x: number; y: number; w: number };
export type Pagina = ItemTexto[];

export type LinhaRomaneio = {
  pagina: number; seq: number; remessa: string; ud: string; sku: string; lote: string | null; tipo_ud: string;
  ov: string; item_ov: string; descricao_pa: string; descricao: string; quantidade: number; peso_unit: number; peso_total: number;
};

export type LeituraNF = {
  erro?: string;
  nf: string | null; chave: string | null; emissao: string | null;
  oc: string | null; remessa: string | null; lt: string | null;
  valor: number | null; volumes: number | null; especie: string | null; peso_bruto: number | null; peso_liquido: number | null;
  municipio_entrega: string | null; endereco_entrega: string | null; municipio_destinatario: string | null;
  romaneio: LinhaRomaneio[]; peso_romaneio_rodape: number | null;
};

export const br = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
const limpo = (s: string) => s.replace(/\s+/g, ' ').trim();
const dataISO = (s: string | null) => {
  const m = s?.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

// Texto corrido da página: itens vizinhos na mesma altura juntam-se; o resto vira linha nova.
export function textoDaPagina(p: Pagina): string {
  let out = '';
  let ant: ItemTexto | null = null;
  for (const it of p) {
    if (ant && Math.abs(it.y - ant.y) < 1 && it.x - (ant.x + ant.w) < 2.5 && it.x >= ant.x) out += it.s;
    else out += (out ? '\n' : '') + it.s;
    ant = it;
  }
  return out.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() !== '').join('\n');
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

// Valor do quadro: item logo abaixo do rótulo, entre o início do rótulo e o próximo rótulo da mesma altura.
function abaixo(p: Pagina, rotulo: RegExp, filtro?: (r: ItemTexto) => boolean): string | null {
  const rots = p.filter((i) => rotulo.test(semAcento(limpo(i.s))) && (!filtro || filtro(i)));
  for (const r of rots) {
    const direita = p.filter((i) => Math.abs(i.y - r.y) < 1.5 && i.x > r.x + r.w + 1 && i.s.trim()).map((i) => i.x);
    const borda = direita.length ? Math.min(...direita) : Infinity;
    const cand = p.filter((i) => i.s.trim() && i.y < r.y - 2 && i.y > r.y - 14 && i.x + i.w / 2 >= r.x - 3 && i.x + i.w / 2 < borda)
      .sort((a, b) => b.y - a.y);
    if (cand.length) return limpo(cand.filter((i) => Math.abs(i.y - cand[0].y) < 1).sort((x, y) => x.x - y.x).map((i) => i.s).join(' '));
  }
  return null;
}

const COLUNAS = [
  ['remessa', /^Remessa$/], ['ud', /^UD$/], ['sku', /^SKU$/], ['lote', /^Lote$/], ['tipo_ud', /^Tipo$/], ['ov', /^Ordem$/],
  ['item_ov', /^Item$/], ['descricao_pa', /^Descri[çc][ãa]o PA$/], ['descricao', /^Descri[çc][ãa]o SKU$/], ['quantidade', /^Qtd\.?$/],
  ['peso_unit', /^Peso Unit/], ['peso_total', /^Peso Total$/],
] as const;
type Coluna = (typeof COLUNAS)[number][0];

// página de continuação (sem títulos das colunas) usa as colunas da página anterior
function lerRomaneio(p: Pagina, pagina: number, anterior: Map<Coluna, number> | null): { linhas: LinhaRomaneio[]; cab: Map<Coluna, number> | null } {
  let cab: Map<Coluna, number> | null = new Map<Coluna, number>();
  let yCab = -Infinity;
  for (const [c, re] of COLUNAS) {
    const h = p.find((i) => re.test(limpo(i.s)));
    if (!h) { cab = null; break; }
    cab.set(c, h.x + h.w / 2);
    yCab = Math.max(yCab, h.y);
  }
  if (!cab) {
    if (!anterior) return { linhas: [], cab: null };
    cab = anterior;
    const tit = p.find((i) => /^ROMANEIO/.test(i.s.trim()));
    yCab = (tit?.y ?? Infinity) - 6;
  }
  const centros = [...cab.entries()];
  const corpo = p.filter((i) => i.s.trim() && i.y < yCab - 12);
  const ancoras = corpo.filter((i) => i.x < 40 && /^\d+$/.test(i.s.trim())).sort((a, b) => b.y - a.y);
  const linhas: LinhaRomaneio[] = [];
  for (const a of ancoras) {
    const cel = new Map<Coluna, ItemTexto[]>();
    for (const i of corpo) {
      if (i === a || Math.abs(i.y - a.y) > 8) continue;
      // a linha mais próxima na vertical fica com o item (células quebradas em volta da linha)
      if (ancoras.some((o) => o !== a && Math.abs(i.y - o.y) < Math.abs(i.y - a.y))) continue;
      const cx = i.x + i.w / 2;
      const [col] = centros.reduce((m, c) => (Math.abs(c[1] - cx) < Math.abs(m[1] - cx) ? c : m));
      (cel.get(col) ?? cel.set(col, []).get(col)!).push(i);
    }
    const v = (c: Coluna) => limpo((cel.get(c) ?? []).sort((x, y) => y.y - x.y || x.x - y.x).map((i) => i.s).join(' '));
    const num = (c: Coluna) => (/^\d+(\.\d{3})*(,\d+)?$/.test(v(c)) ? br(v(c)) : NaN);
    if (!v('sku') || Number.isNaN(num('quantidade'))) continue;
    linhas.push({
      pagina, seq: Number(a.s.trim()), remessa: v('remessa').replace(/^0+/, ''), ud: v('ud'), sku: v('sku'), lote: v('lote') || null,
      tipo_ud: v('tipo_ud'), ov: v('ov'), item_ov: v('item_ov'), descricao_pa: v('descricao_pa'), descricao: v('descricao'),
      quantidade: num('quantidade'), peso_unit: num('peso_unit'), peso_total: num('peso_total'),
    });
  }
  return { linhas, cab };
}

// página de romaneio: título ROMANEIO no topo (não o "ROMANEIO:" das informações do DANFE Protheus)
const paginaDeRomaneio = (t: string) => /\bROMANEIO\b(?!:)/.test(t.slice(0, 200));

export function lerNF(paginas: Pagina[]): LeituraNF {
  const vazio: LeituraNF = {
    nf: null, chave: null, emissao: null, oc: null, remessa: null, lt: null, valor: null, volumes: null, especie: null,
    peso_bruto: null, peso_liquido: null, municipio_entrega: null, endereco_entrega: null, municipio_destinatario: null,
    romaneio: [], peso_romaneio_rodape: null,
  };
  const textos = paginas.map(textoDaPagina);
  const eRomaneio = paginaDeRomaneio;
  const danfeIdx = textos.map((t, i) => (eRomaneio(t) ? -1 : i)).filter((i) => i >= 0).slice(0, 2);
  const danfe = danfeIdx.map((i) => textos[i]).join('\n');
  if (danfe.replace(/\s/g, '').length < 50) return { ...vazio, erro: 'PDF só imagem' };
  const p1 = paginas[danfeIdx[0] ?? 0];
  const r: LeituraNF = { ...vazio };

  const ch = danfe.match(/(\d{4} \d{4} \d{4} \d{4} \d{4} \d{4} \d{4} \d{4} \d{4} \d{4} \d{4})/);
  if (ch) { r.chave = ch[1].replace(/ /g, ''); r.nf = String(Number(r.chave.slice(25, 34))); }
  else {
    const nf = danfe.match(/S[ÉE]RIE\n(\d+)\n/) ?? danfe.match(/N\. (\d+)\nS[ÉE]RIE/);
    r.nf = nf ? String(Number(nf[1])) : null;
  }
  const oc = danfe.match(/OC:\s*([\s\S]*?)\s+N[úu]mero Contrato/) ?? danfe.match(/(OF-[^\n]*?)\s+ROMANEIO:/);
  r.oc = oc ? limpo(oc[1]) : null;
  const rem = danfe.match(/REMESSA:\s*(\d+)/) ?? danfe.match(/ROMANEIO:\s*(\d+)/);
  r.remessa = rem ? rem[1].replace(/^0+/, '') : null;
  const lt = danfe.match(/(LT \d+ ?kV [^\n]*)/i);
  r.lt = lt ? limpo(lt[1]) : null;

  r.emissao = dataISO(abaixo(p1, /^DATA (DA|DE) EMISSAO$/));
  const valor = abaixo(p1, /^VALOR TOTAL DA NOTA$/);
  r.valor = valor && /^[\d.]+,\d+$/.test(valor) ? br(valor) : null;
  const vol = abaixo(p1, /^QUANTIDADE$/);
  r.volumes = vol && /^\d+$/.test(vol) ? Number(vol) : null;
  r.especie = abaixo(p1, /^ESPECIE$/);
  const pb = abaixo(p1, /^PESO BRUTO$/);
  r.peso_bruto = pb && /^[\d.]*\d(,\d+)?$/.test(pb) ? br(pb) : null;
  const pl = abaixo(p1, /^PESO LIQUIDO$/);
  r.peso_liquido = pl && /^[\d.]*\d(,\d+)?$/.test(pl) ? br(pl) : null;

  // destinatário: o primeiro quadro MUNICÍPIO (mais alto da página); local de entrega: quadro abaixo do título próprio (SAP)
  // ou texto "Endereco de Entrega: … Municipio: X, UF" nas informações complementares (Protheus)
  const munis = p1.filter((i) => /^MUNICIPIO$/.test(semAcento(limpo(i.s)))).sort((a, b) => b.y - a.y);
  if (munis.length) r.municipio_destinatario = abaixo(p1, /^MUNICIPIO$/, (i) => i === munis[0]);
  const tituloEntrega = p1.find((i) => /LOCAL DE ENTREGA/.test(semAcento(i.s)));
  if (tituloEntrega) {
    const dentro = (i: ItemTexto) => i.y < tituloEntrega.y && i.y > tituloEntrega.y - 60;
    r.municipio_entrega = abaixo(p1, /^MUNICIPIO$/, dentro);
    r.endereco_entrega = abaixo(p1, /^ENDERECO$/, dentro);
  } else {
    const e = danfe.replace(/\n/g, ' ').match(/Endere[çc]o de Entrega:\s*(.*?)\s*Bairro:.*?Munic[ií]pio:\s*([^,]+),/i);
    if (e) { r.endereco_entrega = limpo(e[1]); r.municipio_entrega = limpo(e[2]); }
  }

  let cab: Map<Coluna, number> | null = null;
  paginas.forEach((p, i) => {
    if (!eRomaneio(textos[i])) return;
    const l = lerRomaneio(p, i + 1, cab);
    r.romaneio.push(...l.linhas);
    cab = l.cab ?? cab;
  });
  // só a remessa da própria NF; com romaneios de várias remessas e nenhuma igual, nada (não mistura com outras NFs)
  if (r.remessa && r.romaneio.some((i) => i.remessa === r.remessa)) r.romaneio = r.romaneio.filter((i) => i.remessa === r.remessa);
  else if (new Set(r.romaneio.map((i) => i.remessa)).size > 1) r.romaneio = [];
  const rod = textos.filter(eRomaneio).join('\n').match(/Peso Total \(Kg\):\s*\n?([\d.]+,\d+)/);
  r.peso_romaneio_rodape = rod ? br(rod[1]) : null;
  return r;
}

// Problemas que impedem usar o romaneio (vazio = confere): sequência completa e soma do peso = peso líquido do DANFE.
export function problemasRomaneio(x: LeituraNF): string[] {
  const it = x.romaneio;
  if (!it.length) return ['romaneio não lido'];
  const probs: string[] = [];
  const seq = it.map((i) => i.seq).sort((a, b) => a - b);
  if (seq.some((s, k) => s !== k + 1)) probs.push(`sequência do romaneio com buracos (${seq.length} linhas, última ${seq[seq.length - 1]})`);
  const soma = it.reduce((s, i) => s + i.peso_total, 0);
  const umaRemessa = new Set(it.map((i) => i.remessa)).size === 1;
  if (x.peso_liquido === null) {
    // sem peso no DANFE (ex. NFs de SAC): vale o total do rodapé do romaneio, se o romaneio é só desta remessa
    if (!(umaRemessa && x.peso_romaneio_rodape !== null && Math.abs(soma - x.peso_romaneio_rodape) <= 0.05)) probs.push('peso do DANFE não lido');
  }
  else if (Math.abs(soma - x.peso_liquido) > 0.05) probs.push(`soma do romaneio ${soma.toFixed(3)} kg × DANFE ${x.peso_liquido.toFixed(3)} kg`);
  return probs;
}

// PDF com várias NFs (lote do e-mail): uma leitura por chave de acesso; cada NF usa as próprias páginas de DANFE e as
// páginas de romaneio do arquivo (filtradas pela remessa da NF dentro de lerNF).
export function lerNFs(paginas: Pagina[]): LeituraNF[] {
  const textos = paginas.map(textoDaPagina);
  const romaneio = paginaDeRomaneio;
  const grupos = new Map<string, number[]>();
  let k = '';  // página de DANFE sem chave (continuação) fica com a NF anterior
  textos.forEach((t, i) => {
    if (romaneio(t)) return;
    const ch = t.match(/\d{4} \d{4} \d{4} \d{4} \d{4} \d{4} \d{4} \d{4} \d{4} \d{4} \d{4}/);
    if (ch) k = ch[0];
    (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(i);
  });
  const roms = textos.map((t, i) => (romaneio(t) ? i : -1)).filter((i) => i >= 0);
  if (grupos.size <= 1) return [lerNF(paginas)];
  return [...grupos.values()].map((ps) => lerNF([...ps, ...roms].map((i) => paginas[i])));
}

// Vários arquivos de uma vez (como chegam no e-mail: "NF 261733.PDF" + "ROMANEIO 80072537.PDF"): cada NF de qualquer arquivo
// usa as páginas de romaneio de TODOS os arquivos, filtradas pela remessa do seu DANFE. Arquivo só de romaneio não vira NF.
export type ArquivoLido = { nome: string; paginas: Pagina[] };
export type NFLida = { arquivo: string; l: LeituraNF; arquivos: string[] };
export function lerNFsDeArquivos(arqs: ArquivoLido[]): NFLida[] {
  const roms: { nome: string; p: Pagina; t: string }[] = [];
  for (const a of arqs) for (const p of a.paginas) { const t = textoDaPagina(p); if (paginaDeRomaneio(t)) roms.push({ nome: a.nome, p, t }); }
  const out: NFLida[] = [];
  for (const a of arqs) {
    const danfes = a.paginas.filter((p) => !paginaDeRomaneio(textoDaPagina(p)));
    if (!danfes.length) continue;
    for (const l of lerNFs([...danfes, ...roms.map((r) => r.p)])) {
      const deRomaneio = l.remessa ? [...new Set(roms.filter((r) => new RegExp(`(^|\\D)0*${l.remessa}(\\D|$)`).test(r.t)).map((r) => r.nome))] : [];
      out.push({ arquivo: a.nome, l, arquivos: [a.nome, ...deRomaneio.filter((n) => n !== a.nome)] });
    }
  }
  return out;
}
