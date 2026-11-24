import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type Perfil = { id: string; nome: string; papel: 'editor' | 'leitor'; ativo: boolean };

type Estado =
  | { situacao: 'carregando' }
  | { situacao: 'anonimo' }
  | { situacao: 'logado'; sessao: Session; perfil: Perfil | null };

const SessaoContexto = createContext<Estado>({ situacao: 'carregando' });

export function SessaoProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>({ situacao: 'carregando' });

  useEffect(() => {
    let ativo = true;

    async function aplicar(sessao: Session | null) {
      if (!sessao) {
        if (ativo) setEstado({ situacao: 'anonimo' });
        return;
      }
      const { data } = await supabase
        .from('perfil')
        .select('id, nome, papel, ativo')
        .eq('id', sessao.user.id)
        .maybeSingle();
      if (ativo) setEstado({ situacao: 'logado', sessao, perfil: (data as Perfil) ?? null });
    }

    supabase.auth.getSession().then(({ data }) => aplicar(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, sessao) => {
      // adia para fora do callback do Supabase (evita travar o cliente)
      setTimeout(() => aplicar(sessao), 0);
    });
    return () => {
      ativo = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return <SessaoContexto.Provider value={estado}>{children}</SessaoContexto.Provider>;
}

export function useSessao() {
  return useContext(SessaoContexto);
}
