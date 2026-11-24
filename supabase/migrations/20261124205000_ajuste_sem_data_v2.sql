-- Ajuste pode não ter data (ex.: quantidade digitada na coluna de rótulos da ENTRADA, sem NF nem data).
-- Os demais movimentos continuam exigindo a data em que aconteceram.
alter table public.movimento alter column data drop not null;
alter table public.movimento add constraint movimento_data_obrigatoria check (data is not null or tipo = 'ajuste');
