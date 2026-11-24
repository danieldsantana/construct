import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { formatarMetros, useTorres, type Torre } from '../dados/torres';
import { useEscopo } from '../lib/escopo';
import { Titulo } from '../componentes/Titulo';
import './Torres.css';

// Linha e canteiro vêm do escopo (barra do topo); tipo, busca e tramo ficam na URL.
export function Torres() {
  const { torres, carregando, erro } = useTorres();
  const { inclui } = useEscopo();
  const [params, setParams] = useSearchParams();
  const tipos = (params.get('tipos') ?? '').split(',').filter(Boolean);
  const busca = params.get('q') ?? '';
  const tramo = params.get('tramo') ?? '';

  function mudar(chave: string, valor: string) {
    const p = new URLSearchParams(params);
    if (valor) p.set(chave, valor); else p.delete(chave);
    setParams(p, { replace: true });
  }

  function alternarTipo(tipo: string) {
    const novo = tipos.includes(tipo) ? tipos.filter((t) => t !== tipo) : [...tipos, tipo];
    mudar('tipos', novo.join(','));
  }

  const doRecorte = useMemo(
    () => torres.filter((t) => t.canteiro && inclui(t.linha_sigla, t.canteiro)),
    [torres, inclui],
  );
  const contagemTipos = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of doRecorte) m.set(t.tipo, (m.get(t.tipo) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [doRecorte]);
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return doRecorte.filter((t) =>
      (tipos.length === 0 || tipos.includes(t.tipo)) &&
      (!q || t.numero.startsWith(q)) &&
      (!tramo || `${t.linha_sigla}-${t.tramo}` === tramo));
  }, [doRecorte, tipos, busca, tramo]);

  if (carregando) return <><Titulo texto="Torres" /><p className="muted">Carregando torres…</p></>;
  if (erro) return <><Titulo texto="Torres" /><p className="warn">Não foi possível carregar as torres: {erro}</p></>;

  return (
    <div className="torres">
      <Titulo texto="Torres"><span className="num">{visiveis.length} de {doRecorte.length}</span></Titulo>

      <div className="torres-filtros">
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
        {tramo && (
          <button className="limpar" onClick={() => mudar('tramo', '')}>
            Tramo {tramo.split('-')[1]} de {tramo.split('-')[0]} ✕
          </button>
        )}
      </div>

      <div className="torres-tabela">
        <table>
          <thead>
            <tr>
              <th>Linha</th><th className="num">Tramo</th><th>Torre</th><th>Tipo</th><th className="num">Altura (m)</th>
              <th className="num">Extensão</th><th>Pernas A/B/C/D</th><th>Canteiro</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((t) => (
              <Linha key={t.id} t={t} aoEscolherTramo={() => mudar('tramo', `${t.linha_sigla}-${t.tramo}`)} />
            ))}
          </tbody>
        </table>
        {visiveis.length === 0 && <p className="suave">Nenhuma torre neste recorte.</p>}
      </div>
    </div>
  );
}

function Linha({ t, aoEscolherTramo }: { t: Torre; aoEscolherTramo: () => void }) {
  const pernas = [t.perna_a, t.perna_b, t.perna_c, t.perna_d];
  const temPernas = pernas.some((p) => p !== null);
  return (
    <tr className={t.ancoragem ? 'ancoragem' : undefined}>
      <td>{t.linha_sigla}</td>
      <td className="num">
        <button className="tramo" onClick={aoEscolherTramo} title="Ver só este tramo">{t.tramo}</button>
      </td>
      <td className="num">{t.numero}</td>
      <td>
        {t.tipo} <span className="suave">{t.categoria}</span>
        {t.ancoragem && <span className="marca" title={t.arranjo_ferragens ?? ''}>ancoragem</span>}
      </td>
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
