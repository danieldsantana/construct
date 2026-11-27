import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// A API do Supabase devolve no máximo 1000 linhas por chamada: busca em páginas até acabar.
export async function buscarTudo<T>(tabela: string, select: string, ordem: string[]): Promise<T[]> {
  const passo = 1000;
  const out: T[] = [];
  for (let de = 0; ; de += passo) {
    let q = supabase.from(tabela).select(select).range(de, de + passo - 1);
    for (const o of ordem) q = q.order(o);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const linhas = (data ?? []) as T[];
    out.push(...linhas);
    if (linhas.length < passo) break;
  }
  return out;
}

type Estado<T> = { dados: T[]; carregando: boolean; erro: string | null };
const cache = new Map<string, unknown[]>();
const emAndamento = new Map<string, Promise<unknown[]>>();

// Depois de um lançamento (NF, recebimento, confirmação…): limpa o cache e avisa as telas abertas para buscar de novo.
let versao = 0;
const ouvintes = new Set<() => void>();
let ultimaRecarga = Date.now();
export function recarregarDados() {
  cache.clear();
  emAndamento.clear();
  versao += 1;
  ultimaRecarga = Date.now();
  ouvintes.forEach((f) => f());
}

// Outra aba (ou outra pessoa) pode ter lançado algo: ao voltar para esta aba, busca de novo (no máximo a cada 20 s).
if (typeof window !== 'undefined') {
  const aoVoltar = () => { if (document.visibilityState === 'visible' && Date.now() - ultimaRecarga > 20000) recarregarDados(); };
  window.addEventListener('focus', aoVoltar);
  document.addEventListener('visibilitychange', aoVoltar);
}

// Carrega uma tabela/consulta inteira uma vez por sessão; filtros e buscas rodam no navegador.
export function useTabela<T>(tabela: string, select: string, ordem: string[]): Estado<T> {
  const chave = `${tabela}|${select}|${ordem.join(',')}`;
  const [v, setV] = useState(versao);
  const [estado, setEstado] = useState<Estado<T>>(() => {
    const c = cache.get(chave) as T[] | undefined;
    return { dados: c ?? [], carregando: !c, erro: null };
  });
  useEffect(() => {
    const f = () => setV(versao);
    ouvintes.add(f);
    return () => { ouvintes.delete(f); };
  }, []);
  useEffect(() => {
    const c = cache.get(chave) as T[] | undefined;
    if (c) { setEstado({ dados: c, carregando: false, erro: null }); return; }
    let ativo = true;
    let p = emAndamento.get(chave) as Promise<T[]> | undefined;
    if (!p) {
      p = buscarTudo<T>(tabela, select, ordem);
      emAndamento.set(chave, p);
    }
    p.then((dados) => {
      cache.set(chave, dados);
      emAndamento.delete(chave);
      if (ativo) setEstado({ dados, carregando: false, erro: null });
    }).catch((e: Error) => {
      emAndamento.delete(chave);
      if (ativo) setEstado({ dados: [], carregando: false, erro: e.message });
    });
    return () => { ativo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, v]);
  return estado;
}
