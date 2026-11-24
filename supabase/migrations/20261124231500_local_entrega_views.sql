-- of_nf e rnc_nf também trazem o local de entrega e a linha do controle desse local.
create or replace view public.of_nf
with (security_invoker = true)
as
select o.id as of_id, nf.id as nf_id, nf.numero, nf.emissao, nf.peso, nf.situacao,
       nf.canteiro_recebimento, nf.linha as linha_nf, nf.recebida_em,
       nf.situacao_exibida, nf.destino, nf.sac, nf.rnc,
       nf.local_entrega, nf.linha_local
from public.ordem_fabricacao o
join public.nf_lista nf on nf.of_numero = o.numero;

create or replace view public.rnc_nf
with (security_invoker = true)
as
select
  nullif(trim(x.rnc), '') as rnc,
  n.sac,
  n.id as nf_id, n.numero, n.emissao, n.linha, n.destino, n.canteiro_recebimento,
  n.situacao_exibida, n.recebida_em, n.of_texto, n.arquivo,
  n.local_entrega, n.linha_local
from public.nf_lista n
cross join lateral unnest(case when n.rnc is null then array[null::text] else string_to_array(n.rnc, '+') end) as x(rnc)
where n.sac is not null or n.rnc is not null;
