-- Tramos: trechos de linha entre torres de ancoragem (unidade do lançamento de cabos).
--
-- A ancoragem vem da LC, torre a torre: arranjo de ferragens com cadeias "AD" (ancoragem).
-- Conferido em 2026-11-24: coincide 100% com o tipo (C4A1, C4A2, C4AT, BCTV).
-- C4TR (transposição) e C4SPE (travessia) usam cadeias de suspensão e não fecham tramo.

alter table public.torre
  add column arranjo_ferragens text,
  add column ancoragem boolean not null default false;

comment on column public.torre.arranjo_ferragens is 'Arranjo de ferragens do condutor, como na LC (ex.: 6-AD4-21; 3-IJ4-16).';
comment on column public.torre.ancoragem is 'Torre de ancoragem (cadeias AD): início/fim de tramo.';

-- Um tramo vai de um ponto de ancoragem ao seguinte; as pontas da linha também contam como limite.
-- A torre de ancoragem pertence aos dois tramos que separa.
create view public.tramo
with (security_invoker = true)
as
with limites as (
  select t.linha_id, t.id, t.numero, t.ordem
  from public.torre t
  join (
    select linha_id, min(ordem) as primeira, max(ordem) as ultima
    from public.torre
    where ordem < 100000          -- ignora torres que saíram da LC (marcadas pelo importador)
    group by linha_id
  ) pontas on pontas.linha_id = t.linha_id
  where t.ordem < 100000
    and (t.ancoragem or t.ordem in (pontas.primeira, pontas.ultima))
),
sequencia as (
  select
    linha_id, id, numero, ordem,
    lead(id)     over w as proximo_id,
    lead(numero) over w as proximo_numero,
    lead(ordem)  over w as proxima_ordem
  from limites
  window w as (partition by linha_id order by ordem)
)
select
  linha_id,
  row_number() over (partition by linha_id order by ordem)::integer as numero,
  id              as torre_inicial_id,
  numero          as torre_inicial,
  proximo_id      as torre_final_id,
  proximo_numero  as torre_final,
  ordem           as ordem_inicial,
  proxima_ordem   as ordem_final,
  proxima_ordem - ordem + 1 as qtd_torres
from sequencia
where proximo_id is not null;

comment on view public.tramo is 'Trechos entre ancoragens, na ordem da LC.';

-- Ajuste de segurança: as funções de permissão não precisam ficar disponíveis ao anônimo.
revoke execute on function public.pode_ler(), public.pode_editar() from anon, public;
grant execute on function public.pode_ler(), public.pode_editar() to authenticated;
