// Aplica as migrations pendentes de supabase/migrations no banco remoto.
// Lê SUPABASE_DB_URL do .env (nunca exibe a senha).
//   npm run db:push            aplica
//   npm run db:push -- --dry-run   só mostra o que seria aplicado
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);

const url = env.SUPABASE_DB_URL;
if (!url || url.includes('SUA_SENHA')) {
  console.error('SUPABASE_DB_URL não está preenchida no .env');
  process.exit(1);
}

const extra = process.argv.slice(2);
const r = spawnSync('npx', ['supabase', 'db', 'push', `--remote=${url}`, '--yes', ...extra], {
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
  encoding: 'utf8',
});
const mask = (s) => (s || '').replaceAll(url, '<SUPABASE_DB_URL>').replace(/(:\/\/[^:]+:)[^@]+@/g, '$1****@');
process.stdout.write(mask(r.stdout));
process.stderr.write(mask(r.stderr));
process.exit(r.status ?? 1);
