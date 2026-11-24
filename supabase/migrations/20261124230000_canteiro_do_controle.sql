-- Canteiro da torre = o do controle (aba LISTA em que a torre aparece), decisão do usuário em 24/11.
-- A faixa da distribuição oficial continua disponível em canteiro_oficial (para comparar).
alter table public.torre_controle add column canteiro_id smallint references public.canteiro(id);

create or replace view public.torre_detalhe
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
  tr.numero     as tramo,
  fc.canteiro_id as canteiro_oficial_id,
  co.nome       as canteiro_oficial
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
left join public.torre_controle tc on tc.torre_id = t.id
left join public.canteiro c on c.id = coalesce(tc.canteiro_id, fc.canteiro_id)
left join public.canteiro co on co.id = fc.canteiro_id
left join lateral (
  select x.numero
  from public.tramo x
  where x.linha_id = t.linha_id
    and t.ordem >= x.ordem_inicial
    and t.ordem <= x.ordem_final
  order by (t.ordem = x.ordem_final), x.numero   -- prefere o tramo que começa na torre
  limit 1
) tr on true;

comment on view public.torre_detalhe is 'Torre com linha, tipo, canteiro (do controle; senão faixa oficial), canteiro oficial e tramo.';
