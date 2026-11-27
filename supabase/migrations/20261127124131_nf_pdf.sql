-- Lançamento pelo PDF da NF (leitura no navegador): município do local de entrega → canteiro; de-para do romaneio
-- (SKU → volume da matriz → item do controle; fixador pela descrição); nf_salvar grava também o romaneio lido.

-- ---------- canteiro pelo município do local de entrega (DANFE) ----------
alter table public.canteiro add column municipio text;
comment on column public.canteiro.municipio is 'Município do local de entrega no DANFE (sem acento, maiúsculo) que identifica o canteiro.';
update public.canteiro c set municipio = v.m from (values
  ('Barra', 'BARRA'), ('Central', 'CENTRAL'), ('Itajubaquara', 'GENTIO DO OURO'), ('Juazeiro', 'JUAZEIRO'),
  ('Laje dos Negros', 'CAMPO FORMOSO'), ('Umburanas', 'UMBURANAS')) v(n, m)
where c.nome = v.n;
create unique index on public.canteiro (municipio);

-- ---------- SKU do romaneio → volume da matriz ----------
-- da matriz (CÓD. EMBALAGEM) e, para SKUs fora dela, das ligações nome+peso já conferidas nos romaneios importados
-- (só quando o SKU leva sempre ao mesmo volume)
create view public.sku_volume with (security_invoker = true) as
select sku, min(volume_matriz_id) as volume_matriz_id, min(fonte) as fonte
from (
  select sku, id as volume_matriz_id, 'matriz' as fonte from public.volume_matriz where sku is not null
  union all
  select sku, volume_matriz_id, 'romaneio' from public.romaneio_item
  where ligacao = 'nome+peso' and volume_matriz_id is not null
    and sku not in (select sku from public.volume_matriz where sku is not null)
) s
group by sku
having count(distinct volume_matriz_id) = 1;

-- ---------- fixador: chave comum entre a descrição do romaneio e a do controle ----------
-- 'PARAFUSO SX AC 15,9X51MM R26 D' e 'Parafuso - 15.9 x 50' → 'PARAFUSO 15.9 50' (51/76 mm = 2"/3" → 50/75)
-- 'CALCO LIS AC 12,7/ M12X6,5MM CO' e 'Calço - 12.7 x 6.4' → 'CALCO 12.7 6.4' · porca/arruela/palnut só pelo diâmetro
-- métricos (M12, M16…) não têm item no controle → sem chave
create function public.chave_fixador(t text) returns text
language sql immutable as $$
  with x as (select upper(translate(coalesce(t, ''), 'çÇãÃáÁéÉíÍóÓúÚ', 'cCaAaAeEiIoOuU')) as s),
  d as (select s, (regexp_match(s, '(12[,.]7|15[,.]9|19[,.]1|25[,.]4)'))[1] as dia from x)
  select case
    when s ~ '^MANCAL' then 'MANCAL ' || replace(coalesce((regexp_match(s, '(BL\d+B?|F\d{4}-?\d{2})'))[1], ''), '-', '')
    when dia is null then null
    when s ~ 'PARAFUSO (DEG|DEGRAU)' then 'DEGRAU ' || replace(dia, ',', '.') || ' '
      || (regexp_match(s, '(?:X|x)\s*(\d+)'))[1]
    when s ~ '^PARAFUSO' then 'PARAFUSO ' || replace(dia, ',', '.') || ' '
      || (select case when n % 5 = 1 then n - 1 else n end from (select ((regexp_match(s, '[,.]\d\s*X\s*(\d+)'))[1])::int as n) q)
    when s ~ '^CALCO' then 'CALCO ' || replace(dia, ',', '.') || ' '
      || (select case e when '3' then '3.2' when '3.2' then '3.2' when '5' then '4.8' when '4.8' then '4.8'
                        when '6.5' then '6.4' when '6.4' then '6.4' end
          from (select replace((regexp_match(s, 'X\s*(\d+(?:[,.]\d+)?)\s*(?:MM)?\s*(?:CO)?\s*$'))[1], ',', '.') as e) q)
    when s ~ '^ARRUELA' then 'ARRUELA ' || replace(dia, ',', '.')
    when s ~ '^PORCA' then 'PORCA ' || replace(dia, ',', '.')
    when s ~ '^PALNUT' then 'PALNUT ' || replace(dia, ',', '.')
  end from d
$$;

-- ---------- sugestão de itens a partir das linhas do romaneio ----------
-- p_itens: [{seq, sku, descricao, descricao_pa, tipo_ud}] → material do controle no (linha, canteiro) de destino:
--   volume: SKU → volume da matriz → material ligado a esse volume e previsto no destino (ou, destino fora do trecho,
--           previsto em algum canteiro da linha) — só quando é exatamente um;
--   fixador: chave da descrição; com "STUB - <tipo>" na descrição PA, o item da seção FIXADORES STUB do tipo, se houver.
create function public.nf_sugerir_itens(p_linha text, p_canteiro text, p_itens jsonb)
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
    select (i->>'seq')::int as seq, i->>'sku' as sku, i->>'descricao' as descricao, coalesce(i->>'descricao_pa', '') as pa
    from jsonb_array_elements(p_itens) i
  ),
  vol as (
    select it.seq, array_agg(distinct m.id) as mats
    from it join public.sku_volume sv on sv.sku = it.sku
    join public.material m on m.volume_matriz_id = sv.volume_matriz_id
    join prev on prev.material_id = m.id
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
    case when cardinality(vol.mats) = 1 then vol.mats[1] when cardinality(fix.mats) = 1 then fix.mats[1] end,
    case when cardinality(vol.mats) = 1 then 'volume' when cardinality(vol.mats) > 1 then 'ambiguo'
         when cardinality(fix.mats) = 1 then 'fixador' when cardinality(fix.mats) > 1 then 'ambiguo'
         when it.descricao ~ '^POS ' then 'peca' else 'sem' end
  from it left join vol on vol.seq = it.seq left join fix on fix.seq = it.seq
  order by it.seq
$$;

-- ---------- nf_salvar: também o arquivo, o peso do DANFE e o romaneio lido do PDF ----------
create or replace function public.nf_salvar(p jsonb) returns integer
language plpgsql security invoker as $$
declare
  v_id integer;
  v_sit public.situacao_nf;
begin
  if not public.pode_editar() then raise exception 'Sem permissão de edição'; end if;
  if coalesce(trim(p->>'numero'), '') !~ '^[0-9]+$' then raise exception 'Número da NF inválido'; end if;
  select id, situacao into v_id, v_sit from public.nota_fiscal where numero = ltrim(p->>'numero', '0');
  if v_id is not null and (v_sit <> 'nao_recebida' or exists (select 1 from public.movimento where nota_fiscal_id = v_id)) then
    raise exception 'A NF % já foi recebida; não pode ser relançada', p->>'numero';
  end if;
  if v_id is null then
    insert into public.nota_fiscal (numero, situacao, origem) values (ltrim(p->>'numero', '0'), 'nao_recebida', 'app:' || coalesce(p->>'lancamento', 'manual'))
    returning id into v_id;
  end if;
  update public.nota_fiscal set
    emissao = coalesce(nullif(p->>'emissao', '')::date, emissao),
    fornecedor = coalesce(nullif(p->>'fornecedor', ''), fornecedor, 'BRAMETAL'),
    of_texto = coalesce(nullif(p->>'of', ''), of_texto),
    of_numero = coalesce((select (regexp_match(p->>'of', 'BRM-(\d+)'))[1]::integer), (select (regexp_match(p->>'of', '^\s*OF\s*-\s*(\d+)'))[1]::integer), of_numero),
    of_fonte = case when nullif(p->>'of', '') is not null then coalesce(p->>'lancamento', 'manual') else of_fonte end,
    romaneio = coalesce(nullif(p->>'romaneio', ''), romaneio),
    valor = coalesce(nullif(p->>'valor', '')::numeric, valor),
    peso = coalesce(nullif(p->>'peso', '')::numeric, peso),
    linha_id = coalesce((select id from public.linha where sigla = p->>'linha'), linha_id),
    destino_canteiro_id = coalesce((select id from public.canteiro where nome = p->>'destino'), destino_canteiro_id),
    arquivo = coalesce(nullif(p->>'arquivo', ''), arquivo),
    peso_danfe = coalesce(nullif(p->>'peso_danfe', '')::numeric, peso_danfe),
    romaneio_confere = case when p ? 'romaneio_itens' then (p->>'romaneio_confere')::boolean else romaneio_confere end,
    romaneio_obs = case when p ? 'romaneio_itens' then nullif(p->>'romaneio_obs', '') else romaneio_obs end,
    lancamento = coalesce(p->>'lancamento', 'manual'),
    lancada_em = now()
  where id = v_id;
  delete from public.nf_item where nota_fiscal_id = v_id;
  insert into public.nf_item (nota_fiscal_id, material_id, quantidade)
  select v_id, (i->>'material_id')::integer, sum((i->>'quantidade')::numeric)
  from jsonb_array_elements(coalesce(p->'itens', '[]'::jsonb)) i
  where coalesce((i->>'quantidade')::numeric, 0) <> 0
  group by 2;
  if p ? 'romaneio_itens' then
    delete from public.romaneio_item where nota_fiscal_id = v_id;
    insert into public.romaneio_item (nota_fiscal_id, seq, remessa, ud, sku, lote, tipo_ud, ov, item_ov, descricao,
                                      quantidade, peso_unit, peso_total, pagina, volume_matriz_id, ligacao)
    select v_id, (r->>'seq')::int, r->>'remessa', r->>'ud', r->>'sku', nullif(r->>'lote', ''), r->>'tipo_ud', r->>'ov', r->>'item_ov',
           trim(coalesce(r->>'descricao_pa', '') || ' ' || coalesce(r->>'descricao', '')),
           (r->>'quantidade')::numeric, (r->>'peso_unit')::numeric, (r->>'peso_total')::numeric, (r->>'pagina')::int,
           sv.volume_matriz_id, case when sv.volume_matriz_id is not null then 'sku' end
    from jsonb_array_elements(p->'romaneio_itens') r
    left join public.sku_volume sv on sv.sku = r->>'sku';
  end if;
  return v_id;
end $$;
