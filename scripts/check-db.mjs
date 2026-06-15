// Verificacao rapida do schema do CRM Sysmax: lista as tabelas publicas e
// confirma o estado das migrations aplicadas.
//   node scripts/check-db.mjs
import postgres from "postgres";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadEnv() {
  try {
    const env = await readFile(join(__dirname, "..", ".env"), "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  } catch {}
}

await loadEnv();
const sql = postgres(process.env.SALES_DATABASE_URL, { ssl: "require", max: 1 });
try {
  const tables = await sql`
    select table_name from information_schema.tables
    where table_schema = 'public' order by table_name`;
  console.log("Tabelas em public:");
  for (const t of tables) console.log("  -", t.table_name);

  const migs = await sql`select version, applied_at from schema_migrations order by version`;
  console.log("\nMigrations aplicadas:");
  for (const m of migs) console.log("  -", m.version, "@", m.applied_at.toISOString());
} finally {
  await sql.end();
}
