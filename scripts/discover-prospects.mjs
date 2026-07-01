// ===========================================================================
// discover-prospects.mjs — descoberta de clínicas veterinárias (topo de funil)
// ---------------------------------------------------------------------------
// Usa a Google Places API (New) Text Search para achar clínicas veterinárias
// por cidade/UF, deduplica por place_id e grava em `leads` (source='places',
// consent_optin=false, base legal = legítimo interesse B2B). Em seguida faz um
// enriquecimento leve: visita o site da clínica e tenta extrair e-mail de
// contato + handle de Instagram. Clínicas sem e-mail ficam enrichment_status
// 'no_email' (vão p/ WhatsApp warm/manual, NÃO entram no e-mail frio).
//
// Uso:
//   node scripts/discover-prospects.mjs "Ribeirão Preto" SP            (piloto)
//   node scripts/discover-prospects.mjs "Ribeirão Preto" SP --limit=40
//   node scripts/discover-prospects.mjs --no-enrich "Campinas" SP
//
// Requer no .env / .env.local:
//   GOOGLE_PLACES_API_KEY, SALES_SUPABASE_URL, SALES_SUPABASE_SERVICE_KEY
// ===========================================================================
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadEnvFile(filePath, overwrite = false) {
  try {
    const env = await readFile(filePath, "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && (overwrite || !process.env[m[1]])) {
        process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
      }
    }
  } catch {
    /* opcional */
  }
}
async function loadEnv() {
  const root = join(__dirname, "..");
  await loadEnvFile(join(root, ".env"), false);
  await loadEnvFile(join(root, ".env.local"), true);
}

const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "nextPageToken",
].join(",");

function toE164BR(raw) {
  if (!raw) return null;
  const d = String(raw).replace(/\D/g, "");
  if (!d) return null;
  return d.startsWith("55") ? d : "55" + d;
}

async function searchPlaces(apiKey, query, limit) {
  const out = [];
  let pageToken = undefined;
  while (out.length < limit) {
    const body = { textQuery: query, includedType: "veterinary_care", languageCode: "pt-BR", regionCode: "BR" };
    if (pageToken) body.pageToken = pageToken;
    const res = await fetch(PLACES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Places ${res.status}: ${t}`);
    }
    const data = await res.json();
    for (const p of data.places ?? []) out.push(p);
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out.slice(0, limit);
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const IG_RE = /instagram\.com\/([a-z0-9._]{2,30})/i;
const BAD_EMAIL = /(sentry|wixpress|example\.com|\.png|\.jpg|\.gif|@sentry|godaddy|domain)/i;

async function enrichFromWebsite(website) {
  const result = { email: null, instagram: null };
  if (!website) return result;
  const urls = [website];
  try {
    const u = new URL(website);
    urls.push(`${u.origin}/contato`, `${u.origin}/contato.html`);
  } catch {
    /* url inválida */
  }
  for (const url of urls) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
      clearTimeout(timer);
      if (!res.ok) continue;
      const html = await res.text();
      if (!result.instagram) {
        const ig = html.match(IG_RE);
        if (ig && !/\/(p|reel|explore|accounts)\b/i.test(ig[1])) result.instagram = ig[1];
      }
      if (!result.email) {
        const emails = (html.match(EMAIL_RE) ?? []).filter((e) => !BAD_EMAIL.test(e));
        if (emails.length) {
          // preferir e-mail do mesmo domínio do site
          let host = "";
          try { host = new URL(website).hostname.replace(/^www\./, ""); } catch { /* */ }
          result.email = emails.find((e) => host && e.toLowerCase().endsWith(host.toLowerCase())) ?? emails[0];
        }
      }
      if (result.email) break;
    } catch {
      /* segue p/ próxima url */
    }
  }
  return result;
}

async function main() {
  await loadEnv();
  const args = process.argv.slice(2);
  const noEnrich = args.includes("--no-enrich");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 60;
  const positional = args.filter((a) => !a.startsWith("--"));
  const city = positional[0];
  const uf = (positional[1] ?? "").toUpperCase();

  if (!city || !uf) {
    console.error('Uso: node scripts/discover-prospects.mjs "Cidade" UF [--limit=N] [--no-enrich]');
    process.exit(1);
  }
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const supaUrl = process.env.SALES_SUPABASE_URL;
  const supaKey = process.env.SALES_SUPABASE_SERVICE_KEY;
  if (!apiKey) { console.error("ERRO: GOOGLE_PLACES_API_KEY ausente no .env."); process.exit(1); }
  if (!supaUrl || !supaKey) { console.error("ERRO: SALES_SUPABASE_URL/SERVICE_KEY ausentes."); process.exit(1); }

  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  const query = `clínica veterinária em ${city}, ${uf}`;
  console.log(`> buscando: ${query} (limite ${limit})`);
  const places = await searchPlaces(apiKey, query, limit);
  console.log(`> ${places.length} estabelecimentos retornados`);

  let inserted = 0, updated = 0, withEmail = 0;
  for (const p of places) {
    const name = p.displayName?.text ?? null;
    const phone = toE164BR(p.nationalPhoneNumber);
    const website = p.websiteUri ?? null;

    let email = null, instagram = null, enrichment_status = "pending";
    if (!noEnrich) {
      const enr = await enrichFromWebsite(website);
      email = enr.email;
      instagram = enr.instagram;
      enrichment_status = email ? "enriched" : "no_email";
      if (email) withEmail++;
    }

    const row = {
      place_id: p.id,
      name,
      company_name: name,
      phone,
      email,
      instagram_handle: instagram,
      website,
      city,
      uf,
      source: "places",
      consent_optin: false,
      legal_basis: "legitimo_interesse_b2b",
      discovered_at: new Date().toISOString(),
      enrichment_status,
    };

    // upsert por place_id (dedup). Não sobrescreve leads que já viraram conversa
    // (não mexemos em stage/consent aqui — só campos de descoberta).
    const { data: existing } = await db.from("leads").select("id").eq("place_id", p.id).maybeSingle();
    if (existing) {
      await db.from("leads").update(row).eq("id", existing.id);
      updated++;
    } else {
      const { error } = await db.from("leads").insert(row);
      if (error) { console.warn(`  ! falha ao inserir ${name}: ${error.message}`); continue; }
      inserted++;
    }
  }

  console.log(`\nOK — ${inserted} novos, ${updated} atualizados, ${withEmail} com e-mail (${city}/${uf}).`);
  if (!noEnrich) console.log(`Clínicas sem e-mail ficam 'no_email' (WhatsApp warm/manual, fora do e-mail frio).`);
}

main().catch((err) => { console.error("Falha na descoberta:", err); process.exit(1); });
