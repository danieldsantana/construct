-- nf_lista ganha local_entrega e linha_local (escopo pelo local de entrega).
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
  end as situacao_exibida,
  -- local de entrega prevalece (decisão 24/11): canteiro onde foi recebida; senão o destino da NF
  coalesce(cr.nome, cd.nome) as local_entrega,
  -- linha do controle desse local: a do recebimento; senão a da NF, se o destino tem controle dela; senão a única
  -- linha com controle no destino (ex. NF do T4 faturada para Central → controle do T3 Central)
  coalesce(
    (select l2.sigla from public.movimento m join public.linha l2 on l2.id = m.linha_id where m.nota_fiscal_id = n.id limit 1),
    case when exists (select 1 from public.previsto p where p.canteiro_id = n.destino_canteiro_id and p.linha_id = n.linha_id) then l.sigla end,
    (select min(l3.sigla) from public.previsto p join public.linha l3 on l3.id = p.linha_id where p.canteiro_id = n.destino_canteiro_id
      having count(distinct p.linha_id) = 1),
    l.sigla
  ) as linha_local
from public.nota_fiscal n
left join public.linha l on l.id = n.linha_id
left join public.canteiro cd on cd.id = n.destino_canteiro_id
left join public.canteiro cr on cr.id = n.canteiro_id
left join lateral (
  select min(m.data) as recebida_em, count(*)::integer as recebimentos,
         (select count(*) from public.movimento_item i join public.movimento m2 on m2.id = i.movimento_id where m2.nota_fiscal_id = n.id)::integer as itens
  from public.movimento m where m.nota_fiscal_id = n.id
) r on true;
