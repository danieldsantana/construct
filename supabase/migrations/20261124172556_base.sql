-- Base: perfis de acesso e regras comuns a todas as tabelas.
--
-- Papéis:  editor = lança e altera;  leitor = só consulta.
-- O papel anônimo (site sem login) não acessa nada.

-- 1. Defesa em profundidade: objetos novos do schema public não ficam abertos ao anônimo.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon, public;

-- 2. Perfil de cada usuário do login
create type public.papel as enum ('editor', 'leitor');

create table public.perfil (
  id         uuid primary key references auth.users (id) on delete cascade,
  nome       text not null,
  papel      public.papel not null default 'leitor',
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);
comment on table public.perfil is
  'Usuário da ferramenta: nome e papel (editor lança, leitor só consulta). Criado automaticamente no primeiro cadastro do login.';

create function public.criar_perfil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.perfil (id, nome)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'nome', ''), split_part(new.email, '@', 1))
  );
  return new;
end
$$;

create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.criar_perfil();

-- 3. Quem pode ler / editar (usadas por todas as políticas)
create function public.pode_ler()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.perfil where id = (select auth.uid()) and ativo);
$$;

create function public.pode_editar()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.perfil
    where id = (select auth.uid()) and ativo and papel = 'editor'
  );
$$;

grant execute on function public.pode_ler(), public.pode_editar() to authenticated;

alter table public.perfil enable row level security;

create policy "perfil: cada um vê o seu; editor vê todos"
  on public.perfil for select to authenticated
  using (id = (select auth.uid()) or (select public.pode_editar()));

create policy "perfil: só editor altera"
  on public.perfil for update to authenticated
  using ((select public.pode_editar()))
  with check ((select public.pode_editar()));

-- 4. Regra padrão das tabelas de dados: leitor lê, editor escreve.
--    Uso nas próximas migrations:  select public.aplicar_rls_padrao('public.<tabela>');
create function public.aplicar_rls_padrao(tabela regclass)
returns void
language plpgsql
as $$
begin
  execute format('alter table %s enable row level security', tabela);
  execute format(
    'create policy "ler" on %s for select to authenticated using ((select public.pode_ler()))',
    tabela);
  execute format(
    'create policy "incluir" on %s for insert to authenticated with check ((select public.pode_editar()))',
    tabela);
  execute format(
    'create policy "alterar" on %s for update to authenticated using ((select public.pode_editar())) with check ((select public.pode_editar()))',
    tabela);
  execute format(
    'create policy "excluir" on %s for delete to authenticated using ((select public.pode_editar()))',
    tabela);
end
$$;

revoke execute on function public.aplicar_rls_padrao(regclass) from public, anon, authenticated;
revoke execute on function public.criar_perfil() from public, anon, authenticated;
