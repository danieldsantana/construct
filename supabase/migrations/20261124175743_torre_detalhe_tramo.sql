-- torre_detalhe passa a trazer arranjo de ferragens, ancoragem e o tramo da torre.
-- Uma torre de ancoragem separa dois tramos; aqui ela é atribuída ao tramo que começa nela
-- (a última torre da linha fica no último tramo).

drop view public.torre_detalhe;

create view public.torre_detalhe
with (security_invoker = true)
as
select
  t.id, t.linha_id, t.numero, t.ordem, t.tipo_torre_id, t.altura_util, t.extensao,
  t.perna_a, t.perna_b, t.perna_c, t.perna_d, t.perna_referencia, t.observacao, t.lc_revisao,
  t.arranjo_ferragens, t.ancoragem,
  l.sigla       as linha_sigla,
  tt.codigo     as tipo,
  tt.categoria,
  tt.funcao,
  c.id          as canteiro_id,
  c.nome        as canteiro,
  tr.numero     as tramo
from public.torre t
join public.linha l       on l.id = t.linha_id
join public.tipo_torre tt on tt.id = t.tipo_torre_id
left join lateral (
  select f.canteiro_id
  from public.faixa_canteiro f
  join public.torre ti on ti.id = f.torre_inicial_id
  join public.torre tf on tf.id = f.torre_final_id
  where f.linha_id = t.linha_id and t.ordem between ti.ordem and tf.ordem
  limit 1
) fc on true
left join public.canteiro c on c.id = fc.canteiro_id
left join lateral (
  select x.numero
  from public.tramo x
  where x.linha_id = t.linha_id
    and t.ordem >= x.ordem_inicial
    and t.ordem <= x.ordem_final
  order by (t.ordem = x.ordem_final), x.numero   -- prefere o tramo que começa na torre
  limit 1
) tr on true;

comment on view public.torre_detalhe is 'Torre com linha, tipo, canteiro (faixa oficial) e tramo.';
