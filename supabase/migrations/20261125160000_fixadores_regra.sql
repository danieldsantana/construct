-- Regra de fixadores (decisão do usuário 25/11): o granel de cada fixador é distribuído SÓ entre as torres com ESTRUTURA
-- completa, na ordem da sequência de ataque (não faz sentido reservar fixador para torre incompleta).
-- Status: Entregue = estrutura + fixadores · SF (amarelo) = estrutura completa, faltam fixadores · Faltante = estrutura incompleta.
create or replace function public.fixador_pintura()
returns table (torre_id integer, material_id integer, necessidade numeric, disponivel_antes numeric, completo boolean)
language plpgsql stable security invoker
as $$
declare
  r record;
  saldo jsonb := '{}'::jsonb;
  k text;
  disp numeric;
begin
  for r in
    with est as materialized (
      select s.linha_id, s.canteiro_id, s.material_id, s.recebido
      from public.saldo_material_detalhe s where s.secao = 'FIXADORES'
    ), estrutura as materialized (
      select p.torre_id from public.torre_componente p group by 1 having bool_and(p.completo)
    )
    select tf.torre_id, tf.material_id, tf.quantidade, t.linha_id, coalesce(tc.canteiro_id, t.canteiro_id) as canteiro_id,
           coalesce(est.recebido, 0) as estoque
    from public.torre_fixador tf
    join estrutura e on e.torre_id = tf.torre_id
    join public.torre_detalhe t on t.id = tf.torre_id
    join public.torre_controle tc on tc.torre_id = tf.torre_id
    left join est on est.linha_id = t.linha_id and est.canteiro_id = coalesce(tc.canteiro_id, t.canteiro_id) and est.material_id = tf.material_id
    where tf.quantidade > 0
    order by t.linha_id, coalesce(tc.canteiro_id, t.canteiro_id), tf.material_id, coalesce(tc.sequencia, 1000000 + t.ordem), t.ordem
  loop
    k := concat_ws('|', r.linha_id, r.canteiro_id, r.material_id);
    disp := coalesce((saldo ->> k)::numeric, r.estoque);
    torre_id := r.torre_id; material_id := r.material_id; necessidade := r.quantidade; disponivel_antes := disp;
    completo := disp >= r.quantidade;
    if completo then disp := disp - r.quantidade; end if;
    saldo := saldo || jsonb_build_object(k, disp);
    return next;
  end loop;
end
$$;

create or replace view public.torre_status_auto
with (security_invoker = true)
as
with est as (
  select p.torre_id, bool_and(p.completo) as estrutura, count(*)::integer as componentes,
         count(*) filter (where p.completo)::integer as completos
  from public.torre_componente p group by 1
), fix as (
  select f.torre_id, bool_and(f.completo) as fixadores, count(*) filter (where not f.completo)::integer as fixadores_faltando
  from public.torre_fixador_status f group by 1
)
select e.torre_id,
       case when not e.estrutura then 'Faltante' when coalesce(f.fixadores, true) then 'Entregue' else 'SF' end as status,
       e.componentes, e.completos,
       coalesce(f.fixadores_faltando, 0) as fixadores_faltando,
       f.fixadores as fixadores_completos
from est e left join fix f on f.torre_id = e.torre_id;

create or replace view public.tabela_auto
with (security_invoker = true)
as
with s as materialized (select * from public.torre_status_auto)
select t.linha_sigla as linha, t.canteiro, t.tipo,
       count(*)::integer as previsto,
       count(*) filter (where s.status = 'Entregue')::integer as completas,
       count(*) filter (where s.status = 'SF')::integer as sem_fixadores
from public.torre_detalhe t
join public.torre_controle c on c.torre_id = t.id
left join s on s.torre_id = t.id
group by 1, 2, 3;

-- Fixadores que faltam por torre (para a ficha): só torres com estrutura completa e fixador não coberto
create view public.torre_fixador_falta
with (security_invoker = true)
as
select f.torre_id, m.descricao as fixador, f.necessidade, greatest(f.disponivel_antes, 0) as disponivel
from public.torre_fixador_status f
join public.material m on m.id = f.material_id
where not f.completo;
