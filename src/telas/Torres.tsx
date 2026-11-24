import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { formatarMetros, useTorres, type Torre } from '../dados/torres';
import './Torres.css';

// Filtros ficam na URL: dá para voltar, recarregar ou mandar o link com o mesmo recorte.
export function Torres() {
  const { torres, carregando, erro } = useTorres();
  const [params, setParams] = useSearchParams();
  const linha = params.get('linha') ?? '';
  const canteiro = params.get('canteiro') ?? '';
  const tipos = (params.get('tipos') ?? '').split(',').filter(Boolean);
  const busca = params.get('q') ?? '';

  function mudar(chave: string, valor: string) {
    const p = new URLSearchParams(params);
    if (valor) p.set(chave, valor); else p.delete(chave);
    if (chave === 'linha') p.delete('canteiro');
    setParams(p, { replace: true });
  }

  function alternarTipo(tipo: string) {
    const novo = tipos.includes(tipo) ? tipos.filter((t) => t !== tipo) : [...tipos, tipo];
    mudar('tipos', novo.join(','));
  }

  const linhas = useMemo(() => [...new Set(torres.map((t) => t.linha_sigla))], [torres]);
  const canteiros = useMemo(
    () => [...new Set(torres.filter((t) => !linha || t.linha_sigla === linha).map((t) => t.canteiro ?? ''))].filter(Boolean),
    [torres, linha],
  );
  const doRecorte = useMemo(
    () => torres.filter((t) => (!linha || t.linha_sigla === linha) && (!canteiro || t.canteiro === canteiro)),
    [torres, linha, canteiro],
  );
  const contagemTipos = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of doRecorte) m.set(t.tipo, (m.get(t.tipo) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [doRecorte]);
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return doRecorte.filter((t) => (tipos.length === 0 || tipos.includes(t.tipo)) && (!q || t.numero.startsWith(q)));
  }, [doRecorte, tipos, busca]);

  if (carregando) return <p className="suave">Carregando torres…</p>;
  if (erro) return <p className="erro">Não foi possível carregar as torres: {erro}</p>;

  return (
    <div className="torres">
      <div className="torres-cabeca">
        <h1>Torres</h1>
        <span className="suave num">{visiveis.length} de {torres.length}</span>
      </div>

      <div className="torres-filtros">
        <div className="seg" role="group" aria-label="Linha">
          <button aria-pressed={!linha} onClick={() => mudar('linha', '')}>Todas</button>
          {linhas.map((l) => (
            <button key={l} aria-pressed={linha === l} onClick={() => mudar('linha', l)}>{l}</button>
          ))}
        </div>
        <select aria-label="Canteiro" value={canteiro} onChange={(e) => mudar('canteiro', e.target.value)}>
          <option value="">Todos os canteiros</option>
          {canteiros.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="search" aria-label="Buscar torre" placeholder="Buscar torre (ex. 8/2)" value={busca}
               onChange={(e) => mudar('q', e.target.value)} />
      </div>

      <div className="torres-tipos" role="group" aria-label="Tipos de torre">
        {contagemTipos.map(([t, n]) => (
          <button key={t} aria-pressed={tipos.includes(t)} onClick={() => alternarTipo(t)}>
            {t} <span className="num">{n}</span>
          </button>
        ))}
        {tipos.length > 0 && <button className="limpar" onClick={() => mudar('tipos', '')}>Limpar tipos</button>}
      </div>

      <div className="torres-tabela">
        <table>
          <thead>
            <tr>
              <th>Linha</th><th>Torre</th><th>Tipo</th><th className="num">Altura (m)</th>
              <th className="num">Extensão</th><th>Pernas A/B/C/D</th><th>Canteiro</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((t) => <Linha key={t.id} t={t} />)}
          </tbody>
        </table>
        {visiveis.length === 0 && <p className="suave">Nenhuma torre neste recorte.</p>}
      </div>
    </div>
  );
}

function Linha({ t }: { t: Torre }) {
  const pernas = [t.perna_a, t.perna_b, t.perna_c, t.perna_d];
  const temPernas = pernas.some((p) => p !== null);
  return (
    <tr>
      <td>{t.linha_sigla}</td>
      <td className="num">{t.numero}</td>
      <td>{t.tipo} <span className="suave">{t.categoria === 'estaiada' ? 'estaiada' : 'autoportante'}</span></td>
      <td className="num">{formatarMetros(t.altura_util)}</td>
      <td className="num">{formatarMetros(t.extensao)}</td>
      <td className="num">
        {temPernas
          ? pernas.map((p, i) => (
              <span key={i} className={'ABCD'[i] === t.perna_referencia ? 'ref' : undefined}>
                {i > 0 && ' / '}{formatarMetros(p)}
              </span>
            ))
          : <span className="suave">—</span>}
      </td>
      <td>{t.canteiro ?? <span className="suave">—</span>}</td>
    </tr>
  );
}
