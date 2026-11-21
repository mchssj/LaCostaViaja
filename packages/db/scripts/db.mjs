#!/usr/bin/env node
// Runner mínimo de migraciones/seeds/tests SQL.
//  - Cada archivo se aplica una sola vez, en orden, dentro de su propia transacción.
//  - Se registra el checksum: si un archivo ya aplicado cambia, se aborta (las migraciones son inmutables).
//  - Advisory lock: varias réplicas del API arrancando a la vez (auto-escalado en temporada) no migran en paralelo.
//  - Los tests SQL corren dentro de una transacción que SIEMPRE se revierte.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = {
  migrations: join(ROOT, 'migrations'),
  seeds: join(ROOT, 'seeds'),
  tests: join(ROOT, 'tests'),
};
const LOCK_KEY = 4_211_201; // clave arbitraria y estable para pg_advisory_lock

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

async function sqlFiles(dir) {
  return (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
}

async function applyDir(client, dir, trackingTable) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${trackingTable} (
      filename   text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
  await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
  try {
    const { rows } = await client.query(`SELECT filename, checksum FROM ${trackingTable}`);
    const applied = new Map(rows.map((r) => [r.filename, r.checksum]));
    let count = 0;
    for (const file of await sqlFiles(dir)) {
      const sql = await readFile(join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = applied.get(file);
      if (previous) {
        if (previous !== checksum) {
          fail(`${file} ya fue aplicado y su contenido cambió. Creá un archivo nuevo en lugar de editarlo.`);
        }
        continue;
      }
      process.stdout.write(`→ ${file} ... `);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(`INSERT INTO ${trackingTable} (filename, checksum) VALUES ($1, $2)`, [file, checksum]);
        await client.query('COMMIT');
        console.log('ok');
        count++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.log('ERROR');
        fail(`${file}: ${err.message}${err.where ? `\n  ${err.where}` : ''}`);
      }
    }
    console.log(count === 0 ? '✔ Nada pendiente.' : `✔ ${count} archivo(s) aplicados en ${trackingTable}.`);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
  }
}

async function runTests(client) {
  let failed = 0;
  for (const file of await sqlFiles(DIRS.tests)) {
    console.log(`▶ ${file}`);
    const sql = await readFile(join(DIRS.tests, file), 'utf8');
    try {
      await client.query('BEGIN');
      await client.query(sql);
      console.log(`✔ ${file}`);
    } catch (err) {
      failed++;
      console.error(`✖ ${file}: ${err.message}${err.where ? `\n  ${err.where}` : ''}`);
    } finally {
      await client.query('ROLLBACK');
    }
  }
  if (failed > 0) fail(`${failed} archivo(s) de test SQL fallaron.`);
  console.log('✔ Todos los tests SQL pasaron (cambios revertidos).');
}

async function reset(client, url, flags) {
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    fail(`reset solo se permite contra una base local (host actual: ${host}).`);
  }
  if (!flags.includes('--yes')) {
    fail('reset borra TODO el esquema public. Repetí el comando agregando --yes para confirmar.');
  }
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
  console.log('✔ Esquema public recreado. Aplicando migraciones y seeds...');
  await applyDir(client, DIRS.migrations, 'schema_migrations');
  await applyDir(client, DIRS.seeds, 'schema_seeds');
}

async function main() {
  const [command, ...flags] = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (!url) fail('DATABASE_URL no está definida (copiá .env.example a .env).');

  const client = new pg.Client({ connectionString: url, application_name: 'lacosta-db-cli' });
  client.on('notice', (notice) => console.log(`   ↳ ${notice.message}`));
  await client.connect();
  try {
    switch (command) {
      case 'migrate':
        await applyDir(client, DIRS.migrations, 'schema_migrations');
        break;
      case 'seed':
        await applyDir(client, DIRS.seeds, 'schema_seeds');
        break;
      case 'test':
        await runTests(client);
        break;
      case 'reset':
        await reset(client, url, flags);
        break;
      default:
        fail(`Comando desconocido "${command ?? ''}". Usar: migrate | seed | test | reset --yes`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => fail(err.stack ?? String(err)));
