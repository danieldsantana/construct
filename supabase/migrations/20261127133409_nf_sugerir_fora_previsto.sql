-- nf_sugerir_itens: peça controlada (para-raios, calota, pino) que o controle do destino não prevê (ex.: PR ANCORAGEM POS 3 - C4EP no T3
-- Laje dos Negros) ainda é sugerido quando o item existe em outro controle e é único; a tela mostra a linha com previsto 0.

create or replace function public.nf_sugerir_itens(p_linha text, p_canteiro text, p_itens jsonb)
returns table (seq integer, material_id integer, como text)
language sql stable security invoker as $$
  with par as (
    select l.id as lin, c.id as can from public.linha l, public.canteiro c where l.sigla = p_linha and c.nome = p_canteiro
  ),
  prev as (  -- materiais previstos no destino; se o destino não é do trecho, os da linha toda
    select distinct p.material_id from public.previsto p, par
    where p.linha_id = par.lin and p.quantidade > 0
      and (p.canteiro_id = par.can or not exists (select 1 from public.previsto q where q.linha_id = par.lin and q.canteiro_id = par.can and q.quantidade > 0))
  ),
  it as (
    select (i->>'seq')::int as seq, i->>'sku' as sku, i->>'descricao' as descricao, coalesce(i->>'descricao_pa', '') as pa,
           nullif(i->>'peso_unit', '')::numeric as peso,
           (regexp_match(coalesce(i->>'descricao_pa', ''), '-\s*(C4[A-Z0-9]+|BCTV)\s*$'))[1] as tipo,
           public.chave_parte(regexp_replace(regexp_replace(coalesce(i->>'descricao_pa', ''), '^TORRE\s+', ''), '\s*-\s*(C4[A-Z0-9]+|BCTV)\s*$', '')) as parte,
           (regexp_match(i->>'descricao', '\(?V(\d+)/(\d+)'))[1]::int as k,
           (regexp_match(i->>'descricao', '\(?V(\d+)/(\d+)'))[2]::int as n
    from jsonb_array_elements(p_itens) i
  ),
  -- volume da matriz: pelo SKU; senão por tipo + parte + k/N + peso
  vm as (
    select it.seq, coalesce(
      (select sv.volume_matriz_id from public.sku_volume sv where sv.sku = it.sku),
      (select min(v.id) from public.volume_matriz v
       where v.tipo_torre = it.tipo and public.chave_parte(v.parte) = it.parte and v.ordem = it.k and v.total = it.n
         and it.peso is not null and abs(v.peso - it.peso) <= greatest(0.05, 0.002 * v.peso)
       having count(*) = 1)) as vid,
      exists (select 1 from public.sku_volume sv where sv.sku = it.sku) as por_sku
    from it
  ),
  vol as (  -- volume: só materiais previstos no destino (o controle do destino pode ter o mesmo volume com outro nome, sem ligação)
    select vm.seq, array_agg(distinct m.id) as mats
    from vm join public.material m on m.volume_matriz_id = vm.vid join prev on prev.material_id = m.id
    group by vm.seq
  ),
  pec as (  -- idem para para-raios, calota e pino (ex.: PR ANCORAGEM POS 3 que o controle do destino não lista)
    select it.seq, coalesce(array_agg(m.id) filter (where pv.material_id is not null), array_agg(m.id)) as mats
    from it join public.material m on public.chave_peca(m.secao, m.descricao) = public.chave_peca(it.pa, it.descricao)
    left join prev pv on pv.material_id = m.id
    where public.chave_peca(it.pa, it.descricao) is not null
    group by it.seq
  ),
  fix as (
    select it.seq,
      coalesce(
        (select array_agg(m.id) from public.material m join prev on prev.material_id = m.id
         where m.secao = 'FIXADORES STUB - ' || (regexp_match(it.pa, 'STUB - (\S+)'))[1]
           and public.chave_fixador(m.descricao) = public.chave_fixador(it.descricao)),
        (select array_agg(m.id) from public.material m join prev on prev.material_id = m.id
         where m.secao = 'FIXADORES' and public.chave_fixador(m.descricao) = public.chave_fixador(it.descricao))) as mats
    from it where public.chave_fixador(it.descricao) is not null
  )
  select it.seq,
    case when cardinality(vol.mats) = 1 then vol.mats[1] when cardinality(pec.mats) = 1 then pec.mats[1]
         when cardinality(fix.mats) = 1 then fix.mats[1] end,
    case when cardinality(vol.mats) = 1 then 'volume' when cardinality(pec.mats) = 1 then 'peca_controlada'
         when cardinality(fix.mats) = 1 then 'fixador'
         when cardinality(vol.mats) > 1 or cardinality(pec.mats) > 1 or cardinality(fix.mats) > 1 then 'ambiguo'
         when it.descricao ~ '^POS ' then 'peca' else 'sem' end
  from it left join vol on vol.seq = it.seq left join pec on pec.seq = it.seq left join fix on fix.seq = it.seq
  order by it.seq
$$;
