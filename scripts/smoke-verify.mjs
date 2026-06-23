// Verifica (e opcionalmente limpa) o lead de teste do smoke.
//   node scripts/smoke-verify.mjs [phone] [--cleanup]
import postgres from "postgres";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of (await readFile(join(__dirname, "..", ".env"), "utf8")).split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const phone = process.argv.find((a) => /^\d+$/.test(a)) ?? "5599999000001";
const cleanup = process.argv.includes("--cleanup");

const sql = postgres(env.SALES_DATABASE_URL, { ssl: "require", max: 1 });
try {
  const [lead] = await sql`
    select id, name, company_name, clinic_size, employees, current_software, pains, stage, consent_optin
    from leads where phone = ${phone}`;
  if (!lead) {
    console.log("Lead de teste não encontrado.");
  } else {
    console.log("LEAD:");
    console.log(JSON.stringify(lead, null, 2));
    const [msgs] = await sql`
      select count(*)::int n from messages m
      join conversations c on c.id = m.conversation_id where c.lead_id = ${lead.id}`;
    console.log("Mensagens trocadas:", msgs.n);
    const demos = await sql`select scheduled_at, status, notes from demos where lead_id = ${lead.id}`;
    console.log("Demos agendadas:", JSON.stringify(demos, null, 2));
    if (cleanup) {
      await sql`delete from leads where id = ${lead.id}`;
      console.log("\nCLEANUP: lead de teste removido (cascade em conversas/mensagens/demos).");
    }
  }
} finally {
  await sql.end();
}
