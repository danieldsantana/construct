import type { ReactNode } from 'react';
import { useEscopo } from '../lib/escopo';

// Faixa laranja de título, como no topo das abas do controle.
export function Titulo({ texto, children }: { texto: string; children?: ReactNode }) {
  const { nome } = useEscopo();
  return (
    <div className="titulo">
      <h1>{texto}</h1>
      <span className="sub">{nome}</span>
      <span className="grow" />
      {children}
    </div>
  );
}

export function Abas<T extends string>({ abas, atual, aoMudar }: { abas: [T, string][]; atual: T; aoMudar: (a: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {abas.map(([k, v]) => (
        <button key={k} role="tab" aria-selected={atual === k} className={atual === k ? 'on' : ''} onClick={() => aoMudar(k)}>{v}</button>
      ))}
    </div>
  );
}

export function Porcentagem({ valor, ok }: { valor: number; ok?: boolean }) {
  const p = Math.max(0, Math.min(1, valor || 0));
  return (
    <div className="pct">
      <div className={`bar ${ok ? 'ok' : ''}`}><i style={{ width: `${p * 100}%` }} /></div>
      <span className="num">{Math.round(p * 100)}%</span>
    </div>
  );
}
