-- Matriz de embalagem padronizada (aba BASE): catálogo de volumes e posições. Fonte de verdade de peso.
create table public.volume_matriz (
  id serial primary key,
  nome text not null unique,                 -- 'C4EP - CABEÇA (8/8)'
  tipo_torre text not null,                  -- 'C4EP'
  categoria text,                            -- AUTOPORTANTE / ESTAIADA
  parte text not null,                       -- 'CABEÇA'
  tipo_volume text,                          -- NORMAL / MESA / AVULSO
  sku text,                                  -- CÓD. EMBALAGEM (SAP) = SKU do romaneio (AVULSO não tem)
  ordem integer,                             -- k de (k/N)
  total integer,                             -- N de (k/N)
  peso numeric not null,                     -- soma do PESO TOTAL das posições
  fonte text not null
);
create index on public.volume_matriz (sku);
select public.aplicar_rls_padrao('public.volume_matriz');

create table public.posicao_matriz (
  id serial primary key,
  volume_id integer not null references public.volume_matriz(id) on delete cascade,
  item integer,
  posicao text,
  cod_posicao_sap text,
  quantidade numeric,
  tipo_material text,
  material text,
  comprimento_mm numeric,
  largura_mm numeric,
  peso_unit numeric,
  peso_total numeric,
  cod_parte_sap text
);
create index on public.posicao_matriz (volume_id);
select public.aplicar_rls_padrao('public.posicao_matriz');

-- Material do controle ligado ao volume da matriz (só quando o peso confere; ver scripts/importar/matriz.py)
alter table public.material add column volume_matriz_id integer references public.volume_matriz(id);
