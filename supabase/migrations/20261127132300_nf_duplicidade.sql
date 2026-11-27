-- nf_salvar: NF já cadastrada só é alterada com confirmação (substituir = true), depois da escolha das diferenças na tela.

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
  -- NF já cadastrada (com itens ou lançada pelo app): só altera com p.substituir = true, depois de o usuário escolher
  -- campo a campo o que fica (a tela mostra as diferenças); evita duplicidade e sobrescrita silenciosa
  if v_id is not null and not coalesce((p->>'substituir')::boolean, false)
     and (exists (select 1 from public.nf_item where nota_fiscal_id = v_id)
          or exists (select 1 from public.nota_fiscal where id = v_id and lancamento is not null)) then
    raise exception 'A NF % já está cadastrada', p->>'numero';
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
