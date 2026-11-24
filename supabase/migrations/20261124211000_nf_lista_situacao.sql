-- "Não recebida" só vale quando o canteiro de destino tem controle importado (há previsto para ele).
-- Sem isso a NF pode ter sido recebida num controle que ainda não está no banco: situação desconhecida.
create or replace view public.nf_lista
with (security_invoker = true)
as
select
  n.id, n.numero, n.emissao, n.fornecedor, n.of_texto, n.of_numero, n.romaneio, n.valor, n.peso, n.situacao,
  n.arquivo, n.sac, n.rnc, n.origem,
  l.sigla as linha,
  cd.nome as destino,
  cr.nome as canteiro_recebimento,
  r.recebida_em, r.recebimentos, r.itens,
  case
    when n.situacao <> 'nao_recebida' then n.situacao::text
    when n.destino_canteiro_id is not null and exists (
      select 1 from public.previsto p
      where p.canteiro_id = n.destino_canteiro_id and (n.linha_id is null or p.linha_id = n.linha_id)
    ) then 'nao_recebida'
    else 'sem_controle'
  end as situacao_exibida
from public.nota_fiscal n
left join public.linha l on l.id = n.linha_id
left join public.canteiro cd on cd.id = n.destino_canteiro_id
left join public.canteiro cr on cr.id = n.canteiro_id
left join lateral (
  select min(m.data) as recebida_em, count(*)::integer as recebimentos,
         (select count(*) from public.movimento_item i join public.movimento m2 on m2.id = i.movimento_id where m2.nota_fiscal_id = n.id)::integer as itens
  from public.movimento m where m.nota_fiscal_id = n.id
) r on true;
