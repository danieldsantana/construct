-- Obra: linhas, canteiros, tipos de torre, torres (da LC) e faixas de canteiro.

create type public.categoria_torre as enum ('estaiada', 'autoportante');

create table public.linha (
  id                  smallint generated always as identity primary key,
  sigla               text not null unique,     -- T3, T4
  codigo              text not null unique,     -- CAFII-BRRII
  nome                text not null,            -- LT 500 kV Campo Formoso II – Barra II C1
  lc_documento        text,                     -- código do documento da Lista de Construção
  lc_revisao          text,
  sentido_lancamento  text check (sentido_lancamento in ('crescente', 'decrescente'))
);
comment on table public.linha is 'Linha de transmissão (trecho da obra) com sua Lista de Construção vigente.';

create table public.canteiro (
  id            smallint generated always as identity primary key,
  nome          text not null unique,           -- Juazeiro, Laje dos Negros…
  uf            char(2) not null default 'BA',
  cnpj_destino  text                            -- CNPJ da filial do cliente que aparece na NF
);
comment on table public.canteiro is 'Pátio físico de materiais. Pode atender mais de uma linha.';

create table public.tipo_torre (
  id         smallint generated always as identity primary key,
  codigo     text not null unique,              -- C4EL, C4SL…
  categoria  public.categoria_torre not null,
  funcao     text check (funcao in ('suspensão', 'ancoragem', 'terminal', 'transposição'))
);
comment on table public.tipo_torre is 'Tipo de estrutura. A função define os tramos (trechos entre ancoragens).';

create table public.torre (
  id                integer generated always as identity primary key,
  linha_id          smallint not null references public.linha (id),
  numero            text not null,              -- 8/2
  ordem             integer not null,           -- posição na LC (1 = primeira estrutura)
  tipo_torre_id     smallint not null references public.tipo_torre (id),
  altura_util       numeric(5, 2) not null,     -- m
  extensao          numeric(5, 2),              -- m (autoportante)
  perna_a           numeric(5, 2),              -- m
  perna_b           numeric(5, 2),
  perna_c           numeric(5, 2),
  perna_d           numeric(5, 2),
  perna_referencia  char(1) check (perna_referencia in ('A', 'B', 'C', 'D')),
  observacao        text,
  lc_revisao        text,
  unique (linha_id, numero),
  unique (linha_id, ordem)
);
comment on table public.torre is 'Estrutura da Lista de Construção.';
create index on public.torre (tipo_torre_id);

create table public.faixa_canteiro (
  id                smallint generated always as identity primary key,
  linha_id          smallint not null references public.linha (id),
  canteiro_id       smallint not null references public.canteiro (id),
  torre_inicial_id  integer not null references public.torre (id),
  torre_final_id    integer not null references public.torre (id),
  unique (linha_id, canteiro_id)
);
comment on table public.faixa_canteiro is 'Torres de uma linha atendidas por um canteiro (distribuição oficial).';

-- Torre com o canteiro que a atende (pela faixa oficial)
create view public.torre_detalhe
with (security_invoker = true)
as
select
  t.*,
  l.sigla       as linha_sigla,
  tt.codigo     as tipo,
  tt.categoria,
  c.id          as canteiro_id,
  c.nome        as canteiro
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
left join public.canteiro c on c.id = fc.canteiro_id;

select public.aplicar_rls_padrao('public.linha');
select public.aplicar_rls_padrao('public.canteiro');
select public.aplicar_rls_padrao('public.tipo_torre');
select public.aplicar_rls_padrao('public.torre');
select public.aplicar_rls_padrao('public.faixa_canteiro');
