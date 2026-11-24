-- Situação exibida da NF (revisão):
-- * reposição (NF com SAC) não lançada: 'reposicao' — os controles de estruturas em geral não lançam reposições;
-- * 'nao_recebida' quando o canteiro de destino tem controle importado de QUALQUER linha (Central recebe NFs do T4).
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
    when n.sac is not null then 'reposicao'
    when n.destino_canteiro_id is not null and exists (
      select 1 from public.previsto p where p.canteiro_id = n.destino_canteiro_id
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
