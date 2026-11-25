import { NavLink, Outlet } from 'react-router';
import { supabase } from '../lib/supabase';
import { useSessao } from '../lib/sessao';
import { BarraEscopo } from '../componentes/BarraEscopo';
import { Entrar } from './Entrar';

const MENUS: [string, string][] = [
  ['/', 'Início'],
  ['/lista', 'Lista'],
  ['/mapa', 'Mapa'],
  ['/notas', 'Notas fiscais'],
  ['/estoque', 'Estoque'],
  ['/ofs', 'OFs'],
  ['/rncs', 'RNCs'],
];

export function Moldura() {
  const estado = useSessao();

  if (estado.situacao === 'carregando') return <p className="muted" style={{ padding: 24 }}>Carregando…</p>;
  if (estado.situacao === 'anonimo') return <Entrar />;

  const { perfil } = estado;
  if (!perfil || !perfil.ativo) {
    return (
      <div style={{ padding: 40, display: 'grid', gap: 16, justifyItems: 'start' }}>
        <p>Seu acesso ainda não foi liberado. Peça ao administrador para ativar seu perfil.</p>
        <button onClick={() => supabase.auth.signOut()}>Sair</button>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="top">
        <span className="brand">CONSTRUCT</span>
        <span className="who">{perfil.nome} · {perfil.papel === 'editor' ? 'edição' : 'leitura'}</span>
        <button className="goto" style={{ flex: '0 0 auto' }} onClick={() => supabase.auth.signOut()}>Sair</button>
      </header>
      <BarraEscopo />
      <nav className="side" aria-label="Menu principal">
        {MENUS.map(([to, nome]) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'on' : '')}>{nome}</NavLink>
        ))}
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
