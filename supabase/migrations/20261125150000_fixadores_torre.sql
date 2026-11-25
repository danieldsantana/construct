-- Fixadores por torre (aba FIXADORES POR TORRE de cada controle: necessidade de cada fixador a granel por torre, calculada
-- pelo controle a partir do escalonamento). Conferido na importação: soma das torres = NECESSÁRIO; previsto da ENTRADA =
-- NECESSÁRIO + 5%; RECEBIDO da aba = recebido do granel (seção FIXADORES) na ENTRADA.
create table public.torre_fixador (
  torre_id integer not null references public.torre(id) on delete cascade,
  material_id integer not null references public.material(id),
  quantidade numeric not null,
  fonte text not null,
  primary key (torre_id, material_id)
);
create index on public.torre_fixador (material_id);
select public.aplicar_rls_padrao('public.torre_fixador');

-- Distribuição do estoque de fixadores a granel pela sequência de ataque (mesma ordem da estrutura), por linha/canteiro
-- e fixador. Uma linha por torre × fixador: completo = o saldo do fixador cobre a necessidade da torre.
create function public.fixador_pintura()
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
    )
    select tf.torre_id, tf.material_id, tf.quantidade, t.linha_id, coalesce(tc.canteiro_id, t.canteiro_id) as canteiro_id,
           coalesce(est.recebido, 0) as estoque
    from public.torre_fixador tf
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

create view public.torre_fixador_status
with (security_invoker = true)
as select * from public.fixador_pintura();

-- Status automático (revisão): Entregue = estrutura e fixadores completos; SF = estrutura completa sem fixadores;
-- Faltante = estrutura incompleta. Torre sem fixadores importados conta só a estrutura.
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
       coalesce(f.fixadores_faltando, 0) as fixadores_faltando
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
