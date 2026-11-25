-- Volta o status automático a considerar só a ESTRUTURA (Entregue/Faltante), como aprovado em 25/11. A situação dos
-- fixadores por torre fica ao lado (fixadores_completos, fixadores_faltando) até o usuário decidir a regra: com o estoque
-- a granel distribuído pela sequência, Barra teria 4 Entregue + 88 SF, contra 95 Entregue no controle (calços seguram).
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
       case when e.estrutura then 'Entregue' else 'Faltante' end as status,
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
       count(*) filter (where s.status = 'Entregue' and s.fixadores_completos is false)::integer as sem_fixadores
from public.torre_detalhe t
join public.torre_controle c on c.torre_id = t.id
left join s on s.torre_id = t.id
group by 1, 2, 3;
