// Relatório de prospectos + fila de abordagem (outbox/worklist).
// Lê via REST (SALES_SUPABASE_URL + SERVICE_KEY). Só leitura.
//   node scripts/report-prospects.mjs
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
async function loadEnvFile(fp, ow) {
  try {
    const env = await readFile(fp, "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && (ow || !process.env[m[1]])) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  } catch {}
}
await loadEnvFile(join(__dirname, "..", ".env"), false);
await loadEnvFile(join(__dirname, "..", ".env.local"), true);

const db = createClient(process.env.SALES_SUPABASE_URL, process.env.SALES_SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const { data: leads } = await db.from("leads").select("id,name,company_name,city,uf,phone,email,instagram_handle,website,source,enrichment_status,stage,opted_out,discovered_at").order("discovered_at", { ascending: false });
const places = (leads ?? []).filter((l) => l.source === "places");

console.log("=== LEADS (total):", (leads ?? []).length, "| via Places:", places.length, "===");
const byStatus = {};
for (const l of places) byStatus[l.enrichment_status] = (byStatus[l.enrichment_status] ?? 0) + 1;
console.log("enrichment_status:", JSON.stringify(byStatus));
const byCity = {};
for (const l of places) { const k = `${l.city}/${l.uf}`; byCity[k] = (byCity[k] ?? 0) + 1; }
console.log("por cidade:", JSON.stringify(byCity));

const { data: outbox } = await db.from("outbox").select("id,lead_id,channel,subject,body,status,created_at").order("created_at", { ascending: false });
console.log("\n=== OUTBOX (total):", (outbox ?? []).length, "===");
const obByCh = {}, obBySt = {};
for (const o of outbox ?? []) { obByCh[o.channel] = (obByCh[o.channel] ?? 0) + 1; obBySt[o.status] = (obBySt[o.status] ?? 0) + 1; }
console.log("por canal:", JSON.stringify(obByCh), "| por status:", JSON.stringify(obBySt));

// junta lead + itens de fila
const leadById = Object.fromEntries((leads ?? []).map((l) => [l.id, l]));
console.log("\n=== ITENS DE FILA PRONTOS (draft/approved) ===");
for (const o of (outbox ?? []).filter((o) => ["draft", "approved"].includes(o.status))) {
  const l = leadById[o.lead_id] ?? {};
  console.log(`\n--- [${o.channel}] ${l.company_name ?? l.name ?? "?"} (${l.city}/${l.uf}) — status ${o.status}`);
  console.log(`    tel:${l.phone ?? "-"} email:${l.email ?? "-"} ig:${l.instagram_handle ? "@" + l.instagram_handle : "-"}`);
  if (o.subject) console.log(`    assunto: ${o.subject}`);
  console.log(`    ${(o.body ?? "").replace(/\n/g, "\n    ")}`);
}
