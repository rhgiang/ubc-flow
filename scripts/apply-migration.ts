// scripts/apply-migration.ts
//
// Applies one migration the way `prisma migrate deploy` would, for a machine
// where Prisma's schema engine cannot run (Windows Smart App Control blocks
// schema-engine-windows.exe, and it cannot be allowed per-file). Runs the SQL
// and records it in _prisma_migrations with the same sha256 checksum Prisma
// uses, in one transaction, so Prisma later sees it as applied.
//
// Usage: npx tsx scripts/apply-migration.ts prisma/migrations/<name>
// Targets DATABASE_URL, so point it at Neon's direct URL for production.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Client } from 'pg';

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error('Usage: npx tsx scripts/apply-migration.ts prisma/migrations/<name>');
  const name = basename(dir);
  const sql = readFileSync(join(dir, 'migration.sql'), 'utf8');
  // Hashed as LF: Git on Windows checks this out as CRLF, and the checksums
  // Prisma recorded for earlier migrations are of the LF text.
  const checksum = createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const seen = await client.query('SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1', [name]);
    if (seen.rowCount) return console.log(`already applied: ${name}`);
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
       VALUES ($1, $2, now(), $3, now(), 1)`,
      [randomUUID(), checksum, name],
    );
    await client.query('COMMIT');
    console.log(`applied ${name} to ${new URL(process.env.DATABASE_URL!).host}`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
