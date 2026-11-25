-- Status automático da torre (decisão 25/11): o estoque manda na LISTA e a LISTA manda no status e no MAPA.
-- Entregue = todos os componentes da torre completos na pintura da LISTA (torre_componente); senão Faltante.
-- Fixadores ainda NÃO entram (falta o consumo por componente — escalonamento); o status digitado no controle fica
-- guardado em torre_controle.status só para comparação.
create view public.torre_status_auto
with (security_invoker = true)
as
select p.torre_id,
       case when bool_and(p.completo) then 'Entregue' else 'Faltante' end as status,
       count(*)::integer as componentes,
       count(*) filter (where p.completo)::integer as completos
from public.torre_componente p
group by p.torre_id;

-- Equivalente ao bloco 1 da TABELAS, pelo status automático (previsto = torres do tipo na LISTA)
create view public.tabela_auto
with (security_invoker = true)
as
with s as materialized (select * from public.torre_status_auto)
select t.linha_sigla as linha, t.canteiro, t.tipo,
       count(*)::integer as previsto,
       count(*) filter (where s.status = 'Entregue')::integer as completas
from public.torre_detalhe t
join public.torre_controle c on c.torre_id = t.id
left join s on s.torre_id = t.id
group by 1, 2, 3;
