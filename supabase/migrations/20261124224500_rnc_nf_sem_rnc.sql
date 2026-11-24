-- Correção: NF com SAC e sem RNC precisa aparecer (string_to_array('') devolve lista vazia e o unnest a descartava).
create or replace view public.rnc_nf
with (security_invoker = true)
as
select
  nullif(trim(x.rnc), '') as rnc,
  n.sac,
  n.id as nf_id, n.numero, n.emissao, n.linha, n.destino, n.canteiro_recebimento,
  n.situacao_exibida, n.recebida_em, n.of_texto, n.arquivo
from public.nf_lista n
cross join lateral unnest(case when n.rnc is null then array[null::text] else string_to_array(n.rnc, '+') end) as x(rnc)
where n.sac is not null or n.rnc is not null;
