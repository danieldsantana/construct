# Construct

Controle de recebimento e aplicação de estruturas metálicas de linhas de transmissão:
ordens de fabricação, notas fiscais e romaneios, estoque por canteiro, saídas para campo,
pendências por torre e não conformidades.

Este repositório contém apenas código. Nenhum dado de obra é versionado.

## Stack

- Frontend: Vite + React + TypeScript, publicado no GitHub Pages.
- Banco e login: Supabase (Postgres + Auth), com regras de acesso por linha (RLS).
- Importadores: Python (`scripts/importar/`), leem arquivos locais e gravam no banco.

## Desenvolvimento

```bash
cp .env.example .env      # preencher
npm install
npm run dev               # site local
npm run db:push           # aplica migrations pendentes (supabase/migrations)
pip install -r scripts/importar/requirements.txt
python scripts/importar/obra.py --simular
```
