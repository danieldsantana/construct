import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export type Torre = {
  id: number;
  linha_id: number;
  linha_sigla: string;
  numero: string;
  ordem: number;
  tipo: string;
  categoria: 'estaiada' | 'autoportante';
  altura_util: number;
  extensao: number | null;
  perna_a: number | null;
  perna_b: number | null;
  perna_c: number | null;
  perna_d: number | null;
  perna_referencia: string | null;
  canteiro_id: number | null;
  canteiro: string | null;
};

type Resultado = { torres: Torre[]; carregando: boolean; erro: string | null };

// Carrega todas as torres uma vez (≈800 linhas); filtros e buscas rodam no navegador, sem esperar o banco.
let cache: Torre[] | null = null;

export function useTorres(): Resultado {
  const [estado, setEstado] = useState<Resultado>({
    torres: cache ?? [],
    carregando: cache === null,
    erro: null,
  });

  useEffect(() => {
    if (cache) return;
    let ativo = true;
    supabase
      .from('torre_detalhe')
      .select('id, linha_id, linha_sigla, numero, ordem, tipo, categoria, altura_util, extensao, perna_a, perna_b, perna_c, perna_d, perna_referencia, canteiro_id, canteiro')
      .order('linha_sigla')
      .order('ordem')
      .range(0, 4999)
      .then(({ data, error }) => {
        if (!ativo) return;
        if (error) {
          setEstado({ torres: [], carregando: false, erro: error.message });
          return;
        }
        cache = (data ?? []) as Torre[];
        setEstado({ torres: cache, carregando: false, erro: null });
      });
    return () => {
      ativo = false;
    };
  }, []);

  return estado;
}

export function formatarMetros(v: number | null) {
  return v === null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
