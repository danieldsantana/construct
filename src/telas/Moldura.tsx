import { NavLink, Outlet } from 'react-router';
import { supabase } from '../lib/supabase';
import { useSessao } from '../lib/sessao';
import { Entrar } from './Entrar';
import './Moldura.css';

export function Moldura() {
  const estado = useSessao();

  if (estado.situacao === 'carregando') return <p className="moldura-aviso suave">Carregando…</p>;
  if (estado.situacao === 'anonimo') return <Entrar />;

  const { perfil } = estado;
  if (!perfil || !perfil.ativo) {
    return (
      <div className="moldura-aviso">
        <p>Seu acesso ainda não foi liberado. Peça ao administrador para ativar seu perfil.</p>
        <button onClick={() => supabase.auth.signOut()}>Sair</button>
      </div>
    );
  }

  return (
    <div className="moldura">
      <header className="moldura-topo">
        <strong>Construct</strong>
        <nav>
          <NavLink to="/" end>Início</NavLink>
          <NavLink to="/torres">Torres</NavLink>
        </nav>
        <span className="moldura-usuario suave">
          {perfil.nome} · {perfil.papel === 'editor' ? 'edição' : 'leitura'}
        </span>
        <button onClick={() => supabase.auth.signOut()}>Sair</button>
      </header>
      <main className="moldura-conteudo">
        <Outlet />
      </main>
    </div>
  );
}
