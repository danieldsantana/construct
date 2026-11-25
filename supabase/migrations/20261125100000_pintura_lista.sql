-- Pintura automática da LISTA (decisão do usuário 25/11): o conjunto completo de cada parte, calculado do estoque
-- (recebido de todos os movimentos, inclusive lançamentos feitos no app), é distribuído pelas torres na ORDEM FIXA da
-- sequência de ataque. Componente completo para a torre = verde; senão = vermelho. Mesma regra para todos os controles.
-- Regra reproduzida dos controles: bate com a pintura manual em 97,4% das células e com o CONJUNTO COMPLETO do controle
-- em 408 de 410 partes (as 2 restantes usam outra fórmula de para-raios no controle do outro analista).

-- 1) Parte do controle -> componente da LISTA (+ comprimento, para extensões e pernas)
create function public.componente_da_parte(p text, out componente text, out comprimento numeric)
language sql immutable as $$
  with s as (select upper(translate(coalesce(p, ''), 'ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç', 'AAAAEEIOOOUCaaaaeeiooouc')) as t)
  select
    case
      when t like 'PARA%RAIO%ANC%' then 'PR_ANC'
      when t like 'PARA%RAIO%SUSP%' then 'PR_SUSP'
      when t like 'EXT%' then 'EXT'
      when t like 'PE %' or t like 'PE-%' or t like 'PERNA%' then 'PERNA'
      when t like 'TRONCO%SUP%' then 'TRONCO_SUP'
      when t like 'TRONCO%INF%' then 'TRONCO_INF'
      when t like 'TRONCO%' then 'TRONCO'
      when t like 'CABECA%' then 'CABECA'
      when t like 'STUB' or t like 'STUB %' and t not like '%ESTAI%' then 'STUB'
      when t like 'CALOTA%' then 'CALOTA'
      when t like 'PINO%' then 'PINO'
    end,
    replace(substring(t from '([0-9]+[,.][0-9]+)'), ',', '.')::numeric
  from s
$$;

-- 2) Conjunto completo atual de cada parte, do estoque: para cada volume, recebido ÷ (previsto do volume ÷ menor previsto
--    da parte), arredondado para baixo; o conjunto é o menor deles (unidade = volume de menor previsto; ex. para-raios de
--    ancoragem: 2 peças POS 2H + 1 POS 3 = 1 conjunto, como MIN(ROUNDDOWN(2H/2), POS3) do controle).
create view public.conjunto_atual
with (security_invoker = true)
as
with v as (
  select s.linha_id, s.linha, s.canteiro_id, s.canteiro, s.tipo, s.parte, s.previsto, s.recebido,
         min(s.previsto) over (partition by s.linha_id, s.canteiro_id, s.tipo, s.parte) as prev_min
  from public.saldo_material_detalhe s
  where s.parte is not null and s.previsto > 0
)
select v.linha_id, v.linha, v.canteiro_id, v.canteiro, v.tipo, v.parte,
       (public.componente_da_parte(v.parte)).componente, (public.componente_da_parte(v.parte)).comprimento,
       min(v.previsto / v.prev_min)::numeric as previsto_unid_por_volume,
       min(floor(v.recebido / (v.previsto / v.prev_min) + 1e-9)) as conjunto,
       min(v.prev_min) as previsto
from v
group by 1, 2, 3, 4, 5, 6;

-- 3) Distribuição pela sequência de ataque. Uma linha por torre × componente da composição (só o grupo da categoria da
--    torre: AUTOPORTANTE ou ESTAIADA; pino só em estaiada). Torre sem sequência vai para o fim (ordem da linha).
--    Se várias partes caem no mesmo componente (ex. C4SPE TRONCO COMUM I/II/III), todas são necessárias: vale o menor.
create function public.lista_pintura()
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
    select m.*,
      (select min(ca.conjunto) from public.conjunto_atual ca
        where ca.linha_id = m.linha_id and ca.canteiro_id = m.canteiro_id and ca.tipo = m.tipo
          and ca.componente = m.componente and ca.comprimento is not distinct from m.comprimento) as estoque
    from mapa m
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

create view public.torre_componente
with (security_invoker = true)
as select * from public.lista_pintura();
