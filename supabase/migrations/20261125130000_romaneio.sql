-- Romaneio das NFs (lido do PDF digital: uma linha por UD) e conferência NF a NF romaneio × lançamento (ENTRADA/app).
create table public.romaneio_item (
  id bigserial primary key,
  nota_fiscal_id integer not null references public.nota_fiscal(id) on delete cascade,
  seq integer not null,
  remessa text,
  ud text,
  sku text not null,
  lote text,
  tipo_ud text,                 -- FD = fardo/volume de estrutura · CM = fixadores avulsos
  ov text,
  item_ov text,
  descricao text,
  quantidade numeric not null,
  peso_unit numeric,
  peso_total numeric,
  pagina integer
);
create index on public.romaneio_item (nota_fiscal_id);
create index on public.romaneio_item (sku);
select public.aplicar_rls_padrao('public.romaneio_item');

-- Situação da leitura do romaneio da NF: confere = sequência completa e soma = peso do DANFE (ou, sem peso no DANFE,
-- = "Peso NF" da ENTRADA do controle); senão o motivo fica em romaneio_obs.
alter table public.nota_fiscal add column romaneio_confere boolean, add column romaneio_obs text, add column peso_danfe numeric;

-- Conferência por NF e volume da matriz: o que o romaneio diz (SKU → volume da matriz) × o que foi lançado para a NF
-- (movimentos da NF; material → volume da matriz). Só volumes de estrutura (FD); fixadores avulsos ainda sem de-para.
create view public.nf_conferencia
with (security_invoker = true)
as
with rom as (
  select r.nota_fiscal_id, v.id as volume_id, v.nome as volume, sum(r.quantidade) as qtd_romaneio
  from public.romaneio_item r
  join public.nota_fiscal n on n.id = r.nota_fiscal_id and n.romaneio_confere
  left join public.volume_matriz v on v.sku = r.sku
  where r.tipo_ud = 'FD'
  group by 1, 2, 3
), lanc as (
  select m.nota_fiscal_id, ma.volume_matriz_id as volume_id, sum(i.quantidade) as qtd_lancada
  from public.movimento m
  join public.movimento_item i on i.movimento_id = m.id
  join public.material ma on ma.id = i.material_id
  where m.nota_fiscal_id is not null and ma.parte is not null
  group by 1, 2
)
select coalesce(rom.nota_fiscal_id, lanc.nota_fiscal_id) as nota_fiscal_id,
       coalesce(rom.volume_id, lanc.volume_id) as volume_id,
       coalesce(rom.volume, v.nome) as volume,
       coalesce(rom.qtd_romaneio, 0) as qtd_romaneio,
       coalesce(lanc.qtd_lancada, 0) as qtd_lancada
from rom
full join lanc on lanc.nota_fiscal_id = rom.nota_fiscal_id and lanc.volume_id is not distinct from rom.volume_id
left join public.volume_matriz v on v.id = coalesce(rom.volume_id, lanc.volume_id)
where coalesce(rom.nota_fiscal_id, lanc.nota_fiscal_id) in (select id from public.nota_fiscal where romaneio_confere);
