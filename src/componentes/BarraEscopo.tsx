import { useMemo } from 'react';
import { useEscopo } from '../lib/escopo';
import { useTorres } from '../dados/torres';

// Barra de escopo em botões: ★ Meu escopo · Linha · Canteiro (canteiros na ordem da linha; "Todas"/"Todos" no fim).
export function BarraEscopo() {
  const { escopo, setEscopo } = useEscopo();
  const { torres } = useTorres();

  const { linhas, canteirosDe } = useMemo(() => {
    const ordem = new Map<string, Map<string, number>>();
    for (const t of torres) {
      if (!t.canteiro) continue;
      const m = ordem.get(t.linha_sigla) ?? new Map<string, number>();
      m.set(t.canteiro, Math.min(m.get(t.canteiro) ?? Infinity, t.ordem));
      ordem.set(t.linha_sigla, m);
    }
    const canteirosDe = (l: string) => [...(ordem.get(l) ?? new Map()).entries()].sort((a, b) => a[1] - b[1]).map(([c]) => c);
    return { linhas: [...ordem.keys()].sort(), canteirosDe };
  }, [torres]);

  const canteiros = escopo.linha ? canteirosDe(escopo.linha) : [...new Set(linhas.flatMap(canteirosDe))];
  const mudar = (parcial: Partial<typeof escopo>) => setEscopo({ ...escopo, meu: false, ...parcial });

  return (
    <div className="scopebar" role="group" aria-label="Escopo: linha e canteiro">
      <button className={`meu ${escopo.meu ? 'on' : ''}`} onClick={() => setEscopo({ ...escopo, meu: !escopo.meu })}
              title="T4 inteiro + Laje dos Negros e Umburanas do T3">★ Meu escopo</button>
      <span className="scope-sep" />
      <div className="seg-grupo">
        <span>Linha</span>
        <div className="seg">
          {[...linhas.map((l) => [l, l]), ['', 'Todas']].map(([v, t]) => (
            <button key={v} className={!escopo.meu && escopo.linha === v ? 'on' : ''}
                    onClick={() => mudar({ linha: v, canteiro: v && escopo.canteiro && !canteirosDe(v).includes(escopo.canteiro) ? '' : escopo.canteiro })}>{t}</button>
          ))}
        </div>
      </div>
      <div className="seg-grupo">
        <span>Canteiro</span>
        <div className="seg">
          {[...canteiros.map((c) => [c, c]), ['', 'Todos']].map(([v, t]) => (
            <button key={v} className={!escopo.meu && escopo.canteiro === v ? 'on' : ''} onClick={() => mudar({ canteiro: v })}>{t}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
