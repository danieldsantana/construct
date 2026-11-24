-- RNC × SAC × NF de reposição, a partir das NFs (índice dos PDFs: sac "00806-26", rnc "454+455+428").
-- Uma linha por (RNC, NF); NF com SAC e sem RNC entra com rnc nula. Uma RNC pode ter vários SACs e várias NFs,
-- e um SAC pode citar várias RNCs. Ainda não é o registro próprio de RNC (itens, situação): é o que as NFs dizem.
create view public.rnc_nf
with (security_invoker = true)
as
select
  nullif(trim(x.rnc), '') as rnc,
  n.sac,
  n.id as nf_id, n.numero, n.emissao, n.linha, n.destino, n.canteiro_recebimento,
  n.situacao_exibida, n.recebida_em, n.of_texto, n.arquivo
from public.nf_lista n
cross join lateral unnest(string_to_array(coalesce(n.rnc, ''), '+')) as x(rnc)
where n.sac is not null or n.rnc is not null;
