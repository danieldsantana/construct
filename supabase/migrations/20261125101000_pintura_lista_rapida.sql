-- lista_pintura: estoque calculado uma vez (CTE materializada) em vez de subconsulta por célula.
create or replace function public.lista_pintura()
returns table (torre_id integer, chave text, componente text, comprimento numeric, necessidade numeric,
               disponivel_antes numeric, completo boolean)
language plpgsql stable security invoker
as $$
declare
  r record;
  saldo jsonb := '{}'::jsonb;
  k text;
  disp numeric;
begin
  for r in
    with comp as (
      select t.id as torre_id, t.linha_id, coalesce(tc.canteiro_id, t.canteiro_id) as canteiro_id, t.tipo, t.categoria,
             t.ordem, tc.sequencia, e.key as chave, e.value::numeric as valor
      from public.torre_detalhe t
      join public.torre_controle tc on tc.torre_id = t.id
      cross join lateral jsonb_each_text(tc.composicao) e
      where (t.categoria = 'autoportante' and e.key like 'AP\_%') or (t.categoria = 'estaiada' and e.key like 'ES\_%')
    ), mapa as (
      select c.*,
        case
          when c.chave in ('AP_PR_ANC', 'ES_PR_ANC') then 'PR_ANC'
          when c.chave in ('AP_PR_SUSP', 'ES_PR_SUSP') then 'PR_SUSP'
          when c.chave in ('AP_CABECA', 'ES_CABECA') then 'CABECA'
          when c.chave = 'AP_TRONCO' then 'TRONCO'
          when c.chave = 'ES_TRONCO_SUP' then 'TRONCO_SUP'
          when c.chave = 'ES_TRONCO_INF' then 'TRONCO_INF'
          when c.chave = 'AP_EXT' or c.chave like 'ES_EXT_%' then 'EXT'
          when c.chave like 'AP_PERNA_%' then 'PERNA'
          when c.chave = 'AP_STUB' then 'STUB'
          when c.chave = 'ES_CALOTA' then 'CALOTA'
          when c.chave = 'ES_PINO' then 'PINO'
        end as componente,
        case
          when c.chave = 'AP_EXT' or c.chave like 'AP_PERNA_%' then c.valor          -- valor = comprimento (1 peça)
          when c.chave like 'ES_EXT_%' then replace(substring(c.chave from 8), '_', '.')::numeric
        end as comprimento,
        case when c.chave = 'AP_EXT' or c.chave like 'AP_PERNA_%' then 1 else c.valor end as necessidade
      from comp c
      where c.valor > 0
    )
    , est as materialized (  -- estoque calculado UMA vez (antes era subconsulta por célula: lento)
      select ca.linha_id, ca.canteiro_id, ca.tipo, ca.componente, ca.comprimento, min(ca.conjunto) as estoque
      from public.conjunto_atual ca where ca.componente is not null
      group by 1, 2, 3, 4, 5
    )
    select m.*, est.estoque
    from mapa m
    left join est on est.linha_id = m.linha_id and est.canteiro_id = m.canteiro_id and est.tipo = m.tipo
      and est.componente = m.componente and est.comprimento is not distinct from m.comprimento
    order by m.linha_id, m.canteiro_id, m.tipo, coalesce(m.sequencia, 1000000 + m.ordem), m.ordem, m.chave
  loop
    k := concat_ws('|', r.linha_id, r.canteiro_id, r.tipo, r.componente, r.comprimento);
    disp := coalesce((saldo ->> k)::numeric, coalesce(r.estoque, 0));
    torre_id := r.torre_id; chave := r.chave; componente := r.componente; comprimento := r.comprimento;
    necessidade := r.necessidade; disponivel_antes := disp; completo := disp >= r.necessidade;
    if completo then
      disp := disp - r.necessidade;
    end if;
    saldo := saldo || jsonb_build_object(k, disp);
    return next;
  end loop;
end
$$;

