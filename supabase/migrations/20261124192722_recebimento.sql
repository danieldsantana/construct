-- Recebimento: materiais (como nos controles), previsto por canteiro, notas fiscais e o razão de
-- movimentos. Nesta etapa os dados vêm dos controles Excel; cada coluna da ENTRADA vira um movimento.
-- Saldo nunca é digitado: é a soma dos movimentos.

create type public.situacao_nf as enum ('nao_recebida', 'em_conferencia', 'confirmada');
create type public.tipo_movimento as enum ('recebimento', 'transferencia', 'saida_campo', 'ajuste');

create table public.material (
  id             integer generated always as identity primary key,
  secao          text not null,               -- como no controle: 'ESTRUTURA - C4EL', 'FIXADORES'
  descricao      text not null,               -- 'EMB C4EL (CABEÇA - C4EL) (VOL 1/8)'
  tipo_torre_id  smallint references public.tipo_torre (id),
  parte          text,                        -- 'CABEÇA' (coluna PARTE da VOLUMES RECEBIDOS)
  unidade        text not null,               -- 'Cj', 'Un'
  peso_unit      numeric(12, 4),              -- kg (VOLUMES RECEBIDOS; vazio quando não há fonte)
  ordem          integer not null,            -- linha da planilha, para exibir na mesma ordem
  unique (secao, descricao)
);
comment on table public.material is 'Item controlado no recebimento (volume, para-raios, pino, calota, stub, fixador), com o nome usado nos controles.';
create index on public.material (tipo_torre_id);

create table public.previsto (
  linha_id     smallint not null references public.linha (id),
  canteiro_id  smallint not null references public.canteiro (id),
  material_id  integer  not null references public.material (id),
  quantidade   numeric(14, 3) not null,
  fonte        text not null,                 -- de onde veio o número (arquivo/aba/coluna)
  primary key (linha_id, canteiro_id, material_id)
);
comment on table public.previsto is 'Quantidade prevista por linha, canteiro e material (por enquanto, a coluna PREVISTO da ENTRADA).';

create table public.nota_fiscal (
  id           integer generated always as identity primary key,
  numero       text not null unique,          -- só dígitos
  emissao      date,
  fornecedor   text,
  of_texto     text,                          -- como veio ('OF-114')
  of_numero    integer,
  romaneio     text,
  valor        numeric(14, 2),
  peso         numeric(14, 3),                -- kg
  linha_id     smallint references public.linha (id),
  canteiro_id  smallint references public.canteiro (id),   -- destino / onde foi recebida
  situacao     public.situacao_nf not null default 'nao_recebida',
  recebida_em  date,
  origem       text not null,
  criado_em    timestamptz not null default now()
);
comment on table public.nota_fiscal is 'Nota fiscal do fabricante. Uma NF pode ter mais de um movimento (recebida em partes ou em canteiros diferentes).';

create table public.movimento (
  id              integer generated always as identity primary key,
  tipo            public.tipo_movimento not null,
  data            date not null,              -- data em que aconteceu (recebimento, saída…)
  linha_id        smallint not null references public.linha (id),
  canteiro_id     smallint not null references public.canteiro (id),
  nota_fiscal_id  integer references public.nota_fiscal (id),
  documento       text,                       -- rótulo do documento como veio ('TRANSFERÊNCIA', romaneio 'PINOS')
  origem          text not null,              -- importação: 'controle:<arquivo>#<coluna>'; lançamento: 'ferramenta'
  observacao      text,
  criado_por      uuid default auth.uid() references auth.users (id),
  criado_em       timestamptz not null default now()
);
comment on table public.movimento is 'Razão: cada entrada, transferência, saída ou ajuste. Correção = novo movimento, nunca edição.';
create index on public.movimento (linha_id, canteiro_id);
create index on public.movimento (nota_fiscal_id);

create table public.movimento_item (
  id           bigint generated always as identity primary key,
  movimento_id integer not null references public.movimento (id) on delete cascade,
  material_id  integer not null references public.material (id),
  quantidade   numeric(14, 3) not null check (quantidade <> 0)   -- negativa = saída do canteiro
);
create index on public.movimento_item (movimento_id);
create index on public.movimento_item (material_id);

-- Previsto × recebido por linha, canteiro e material (o equivalente às colunas PREVISTO/RECEBIDO da ENTRADA).
create view public.saldo_material
with (security_invoker = true)
as
with mov as (
  select mv.linha_id, mv.canteiro_id, mi.material_id,
         sum(mi.quantidade) filter (where mv.tipo in ('recebimento', 'transferencia')) as recebido,
         sum(-mi.quantidade) filter (where mv.tipo = 'saida_campo')                    as saido,
         sum(mi.quantidade)                                                            as saldo
  from public.movimento mv
  join public.movimento_item mi on mi.movimento_id = mv.id
  group by 1, 2, 3
)
select
  coalesce(p.linha_id, mov.linha_id)       as linha_id,
  coalesce(p.canteiro_id, mov.canteiro_id) as canteiro_id,
  m.id as material_id, m.secao, m.descricao, m.parte, m.tipo_torre_id, m.unidade, m.peso_unit, m.ordem,
  coalesce(p.quantidade, 0)  as previsto,
  coalesce(mov.recebido, 0)  as recebido,
  coalesce(mov.saido, 0)     as saido,
  coalesce(mov.saldo, 0)     as saldo
from public.previsto p
full join mov on mov.linha_id = p.linha_id and mov.canteiro_id = p.canteiro_id and mov.material_id = p.material_id
join public.material m on m.id = coalesce(p.material_id, mov.material_id);

select public.aplicar_rls_padrao('public.material');
select public.aplicar_rls_padrao('public.previsto');
select public.aplicar_rls_padrao('public.nota_fiscal');
select public.aplicar_rls_padrao('public.movimento');
select public.aplicar_rls_padrao('public.movimento_item');
