-- Estoque por parte ligado à LISTA: conjunto completo do estoque (conjunto_atual) e até onde ele chega na sequência de
-- ataque (mesma distribuição que pinta a LISTA): torres atendidas, última atendida e próxima torre que espera a parte.
create view public.estoque_parte
with (security_invoker = true)
as
with tc as materialized (
  select p.torre_id, p.componente, p.comprimento, p.completo, t.linha_id, t.canteiro_id, t.tipo, t.numero, t.ordem, c.sequencia
  from public.torre_componente p
  join public.torre_detalhe t on t.id = p.torre_id
  join public.torre_controle c on c.torre_id = p.torre_id
), por_torre as (  -- uma torre é atendida na parte se TODAS as células dela daquele componente/comprimento estão completas
  select linha_id, canteiro_id, tipo, componente, comprimento, torre_id, numero, ordem, sequencia, bool_and(completo) as atendida
  from tc group by 1, 2, 3, 4, 5, 6, 7, 8, 9
), agg as (
  select linha_id, canteiro_id, tipo, componente, comprimento,
         count(*)::integer as torres,
         count(*) filter (where atendida)::integer as atendidas,
         (array_agg(numero order by coalesce(sequencia, 1000000 + ordem)) filter (where not atendida))[1] as proxima_torre,
         (array_agg(sequencia order by coalesce(sequencia, 1000000 + ordem)) filter (where not atendida))[1] as proxima_seq,
         (array_agg(numero order by coalesce(sequencia, 1000000 + ordem) desc) filter (where atendida))[1] as ultima_atendida
  from por_torre group by 1, 2, 3, 4, 5
)
select ca.linha_id, ca.linha, ca.canteiro_id, ca.canteiro, ca.tipo, ca.parte, ca.componente, ca.comprimento,
       ca.conjunto, ca.previsto,
       a.torres, a.atendidas, a.proxima_torre, a.proxima_seq, a.ultima_atendida
from public.conjunto_atual ca
left join agg a on a.linha_id = ca.linha_id and a.canteiro_id = ca.canteiro_id and a.tipo = ca.tipo
  and a.componente = ca.componente and a.comprimento is not distinct from ca.comprimento;
