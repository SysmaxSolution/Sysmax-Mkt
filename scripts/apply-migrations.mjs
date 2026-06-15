// ===========================================================================
// apply-migrations.mjs — aplicador de migrations do CRM Sysmax
// ---------------------------------------------------------------------------
// Roda os arquivos supabase/migrations/*.sql em ordem alfabetica contra o
// projeto Supabase da Sysmax (SALES_DATABASE_URL). Idempotente: registra cada
// arquivo aplicado em schema_migrations e pula os ja aplicados.
//
// Uso:  node scripts/apply-migrations.mjs
// Requer: SALES_DATABASE_URL no .env (Settings > Database > Connection string).
// ===========================================================================
import postgres from "postgres";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");

// Carrega .env manualmente (sem dependencia extra).
async function loadEnv() {
  try {
    const env = await readFile(join(__dirname, "..", ".env"), "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  } catch {
    /* .env opcional se variaveis ja estiverem no ambiente */
  }
}

async function main() {
  await loadEnv();
  const dbUrl = process.env.SALES_DATABASE_URL;
  if (!dbUrl) {
    console.error("ERRO: defina SALES_DATABASE_URL no .env (connection string do Supabase Sysmax).");
    process.exit(1);
  }

  const sql = postgres(dbUrl, { ssl: "require", max: 1 });
  try {
    await sql`create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )`;

    const applied = new Set(
      (await sql`select version from schema_migrations`).map((r) => r.version),
    );

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`= ja aplicada: ${file}`);
        continue;
      }
      const ddl = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      console.log(`+ aplicando:   ${file}`);
      await sql.begin(async (tx) => {
        await tx.unsafe(ddl);
        await tx`insert into schema_migrations (version) values (${file})`;
      });
      count++;
    }
    console.log(`\nOK — ${count} migration(s) nova(s) aplicada(s); ${files.length} no total.`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("Falha ao aplicar migrations:", err);
  process.exit(1);
});
