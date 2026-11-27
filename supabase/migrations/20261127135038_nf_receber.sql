-- Recebimento em um passo: a NF emitida é marcada como recebida e confirmada de uma vez, sem ou com pendências
-- (o que não chegou, ou chegou avariado, fica fora do estoque até a reposição; RNC opcional).
-- Peça faltante deixa o volume incompleto: sai 1 volume por NF (não a quantidade de peças).

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
  left join public.nota_fiscal nf on nf.id = mv.nota_fiscal_id
  where mv.nota_fiscal_id is null or nf.situacao = 'confirmada'
  group by 1, 2, 3
  union all
  -- volume/fixador: sai a quantidade que faltou; peça faltante: o volume dela fica incompleto (sai 1 por NF e volume)
  select mv.linha_id, mv.canteiro_id, x.material_id, -sum(x.q), 0, -sum(x.q)
  from (
    select p.nota_fiscal_id, p.material_id,
           coalesce(sum(p.quantidade) filter (where p.tipo <> 'peca'), 0)
           + case when bool_or(p.tipo = 'peca') then 1 else 0 end as q
    from public.nf_pendencia p
    where p.situacao = 'aberta' and p.material_id is not null
    group by 1, 2
  ) x
  join public.nota_fiscal nf on nf.id = x.nota_fiscal_id and nf.situacao = 'confirmada'
  join lateral (select m.linha_id, m.canteiro_id from public.movimento m where m.nota_fiscal_id = nf.id order by m.id limit 1) mv on true
  group by 1, 2, 3
), mov2 as (
  select linha_id, canteiro_id, material_id, sum(recebido) as recebido, sum(saido) as saido, sum(saldo) as saldo
  from mov group by 1, 2, 3
)
select
  coalesce(p.linha_id, mov2.linha_id)       as linha_id,
  coalesce(p.canteiro_id, mov2.canteiro_id) as canteiro_id,
  m.id as material_id, m.secao, m.descricao, m.parte, m.tipo_torre_id, m.unidade, m.peso_unit, m.ordem,
  coalesce(p.quantidade, 0)  as previsto,
  coalesce(mov2.recebido, 0) as recebido,
  coalesce(mov2.saido, 0)    as saido,
  coalesce(mov2.saldo, 0)    as saldo
from public.previsto p
full join mov2 on mov2.linha_id = p.linha_id and mov2.canteiro_id = p.canteiro_id and mov2.material_id = p.material_id
join public.material m on m.id = coalesce(p.material_id, mov2.material_id);

-- pendências: [{tipo, material_id, descricao, quantidade, motivo, observacao, rnc}]
create or replace function public.nf_confirmar(p_nf integer, p_pendencias jsonb default '[]'::jsonb) returns void
language plpgsql security invoker as $$
declare
  v_nf public.nota_fiscal;
begin
  if not public.pode_editar() then raise exception 'Sem permissão de edição'; end if;
  select * into v_nf from public.nota_fiscal where id = p_nf for update;
  if v_nf.situacao <> 'em_conferencia' then raise exception 'A NF % não está em conferência', v_nf.numero; end if;
  insert into public.nf_pendencia (nota_fiscal_id, tipo, material_id, descricao, quantidade, motivo, observacao, rnc)
  select p_nf, x->>'tipo', nullif(x->>'material_id', '')::integer, nullif(x->>'descricao', ''), (x->>'quantidade')::numeric,
         coalesce(nullif(x->>'motivo', ''), 'falta'), nullif(x->>'observacao', ''), nullif(trim(x->>'rnc'), '')
  from jsonb_array_elements(coalesce(p_pendencias, '[]'::jsonb)) x;
  update public.nota_fiscal set situacao = 'confirmada', confirmada_em = now() where id = p_nf;
end $$;

create function public.nf_receber(p_nf integer, p_data date, p_canteiro text, p_linha text default null,
                                  p_pendencias jsonb default '[]'::jsonb) returns void
language plpgsql security invoker as $$
begin
  perform public.nf_marcar_recebida(p_nf, p_data, p_canteiro, p_linha);
  perform public.nf_confirmar(p_nf, p_pendencias);
end $$;
