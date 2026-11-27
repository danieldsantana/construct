-- Lançamento pelo PDF: casamento das linhas do romaneio que o SKU não resolve.
--   volume por nome+peso: tipo + parte normalizada + k/N + peso unitário (tolerância 0,05 kg ou 0,2%) → volume da matriz
--     (mesma regra do scripts/importar/romaneios.py; SKUs novos da Brametal para volumes já conhecidos)
--   peça controlada (para-raios, calota, pino) pela posição: 'TORRE PR SUSP - C4EP' + 'POS 1 …' → 'PR SUSPENSÃO - POS 1 - C4EP'

-- parte normalizada: 'TR COMUM INF' = 'TRONCO COMUM INFERIOR', 'EXT 6M' = 'EXTENSAO 6,0M', 'PE 9,0M' = 'PERNA 9,0M'…
create function public.chave_parte(t text) returns text
language sql immutable as $$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
         regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
           trim(regexp_replace(upper(translate(coalesce(t, ''), 'çÇãÃáÁâÂéÉêÊíÍóÓôÔúÚ', 'cCaAaAaAeEeEiIoOoOuU')), '\s+', ' ', 'g')),
           '^TR\.? ?COMUM', 'TRONCO COMUM'), '^TR\b', 'TRONCO'), '^P\.\s*COMUM', 'TRONCO COMUM'),
           '\mSUP$', 'SUPERIOR'), '\mINF$', 'INFERIOR'), '^EXT\.?\M', 'EXTENSAO'), '^PE\M', 'PERNA'),
           '(^|[^\d,])(\d+) ?M$', '\1\2,0M'), '(\d,\d) M$', '\1M'),
           '^TRONCO (SUPERIOR|INFERIOR)$', 'TRONCO COMUM \1'), '^TRONCO$', 'TRONCO COMUM'), '\s+', ' ', 'g')
$$;

-- peça controlada: 'PR <tipo> <pos>', 'CALOTA <tipo> <pos>', 'PINO <tipo> <pos>' (romaneio: descrição PA + SKU; controle: seção + descrição)
create function public.chave_peca(pa text, descricao text) returns text
language sql immutable as $$
  with x as (select upper(coalesce(pa, '')) as pa, upper(coalesce(descricao, '')) as d)
  select case when k is null or tipo is null or pos is null then null else k || ' ' || tipo || ' ' || pos end
  from (
    select case when pa ~ '^(TORRE )?(PR\M|PARA-RAIO)' then 'PR' when pa ~ 'CALOTA' then 'CALOTA' when pa ~ 'PINO' then 'PINO' end as k,
           (regexp_match(pa, '-\s*(C4[A-Z0-9]+|BCTV)\s*$'))[1] as tipo,
           coalesce((regexp_match(d, 'POS\.?\s*(\w+)'))[1], (regexp_match(d, ' - (\d+) - (C4[A-Z0-9]+|BCTV)\s*$'))[1]) as pos
    from x) y
$$;

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
  vol as (
    select vm.seq, array_agg(distinct m.id) as mats
    from vm join public.material m on m.volume_matriz_id = vm.vid join prev on prev.material_id = m.id
    group by vm.seq
  ),
  pec as (
    select it.seq, array_agg(m.id) as mats
    from it join public.material m on public.chave_peca(m.secao, m.descricao) = public.chave_peca(it.pa, it.descricao)
    join prev on prev.material_id = m.id
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
