// Exporta a fila de abordagem (outbox draft/approved) + dados do lead como JSON,
// com um canal RECOMENDADO por clínica (heurística de alcance B2B).
//   node scripts/export-worklist.mjs > out.json
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

const { data: leads } = await db.from("leads").select("id,name,company_name,city,uf,phone,email,instagram_handle,website,enrichment_status");
const leadById = Object.fromEntries((leads ?? []).map((l) => [l.id, l]));

const { data: outbox } = await db.from("outbox").select("id,lead_id,channel,subject,body,status,created_at").in("status", ["draft", "approved"]).order("created_at", { ascending: false });

// agrupa por clínica
const byLead = {};
for (const o of outbox ?? []) {
  (byLead[o.lead_id] ??= []).push(o);
}

const CH_LABEL = { email: "E-mail", whatsapp: "WhatsApp", call: "Ligação", ig_dm: "Instagram DM" };
// e-mail pessoal/inválido → não serve como canal frio corporativo
const badEmail = /(yahoo|gmail|hotmail|outlook|exemplo|example|seuemail|mysite|gserviceaccount|wixsite|godaddy|no-?reply)/i;
// handle de IG quebrado (recurso do Facebook, path de post, etc.)
const badIg = /\.php|^(p|reel|reels|explore|accounts|stories)$/i;

const rows = [];
for (const [leadId, items] of Object.entries(byLead)) {
  const l = leadById[leadId] ?? {};
  const chans = new Set(items.map((i) => i.channel));
  // heurística de canal recomendado (maior chance de alcance para clínica pequena BR)
  let rec, reason;
  const hasIg = !!l.instagram_handle && !badIg.test(l.instagram_handle);
  const goodEmail = l.email && !badEmail.test(l.email);
  if (chans.has("email") && goodEmail) {
    rec = "email"; reason = "E-mail corporativo válido — canal frio automatizável.";
  } else if (chans.has("email") && l.email) {
    rec = "whatsapp_manual"; reason = `E-mail é pessoal (${l.email}) — melhor abordar por WhatsApp/telefone.`;
  } else if (hasIg && chans.has("ig_dm")) {
    rec = "ig_dm"; reason = "Sem e-mail, mas ativa no Instagram — DM tem alta taxa de leitura.";
  } else if (chans.has("call")) {
    rec = "call"; reason = "Sem e-mail e sem Instagram — ligação/WhatsApp no telefone é o caminho.";
  } else if (chans.has("ig_dm")) {
    // tinha ig_dm mas handle quebrado → cai pro telefone
    rec = "call"; reason = "Handle do Instagram inválido — abordar por telefone/WhatsApp.";
  } else {
    rec = [...chans][0]; reason = "Único canal disponível.";
  }
  // recupera handle real do IG a partir do site quando o campo veio quebrado
  let ig = l.instagram_handle && !badIg.test(l.instagram_handle) ? l.instagram_handle : null;
  if (!ig && l.website) {
    const m = l.website.match(/instagram\.com\/([a-z0-9._]{2,30})/i);
    if (m && !badIg.test(m[1])) ig = m[1];
  }
  rows.push({
    clinic: l.company_name ?? l.name ?? "(sem nome)",
    city: l.city, uf: l.uf,
    phone: l.phone ?? null,
    email: goodEmail ? l.email : null,
    emailRaw: l.email ?? null,
    instagram: ig,
    website: l.website ?? null,
    enrichment: l.enrichment_status,
    recommended: rec,
    recommendedReason: reason,
    messages: items.map((i) => ({ channel: i.channel, channelLabel: CH_LABEL[i.channel] ?? i.channel, subject: i.subject ?? null, body: i.body, status: i.status })),
  });
}

// ordena: e-mail corporativo primeiro (mais fácil), depois ig_dm, depois call
const order = { email: 0, ig_dm: 1, whatsapp_manual: 2, call: 3 };
rows.sort((a, b) => (order[a.recommended] ?? 9) - (order[b.recommended] ?? 9) || a.city.localeCompare(b.city));

process.stdout.write(JSON.stringify({ generatedFor: "fundador", total: rows.length, rows }, null, 2));
