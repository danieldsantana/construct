-- OF da NF digitada no lançamento manual
alter table public.nota_fiscal drop constraint nota_fiscal_of_fonte_check;
alter table public.nota_fiscal add constraint nota_fiscal_of_fonte_check check (of_fonte in ('controle', 'pdf', 'manual'));
