-- Aba TABELAS de cada controle (bloco 1, por tipo de torre), como o controle mostra.
create table public.tabela_controle (
  linha_id smallint not null references public.linha(id),
  canteiro_id smallint not null references public.canteiro(id),
  tipo text not null,
  previsto integer not null,
  completas integer not null,            -- TORRES COM ESTRUTURA E FIXADORES COMPLETOS
  sem_fixadores integer,                 -- TORRES COM ESTRUTURA COMPLETA, MAS SEM FIXADORES
  sem_estrutura integer,                 -- TORRES SEM ESTRUTURA COMPLETA
  com_pendencia integer,                 -- TORRES COM PENDÊNCIA DE ESTRUTURA OU PARAFUSOS
  fonte text not null,
  primary key (linha_id, canteiro_id, tipo)
);
select public.aplicar_rls_padrao('public.tabela_controle');

create view public.tabela_controle_detalhe
with (security_invoker = true)
as
select l.sigla as linha, c.nome as canteiro, t.tipo, t.previsto, t.completas, t.sem_fixadores, t.sem_estrutura, t.com_pendencia, t.fonte
from public.tabela_controle t
join public.linha l on l.id = t.linha_id
join public.canteiro c on c.id = t.canteiro_id;

-- Conjunto completo de cada parte (valor do controle) × previsto da parte, para "partes que mais limitam".
create view public.parte_conjunto
with (security_invoker = true)
as
select l.sigla as linha, ca.nome as canteiro, tt.codigo as tipo, m.parte, m.descricao as primeiro_volume,
       cc.quantidade as conjunto, p.quantidade as previsto
from public.conjunto_controle cc
join public.material m on m.id = cc.material_id
left join public.tipo_torre tt on tt.id = m.tipo_torre_id
join public.previsto p on p.material_id = cc.material_id and p.linha_id = cc.linha_id and p.canteiro_id = cc.canteiro_id
join public.linha l on l.id = cc.linha_id
join public.canteiro ca on ca.id = cc.canteiro_id
where p.quantidade > 0;
