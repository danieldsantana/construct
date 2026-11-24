-- Conjunto completo como o próprio controle calcula (coluna CONJUNTO COMPLETO da VOLUMES RECEBIDOS).
-- A regra varia por parte (ex.: para-raios de ancoragem = MIN(ARREDONDA.PARA.BAIXO(POS 2H ÷ 2), POS 3)),
-- por isso o valor é importado, não recalculado. Fica na primeira linha (material) de cada parte.

create table public.conjunto_controle (
  linha_id     smallint not null references public.linha (id),
  canteiro_id  smallint not null references public.canteiro (id),
  material_id  integer  not null references public.material (id),
  quantidade   numeric(14, 3) not null,
  fonte        text not null,
  primary key (linha_id, canteiro_id, material_id)
);
comment on table public.conjunto_controle is 'Conjunto completo por parte, valor da planilha de controle (importado).';

select public.aplicar_rls_padrao('public.conjunto_controle');
