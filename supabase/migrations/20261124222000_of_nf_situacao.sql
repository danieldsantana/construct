-- OF × NF com a situação exibida (não recebida só quando o canteiro de destino tem controle importado).
create or replace view public.of_resumo
with (security_invoker = true)
as
select
  o.id, o.codigo, o.numero, o.revisao, o.emitida_em, o.entrega_prevista, o.entrega_texto,
  l.sigla as linha, c.nome as canteiro,
  i.itens, i.quantidade, i.peso_previsto,
  coalesce(n.nfs, 0) as nfs,
  coalesce(n.nfs_recebidas, 0) as nfs_recebidas,
  coalesce(n.peso_recebido, 0) as peso_recebido,
  n.ultima_recebida,
  coalesce(n.nfs_nao_recebidas, 0) as nfs_nao_recebidas,
  coalesce(n.nfs_sem_controle, 0) as nfs_sem_controle
from public.ordem_fabricacao o
join public.linha l on l.id = o.linha_id
left join public.canteiro c on c.id = o.canteiro_id
left join lateral (
  select count(*)::integer as itens, sum(it.quantidade) as quantidade, sum(it.peso_kg) as peso_previsto
  from public.of_item it where it.of_id = o.id
) i on true
left join lateral (
  select count(*)::integer as nfs,
         count(*) filter (where nf.situacao_exibida in ('em_conferencia', 'confirmada'))::integer as nfs_recebidas,
         sum(nf.peso) filter (where nf.situacao_exibida in ('em_conferencia', 'confirmada')) as peso_recebido,
         max(nf.recebida_em) as ultima_recebida,
         count(*) filter (where nf.situacao_exibida = 'nao_recebida')::integer as nfs_nao_recebidas,
         count(*) filter (where nf.situacao_exibida = 'sem_controle')::integer as nfs_sem_controle
  from public.nf_lista nf
  where o.numero is not null and nf.of_numero = o.numero
) n on true;

create or replace view public.of_nf
with (security_invoker = true)
as
select o.id as of_id, nf.id as nf_id, nf.numero, nf.emissao, nf.peso, nf.situacao,
       nf.canteiro_recebimento, nf.linha as linha_nf, nf.recebida_em,
       nf.situacao_exibida, nf.destino, nf.sac, nf.rnc
from public.ordem_fabricacao o
join public.nf_lista nf on nf.of_numero = o.numero;
