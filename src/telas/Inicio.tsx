import { useMemo } from 'react';
import { Link } from 'react-router';
import { useTorres } from '../dados/torres';
import './Inicio.css';

type Bloco = { linha: string; canteiros: { nome: string; total: number; tipos: [string, number][] }[]; total: number };

export function Inicio() {
  const { torres, carregando, erro } = useTorres();

  const blocos = useMemo<Bloco[]>(() => {
    const porLinha = new Map<string, Map<string, Map<string, number>>>();
    for (const t of torres) {
      const c = t.canteiro ?? '(sem canteiro)';
      const linha = porLinha.get(t.linha_sigla) ?? new Map();
      const cant = linha.get(c) ?? new Map<string, number>();
      cant.set(t.tipo, (cant.get(t.tipo) ?? 0) + 1);
      linha.set(c, cant);
      porLinha.set(t.linha_sigla, linha);
    }
    return [...porLinha].map(([linha, cants]) => {
      const canteiros = [...cants].map(([nome, tipos]) => {
        const lista = [...tipos].sort((a, b) => b[1] - a[1]);
        return { nome, tipos: lista, total: lista.reduce((s, [, n]) => s + n, 0) };
      });
      return { linha, canteiros, total: canteiros.reduce((s, c) => s + c.total, 0) };
    });
  }, [torres]);

  if (carregando) return <p className="suave">Carregando torres…</p>;
  if (erro) return <p className="erro">Não foi possível carregar as torres: {erro}</p>;

  return (
    <div className="inicio">
      <h1>Obra</h1>
      <p className="suave">Torres da Lista de Construção por canteiro, conforme a distribuição oficial.</p>
      {blocos.map((b) => (
        <section key={b.linha} className="inicio-linha">
          <h2>{b.linha} <span className="suave num">{b.total} torres</span></h2>
          <div className="inicio-canteiros">
            {b.canteiros.map((c) => (
              <Link key={c.nome} className="inicio-canteiro"
                    to={`/torres?linha=${b.linha}&canteiro=${encodeURIComponent(c.nome)}`}>
                <strong>{c.nome}</strong>
                <span className="num">{c.total}</span>
                <small className="suave">{c.tipos.map(([t, n]) => `${t} ${n}`).join(' · ')}</small>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
