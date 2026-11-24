-- Ordens de fabricação (OF) emitidas pelo cliente: aba "OFs BRAMETAL" do resumo de OFs.
-- Uma OF = cabeçalho + itens (componente × tipo de torre × quantidade × peso). Só T3 e T4.
create table public.ordem_fabricacao (
  id serial primary key,
  codigo text not null unique,               -- como está na planilha: OF-71607-EM-BRM-114, OFT
  numero integer,                            -- 114 (null quando não há número, ex. OFT)
  revisao integer,
  emitida_em date,
  entrega_prevista date,
  entrega_texto text,                        -- quando a planilha traz texto no lugar da data (ex. "Entregue")
  linha_id smallint not null references public.linha(id),
  canteiro_id smallint references public.canteiro(id),  -- canteiro de entrega da OF
  fonte text not null
);
create index on public.ordem_fabricacao (numero);
select public.aplicar_rls_padrao('public.ordem_fabricacao');

create table public.of_item (
  id serial primary key,
  of_id integer not null references public.ordem_fabricacao(id) on delete cascade,
  seq integer,                               -- coluna SEQ. da planilha
  tipo_torre text not null,
  descricao text not null,                   -- descrição do material como na OF (CABEÇA, PÉ 9,0m...)
  unidade text,
  quantidade numeric not null,
  peso_kg numeric not null
);
create index on public.of_item (of_id);
select public.aplicar_rls_padrao('public.of_item');

-- Resumo por OF: previsto (itens) × NFs que citam a OF (hoje: OF da linha "Ordem de Fabricação" dos controles do T4).
create view public.of_resumo
with (security_invoker = true)
as
select
  o.id, o.codigo, o.numero, o.revisao, o.emitida_em, o.entrega_prevista, o.entrega_texto,
  l.sigla as linha, c.nome as canteiro,
  i.itens, i.quantidade, i.peso_previsto,
  coalesce(n.nfs, 0) as nfs,
  coalesce(n.nfs_recebidas, 0) as nfs_recebidas,
  coalesce(n.peso_recebido, 0) as peso_recebido,
  n.ultima_recebida
from public.ordem_fabricacao o
join public.linha l on l.id = o.linha_id
left join public.canteiro c on c.id = o.canteiro_id
left join lateral (
  select count(*)::integer as itens, sum(it.quantidade) as quantidade, sum(it.peso_kg) as peso_previsto
  from public.of_item it where it.of_id = o.id
) i on true
left join lateral (
  select count(*)::integer as nfs,
         count(*) filter (where nf.situacao <> 'nao_recebida')::integer as nfs_recebidas,
         sum(nf.peso) filter (where nf.situacao <> 'nao_recebida') as peso_recebido,
         max(m.data) as ultima_recebida
  from public.nota_fiscal nf
  left join lateral (select max(mm.data) as data from public.movimento mm where mm.nota_fiscal_id = nf.id) m on true
  where o.numero is not null and nf.of_numero = o.numero
) n on true;

-- NFs recebidas de cada OF, por canteiro em que entraram (para a ficha da OF).
create view public.of_nf
with (security_invoker = true)
as
select o.id as of_id, nf.id as nf_id, nf.numero, nf.emissao, nf.peso, nf.situacao,
       cr.nome as canteiro_recebimento, l.sigla as linha_nf,
       (select min(m.data) from public.movimento m where m.nota_fiscal_id = nf.id) as recebida_em
from public.ordem_fabricacao o
join public.nota_fiscal nf on nf.of_numero = o.numero
left join public.canteiro cr on cr.id = nf.canteiro_id
left join public.linha l on l.id = nf.linha_id;
