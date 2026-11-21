// Modo desarrollo sin Nest CLI: tsc en watch + node --watch sobre dist/.
// (Se evita @nestjs/cli porque arrastra dependencias que la política trustPolicy de pnpm rechaza.)
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const children = [];

function run(args, label) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' });
  child.on('exit', (code) => {
    console.log(`[dev] ${label} terminó (código ${code})`);
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

function shutdown(code) {
  for (const c of children) if (!c.killed) c.kill();
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run([tsc, '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'], 'tsc');

// Espera a la primera compilación antes de levantar la API.
const main = join(root, 'dist', 'main.js');
const wait = setInterval(() => {
  if (!existsSync(main)) return;
  clearInterval(wait);
  run(['--watch', '--watch-preserve-output', main], 'api');
}, 500);
