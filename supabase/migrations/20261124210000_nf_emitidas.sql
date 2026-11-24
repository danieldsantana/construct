-- NFs emitidas (PDFs recebidos por e-mail): arquivo, SAC/RNC citados no nome e canteiro de destino da NF.
-- O canteiro de destino pode ser diferente de onde a NF foi recebida (ex.: OF do T4 com destino Barra).
alter table public.nota_fiscal
  add column arquivo text,
  add column sac text,
  add column rnc text,
  add column destino_canteiro_id smallint references public.canteiro (id);

-- Uma linha por NF, com a situação e os recebimentos dela (uma NF pode ser recebida em mais de uma coluna).
create view public.nf_lista
with (security_invoker = true)
as
select
  n.id, n.numero, n.emissao, n.fornecedor, n.of_texto, n.of_numero, n.romaneio, n.valor, n.peso, n.situacao,
  n.arquivo, n.sac, n.rnc, n.origem,
  l.sigla as linha,
  cd.nome as destino,
  cr.nome as canteiro_recebimento,
  r.recebida_em, r.recebimentos, r.itens
from public.nota_fiscal n
left join public.linha l on l.id = n.linha_id
left join public.canteiro cd on cd.id = n.destino_canteiro_id
left join public.canteiro cr on cr.id = n.canteiro_id
left join lateral (
  select min(m.data) as recebida_em, count(*)::integer as recebimentos,
         (select count(*) from public.movimento_item i join public.movimento m2 on m2.id = i.movimento_id where m2.nota_fiscal_id = n.id)::integer as itens
  from public.movimento m where m.nota_fiscal_id = n.id
) r on true;
