-- Fluxo de lançamento das NFs (decisões do usuário 25/11):
--   emitida (situacao 'nao_recebida', itens da NF em nf_item: do PDF ou digitados como uma coluna da ENTRADA)
--   → recebida/em conferência (o pátio avisou; cria o movimento de recebimento no canteiro, com data)
--   → confirmada (só então entra no estoque), com ou sem pendências.
-- Pendência = peça/volume/fixador que faltou ou veio avariado: sai do recebido até a reposição; a RNC/SAC é preenchida depois.

create table public.nf_item (
  id bigserial primary key,
  nota_fiscal_id integer not null references public.nota_fiscal(id) on delete cascade,
  material_id integer not null references public.material(id),
  quantidade numeric not null check (quantidade <> 0),
  unique (nota_fiscal_id, material_id)
);
select public.aplicar_rls_padrao('public.nf_item');

alter table public.nota_fiscal add column lancamento text check (lancamento in ('pdf', 'manual')),
                               add column lancada_em timestamptz, add column confirmada_em timestamptz;

create table public.nf_pendencia (
  id bigserial primary key,
  nota_fiscal_id integer not null references public.nota_fiscal(id) on delete cascade,
  tipo text not null check (tipo in ('peca', 'volume', 'fixador')),
  material_id integer references public.material(id),     -- volume (ou o volume da peça) / fixador que sai do recebido
  descricao text,                                         -- ex. posição da peça (POS 381), o que o pátio informou
  quantidade numeric not null check (quantidade > 0),
  motivo text not null default 'falta' check (motivo in ('falta', 'avaria')),
  observacao text,
  rnc text, sac text, abertura date,                      -- preenchidos depois, com os dados da Qualidade
  situacao text not null default 'aberta' check (situacao in ('aberta', 'reposta', 'cancelada')),
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid()
);
create index on public.nf_pendencia (nota_fiscal_id);
select public.aplicar_rls_padrao('public.nf_pendencia');

-- Estoque: recebimento de NF só conta com a NF CONFIRMADA; pendência aberta sai do recebido.
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
  select mv.linha_id, mv.canteiro_id, p.material_id, -sum(p.quantidade), 0, -sum(p.quantidade)
  from public.nf_pendencia p
  join public.nota_fiscal nf on nf.id = p.nota_fiscal_id and nf.situacao = 'confirmada'
  join lateral (select m.linha_id, m.canteiro_id from public.movimento m where m.nota_fiscal_id = nf.id order by m.id limit 1) mv on true
  where p.situacao = 'aberta' and p.material_id is not null
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

-- ---------- funções do fluxo (a tela só chama estas; RLS + checagem de editor) ----------
create function public.nf_salvar(p jsonb) returns integer
language plpgsql security invoker as $$
declare
  v_id integer;
  v_sit public.situacao_nf;
begin
  if not public.pode_editar() then raise exception 'Sem permissão de edição'; end if;
  if coalesce(trim(p->>'numero'), '') !~ '^[0-9]+$' then raise exception 'Número da NF inválido'; end if;
  select id, situacao into v_id, v_sit from public.nota_fiscal where numero = ltrim(p->>'numero', '0');
  if v_id is not null and (v_sit <> 'nao_recebida' or exists (select 1 from public.movimento where nota_fiscal_id = v_id)) then
    raise exception 'A NF % já foi recebida; não pode ser relançada', p->>'numero';
  end if;
  if v_id is null then
    insert into public.nota_fiscal (numero, situacao, origem) values (ltrim(p->>'numero', '0'), 'nao_recebida', 'app:' || coalesce(p->>'lancamento', 'manual'))
    returning id into v_id;
  end if;
  update public.nota_fiscal set
    emissao = coalesce(nullif(p->>'emissao', '')::date, emissao),
    fornecedor = coalesce(nullif(p->>'fornecedor', ''), fornecedor, 'BRAMETAL'),
    of_texto = coalesce(nullif(p->>'of', ''), of_texto),
    of_numero = coalesce((select (regexp_match(p->>'of', 'BRM-(\d+)'))[1]::integer), (select (regexp_match(p->>'of', '^\s*OF\s*-\s*(\d+)'))[1]::integer), of_numero),
    of_fonte = case when nullif(p->>'of', '') is not null then coalesce(p->>'lancamento', 'manual') else of_fonte end,
    romaneio = coalesce(nullif(p->>'romaneio', ''), romaneio),
    valor = coalesce(nullif(p->>'valor', '')::numeric, valor),
    peso = coalesce(nullif(p->>'peso', '')::numeric, peso),
    linha_id = coalesce((select id from public.linha where sigla = p->>'linha'), linha_id),
    destino_canteiro_id = coalesce((select id from public.canteiro where nome = p->>'destino'), destino_canteiro_id),
    lancamento = coalesce(p->>'lancamento', 'manual'),
    lancada_em = now()
  where id = v_id;
  delete from public.nf_item where nota_fiscal_id = v_id;
  insert into public.nf_item (nota_fiscal_id, material_id, quantidade)
  select v_id, (i->>'material_id')::integer, sum((i->>'quantidade')::numeric)
  from jsonb_array_elements(coalesce(p->'itens', '[]'::jsonb)) i
  where coalesce((i->>'quantidade')::numeric, 0) <> 0
  group by 2;
  return v_id;
end $$;

create function public.nf_marcar_recebida(p_nf integer, p_data date, p_canteiro text, p_linha text default null) returns integer
language plpgsql security invoker as $$
declare
  v_nf public.nota_fiscal;
  v_mov integer;
  v_lin smallint;
  v_can smallint;
begin
  if not public.pode_editar() then raise exception 'Sem permissão de edição'; end if;
  select * into v_nf from public.nota_fiscal where id = p_nf for update;
  if v_nf.id is null then raise exception 'NF não encontrada'; end if;
  if v_nf.situacao <> 'nao_recebida' or exists (select 1 from public.movimento where nota_fiscal_id = p_nf) then
    raise exception 'A NF % já está recebida', v_nf.numero;
  end if;
  if not exists (select 1 from public.nf_item where nota_fiscal_id = p_nf) then
    raise exception 'A NF % não tem itens lançados (lance pelo PDF ou manualmente antes de receber)', v_nf.numero;
  end if;
  select id into v_can from public.canteiro where nome = p_canteiro;
  if v_can is null then raise exception 'Canteiro % não encontrado', p_canteiro; end if;
  v_lin := coalesce((select id from public.linha where sigla = p_linha), v_nf.linha_id);
  if v_lin is null then raise exception 'Informe a linha'; end if;
  insert into public.movimento (tipo, data, linha_id, canteiro_id, nota_fiscal_id, documento, origem, observacao)
  values ('recebimento', p_data, v_lin, v_can, p_nf, nullif(v_nf.romaneio, ''), 'app:recebimento:NF' || v_nf.numero,
          'Lançada no app (' || coalesce(v_nf.lancamento, 'manual') || ')')
  returning id into v_mov;
  insert into public.movimento_item (movimento_id, material_id, quantidade)
  select v_mov, material_id, quantidade from public.nf_item where nota_fiscal_id = p_nf;
  update public.nota_fiscal set situacao = 'em_conferencia', canteiro_id = v_can, recebida_em = p_data,
         linha_id = coalesce(linha_id, v_lin) where id = p_nf;
  return v_mov;
end $$;

-- p_pendencias: [{tipo, material_id, descricao, quantidade, motivo, observacao}]
create function public.nf_confirmar(p_nf integer, p_pendencias jsonb default '[]'::jsonb) returns void
language plpgsql security invoker as $$
declare
  v_nf public.nota_fiscal;
begin
  if not public.pode_editar() then raise exception 'Sem permissão de edição'; end if;
  select * into v_nf from public.nota_fiscal where id = p_nf for update;
  if v_nf.situacao <> 'em_conferencia' then raise exception 'A NF % não está em conferência', v_nf.numero; end if;
  insert into public.nf_pendencia (nota_fiscal_id, tipo, material_id, descricao, quantidade, motivo, observacao)
  select p_nf, x->>'tipo', nullif(x->>'material_id', '')::integer, nullif(x->>'descricao', ''), (x->>'quantidade')::numeric,
         coalesce(nullif(x->>'motivo', ''), 'falta'), nullif(x->>'observacao', '')
  from jsonb_array_elements(coalesce(p_pendencias, '[]'::jsonb)) x;
  update public.nota_fiscal set situacao = 'confirmada', confirmada_em = now() where id = p_nf;
end $$;

-- volta uma NF recebida por engano para "emitida" (apaga o recebimento do app; não mexe em NF de controle Excel)
create function public.nf_desfazer_recebimento(p_nf integer) returns void
language plpgsql security invoker as $$
begin
  if not public.pode_editar() then raise exception 'Sem permissão de edição'; end if;
  if exists (select 1 from public.movimento where nota_fiscal_id = p_nf and origem not like 'app:%') then
    raise exception 'Recebimento veio do controle Excel; não pode ser desfeito aqui';
  end if;
  delete from public.nf_pendencia where nota_fiscal_id = p_nf;
  delete from public.movimento where nota_fiscal_id = p_nf and origem like 'app:%';
  update public.nota_fiscal set situacao = 'nao_recebida', recebida_em = null, confirmada_em = null where id = p_nf;
end $$;

revoke execute on function public.nf_salvar(jsonb), public.nf_marcar_recebida(integer, date, text, text),
  public.nf_confirmar(integer, jsonb), public.nf_desfazer_recebimento(integer) from anon, public;
grant execute on function public.nf_salvar(jsonb), public.nf_marcar_recebida(integer, date, text, text),
  public.nf_confirmar(integer, jsonb), public.nf_desfazer_recebimento(integer) to authenticated;

-- Itens e pendências com nomes, para as telas
create view public.nf_item_detalhe with (security_invoker = true) as
select i.nota_fiscal_id, i.material_id, i.quantidade, m.secao, m.descricao, m.parte, m.unidade, m.peso_unit, m.ordem
from public.nf_item i join public.material m on m.id = i.material_id;

create view public.nf_pendencia_detalhe with (security_invoker = true) as
select p.*, n.numero as nf, m.descricao as material
from public.nf_pendencia p join public.nota_fiscal n on n.id = p.nota_fiscal_id left join public.material m on m.id = p.material_id;

-- As 3 NFs lançadas pelo script em 24/11 (260720/21/22) passam a seguir o fluxo: itens em nf_item, recebimento do app.
insert into public.nf_item (nota_fiscal_id, material_id, quantidade)
select m.nota_fiscal_id, i.material_id, sum(i.quantidade)
from public.movimento m join public.movimento_item i on i.movimento_id = m.id
where m.origem like 'lancamento:romaneio:%'
group by 1, 2
on conflict (nota_fiscal_id, material_id) do nothing;
update public.nota_fiscal n set lancamento = 'pdf', lancada_em = coalesce(lancada_em, now())
where exists (select 1 from public.movimento m where m.nota_fiscal_id = n.id and m.origem like 'lancamento:romaneio:%');
update public.movimento set origem = 'app:recebimento:NF' || substring(origem from 'NF(\d+)$') where origem like 'lancamento:romaneio:%';
