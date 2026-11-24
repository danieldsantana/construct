import { useEffect, type ReactNode } from 'react';

// Ficha lateral: abre por cima da lista, sem perder o lugar. Esc fecha.
export function Gaveta({ aberta, aoFechar, sub, titulo, resumo, children, acoes }: {
  aberta: boolean;
  aoFechar: () => void;
  sub: string;
  titulo: ReactNode;
  resumo?: [string, ReactNode][];
  children: ReactNode;
  acoes?: ReactNode;
}) {
  useEffect(() => {
    if (!aberta) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar(); };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [aberta, aoFechar]);
  return (
    <aside className={`drawer ${aberta ? 'on' : ''}`} aria-hidden={!aberta} aria-label="Ficha">
      {aberta && (
        <>
          <div className="dr-h">
            <button className="x" onClick={aoFechar} aria-label="Fechar ficha">✕</button>
            <span className="sub">{sub}</span>
            <h1>{titulo}</h1>
          </div>
          {resumo && (
            <div className="dr-sum">
              {resumo.map(([a, b]) => <div key={a}><span className="muted">{a}</span><b>{b}</b></div>)}
            </div>
          )}
          <div className="dr-body">{children}</div>
          {acoes && <div className="dr-foot">{acoes}</div>}
        </>
      )}
    </aside>
  );
}
