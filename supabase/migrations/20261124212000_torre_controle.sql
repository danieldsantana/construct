-- O que a LISTA de cada controle diz sobre cada torre: status, sequência de ataque e composição
-- (colunas G–AB da LISTA: blocos AUTOPORTANTE e ESTAIADA). Importado; a situação calculada vem depois.
create table public.torre_controle (
  torre_id    integer primary key references public.torre (id),
  status      text not null,                -- como no controle: Entregue, Faltante, SF…
  sequencia   integer,                      -- sequência de ataque
  composicao  jsonb not null,               -- {"ES_CABECA": 1, "ES_EXT_6_0": 2, …}
  fonte       text not null
);
comment on table public.torre_controle is 'Status, sequência de ataque e composição de cada torre, como na LISTA do controle (importado).';
select public.aplicar_rls_padrao('public.torre_controle');

create view public.torre_lista
with (security_invoker = true)
as
select d.*, tc.status, tc.sequencia, tc.composicao, tc.fonte
from public.torre_detalhe d
left join public.torre_controle tc on tc.torre_id = d.id;
