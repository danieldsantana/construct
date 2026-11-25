-- Atendimento de OF por componentes (25/11). Item da OF -> componente da LISTA (+ comprimento) e fator de unidade:
--   PR suspensão "(1 TORRE)" = 2 peças; "(PARA UM LADO)" = 1 · PR ancoragem "(1 TORRE)" = 2 conjuntos (2×POS 2H + 1×POS 3
--   cada); "(PARA UM LADO)" = 1 · STUB = 1 stub (peça de uma perna; 4 por torre — peso por unidade na OF = soma das posições
--   de 1 stub na matriz +~8%) · demais 1:1. Confirmado pelo usuário em 25/11.
-- Entregue = conjunto completo formado SÓ com os volumes das NFs que citam a OF (por canteiro de recebimento, somado),
-- convertido para a unidade da OF. Partes do mesmo componente (ex. C4SPE TRONCO COMUM I/II/III): vale o menor.
create function public.componente_do_item_of(d text, out componente text, out comprimento numeric, out fator numeric)
language sql immutable as $$
  with s as (select upper(translate(coalesce(d, ''), 'ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç', 'AAAAEEIOOOUCaaaaeeiooouc')) as t)
  select
    case
      when t like '%RAIO%SUSP%' then 'PR_SUSP'
      when t like '%RAIO%ANCOR%' then 'PR_ANC'
      when t like 'GABARITO%' then null
      when t like '%STUB%' then 'STUB'
      when t like 'PINO%' then 'PINO'
      when t like 'CALOTA%' then 'CALOTA'
      when t like 'CABECA%' then 'CABECA'
      when t like 'TRONCO%SUP%' then 'TRONCO_SUP'
      when t like 'TRONCO%INF%' then 'TRONCO_INF'
      when t like 'TRONCO%' then 'TRONCO'
      when t like 'EXT%' then 'EXT'
      when t like 'PE %' or t like 'PERNA%' then 'PERNA'
    end,
    case when t like 'EXT%' or t like 'PE %' or t like 'PERNA%'
         then replace(substring(t from '([0-9]+[,.][0-9]+)'), ',', '.')::numeric end,
    case when t like '%RAIO%' and t like '%UM LADO%' then 1
         when t like '%RAIO%' then 2
         else 1 end
  from s
$$;

create view public.of_componente
with (security_invoker = true)
as
with rec as (     -- recebido de cada material pelas NFs da OF, por linha/canteiro do recebimento
  select o.id as of_id, m.linha_id, m.canteiro_id, i.material_id, sum(i.quantidade) as q
  from public.ordem_fabricacao o
  join public.nota_fiscal nf on nf.of_numero = o.numero
  join public.movimento m on m.nota_fiscal_id = nf.id
  join public.movimento_item i on i.movimento_id = m.id
  group by 1, 2, 3, 4
), partes as (    -- partes tocadas pela OF em cada canteiro
  select distinct r.of_id, r.linha_id, r.canteiro_id, s.tipo, s.parte
  from rec r
  join public.saldo_material_detalhe s on s.material_id = r.material_id and s.linha_id = r.linha_id and s.canteiro_id = r.canteiro_id
  where s.parte is not null
), vols as (      -- todos os volumes previstos da parte no canteiro (o que não veio pela OF conta 0)
  select p.of_id, p.linha_id, p.canteiro_id, p.tipo, p.parte, s.previsto, coalesce(r.q, 0) as q,
         min(s.previsto) over (partition by p.of_id, p.linha_id, p.canteiro_id, p.tipo, p.parte) as pmin
  from partes p
  join public.saldo_material_detalhe s on s.linha_id = p.linha_id and s.canteiro_id = p.canteiro_id and s.tipo = p.tipo
       and s.parte = p.parte and s.previsto > 0
  left join rec r on r.of_id = p.of_id and r.material_id = s.material_id and r.linha_id = p.linha_id and r.canteiro_id = p.canteiro_id
), conj_parte as (
  select of_id, tipo, parte, sum(c) as conjunto
  from (select of_id, linha_id, canteiro_id, tipo, parte, min(floor(q / (previsto / pmin) + 1e-9)) as c
        from vols group by 1, 2, 3, 4, 5) x
  group by 1, 2, 3
), conj as (
  select of_id, tipo, (public.componente_da_parte(parte)).componente as componente,
         (public.componente_da_parte(parte)).comprimento as comprimento, min(conjunto) as conjunto
  from conj_parte group by 1, 2, 3, 4
)
select i.id as of_item_id, i.of_id, i.tipo_torre, i.descricao, i.quantidade, i.peso_kg,
       k.componente, k.comprimento, k.fator,
       c.conjunto,
       case when k.componente is null then null else floor(coalesce(c.conjunto, 0) / k.fator) end as entregue
from public.of_item i
cross join lateral public.componente_do_item_of(i.descricao) k
left join conj c on c.of_id = i.of_id and c.tipo = i.tipo_torre and c.componente = k.componente
  and c.comprimento is not distinct from k.comprimento;
