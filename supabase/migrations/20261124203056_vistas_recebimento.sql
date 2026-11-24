-- Consultas para as telas de recebimento.

-- Um registro por movimento (= uma coluna da ENTRADA), com a NF, a linha e o canteiro.
create view public.recebimento_lista
with (security_invoker = true)
as
select
  m.id, m.tipo, m.data, m.documento, m.origem,
  m.linha_id, l.sigla as linha,
  m.canteiro_id, c.nome as canteiro,
  n.id as nf_id, n.numero, n.emissao, n.fornecedor, n.of_texto, n.of_numero, n.romaneio, n.valor, n.peso, n.situacao,
  (select count(*) from public.movimento_item i where i.movimento_id = m.id)::integer as itens
from public.movimento m
join public.linha l on l.id = m.linha_id
join public.canteiro c on c.id = m.canteiro_id
left join public.nota_fiscal n on n.id = m.nota_fiscal_id
where m.tipo in ('recebimento', 'transferencia');

-- Saldo por material com nomes de linha, canteiro e tipo de torre.
create view public.saldo_material_detalhe
with (security_invoker = true)
as
select s.*, l.sigla as linha, c.nome as canteiro, t.codigo as tipo
from public.saldo_material s
join public.linha l on l.id = s.linha_id
join public.canteiro c on c.id = s.canteiro_id
left join public.tipo_torre t on t.id = s.tipo_torre_id;

-- Lançamentos com a quantidade de cada material em cada movimento (para a planilha de entrada).
create view public.movimento_item_detalhe
with (security_invoker = true)
as
select i.movimento_id, i.material_id, i.quantidade, m.linha_id, m.canteiro_id
from public.movimento_item i
join public.movimento m on m.id = i.movimento_id;
