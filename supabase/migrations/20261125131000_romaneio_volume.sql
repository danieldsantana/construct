-- Ligação de cada linha do romaneio ao volume da matriz, feita na importação (scripts/importar/romaneios.py):
-- 'sku' = SKU igual ao da matriz; 'nome+peso' = parte + volume k/N da descrição E peso unitário igual ao da matriz
-- (códigos de parte SAP mais novos que a matriz); 'peca' = posição avulsa (POS …), não é volume; null = sem ligação.
alter table public.romaneio_item add column volume_matriz_id integer references public.volume_matriz(id), add column ligacao text;

create or replace view public.nf_conferencia
with (security_invoker = true)
as
with rom as (
  select r.nota_fiscal_id, v.id as volume_id, v.nome as volume, sum(r.quantidade) as qtd_romaneio
  from public.romaneio_item r
  join public.nota_fiscal n on n.id = r.nota_fiscal_id and n.romaneio_confere
  left join public.volume_matriz v on v.id = r.volume_matriz_id
  where r.tipo_ud = 'FD' and coalesce(r.ligacao, '') <> 'peca'
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
