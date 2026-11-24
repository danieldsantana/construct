-- De onde veio a OF da NF: 'controle' (linha "Ordem de Fabricação" da ENTRADA) ou 'pdf' (campo "OC:" do DANFE).
alter table public.nota_fiscal add column of_fonte text check (of_fonte in ('controle', 'pdf'));
update public.nota_fiscal set of_fonte = 'controle' where of_texto is not null;
