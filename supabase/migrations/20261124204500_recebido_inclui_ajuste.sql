-- "Recebido" passa a incluir ajustes, como a coluna RECEBIDO do controle (que soma tudo a partir da coluna E).
-- Hoje o único ajuste é a quantidade digitada na coluna E da ENTRADA. Quando existirem ajustes de inventário,
-- separar em coluna própria.
create or replace view public.saldo_material
with (security_invoker = true)
as
with mov as (
  select mv.linha_id, mv.canteiro_id, mi.material_id,
         sum(mi.quantidade) filter (where mv.tipo in ('recebimento', 'transferencia', 'ajuste')) as recebido,
         sum(-mi.quantidade) filter (where mv.tipo = 'saida_campo')                               as saido,
         sum(mi.quantidade)                                                                       as saldo
  from public.movimento mv
  join public.movimento_item mi on mi.movimento_id = mv.id
  group by 1, 2, 3
)
select
  coalesce(p.linha_id, mov.linha_id)       as linha_id,
  coalesce(p.canteiro_id, mov.canteiro_id) as canteiro_id,
  m.id as material_id, m.secao, m.descricao, m.parte, m.tipo_torre_id, m.unidade, m.peso_unit, m.ordem,
  coalesce(p.quantidade, 0)  as previsto,
  coalesce(mov.recebido, 0)  as recebido,
  coalesce(mov.saido, 0)     as saido,
  coalesce(mov.saldo, 0)     as saldo
from public.previsto p
full join mov on mov.linha_id = p.linha_id and mov.canteiro_id = p.canteiro_id and mov.material_id = p.material_id
join public.material m on m.id = coalesce(p.material_id, mov.material_id);

-- recebimento_lista passa a mostrar também o ajuste (sem NF nem data)
create or replace view public.recebimento_lista
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
where m.tipo in ('recebimento', 'transferencia', 'ajuste');
