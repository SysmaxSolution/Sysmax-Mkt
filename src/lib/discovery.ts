import { salesDb } from "@/lib/supabase";

// ===========================================================================
// Descoberta de clínicas veterinárias (Google Places API New) — versão para
// rodar dentro de uma função serverless (limite ~60s). Portada de
// scripts/discover-prospects.mjs, com enriquecimento leve e limitado. Deduplica
// por place_id e grava em `leads` (source='places', base LGPD legítimo interesse
// B2B). Clínicas sem e-mail ficam enrichment_status='no_email'.
// ===========================================================================

const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = ["places.id", "places.displayName", "places.formattedAddress", "places.nationalPhoneNumber", "places.websiteUri", "nextPageToken"].join(",");

function toE164BR(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = String(raw).replace(/\D/g, "");
  if (!d) return null;
  return d.startsWith("55") ? d : "55" + d;
}

type Place = { id: string; displayName?: { text?: string }; nationalPhoneNumber?: string; websiteUri?: string };

async function searchPlaces(apiKey: string, query: string, limit: number): Promise<Place[]> {
  const out: Place[] = [];
  let pageToken: string | undefined;
  while (out.length < limit) {
    const body: Record<string, unknown> = { textQuery: query, includedType: "veterinary_care", languageCode: "pt-BR", regionCode: "BR" };
    if (pageToken) body.pageToken = pageToken;
    const res = await fetch(PLACES_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELD_MASK },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Places ${res.status}: ${await res.text().catch(() => "")}`);
    const data = (await res.json()) as { places?: Place[]; nextPageToken?: string };
    for (const p of data.places ?? []) out.push(p);
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out.slice(0, limit);
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const MAILTO_RE = /mailto:([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi;
const IG_RE = /instagram\.com\/([a-z0-9._]{2,30})/i;
const BAD_EMAIL = /(sentry|wixpress|example\.com|\.png|\.jpe?g|\.gif|\.webp|@sentry|godaddy|domain\.com|wix\.com|squarespace|cloudflare|sentry\.io|\.svg)/i;
const CONTACT_PATHS = ["", "/contato", "/fale-conosco", "/sobre"];

async function fetchText(url: string, ms = 6000): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    clearTimeout(t);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

function pickEmails(html: string, host: string): string | null {
  const mailtos = [...html.matchAll(MAILTO_RE)].map((m) => m[1]);
  const plain = html.match(EMAIL_RE) ?? [];
  const all = [...mailtos, ...plain].map((e) => e.toLowerCase()).filter((e) => !BAD_EMAIL.test(e));
  if (!all.length) return null;
  return all.find((e) => host && e.endsWith(host)) ?? all[0];
}

// Enriquecimento LEVE: home + no máximo 3 caminhos padrão de contato.
async function enrichFromWebsite(website: string | null): Promise<{ email: string | null; instagram: string | null }> {
  const result: { email: string | null; instagram: string | null } = { email: null, instagram: null };
  if (!website) return result;
  let origin = "", host = "";
  try { const u = new URL(website); origin = u.origin; host = u.hostname.replace(/^www\./, "").toLowerCase(); } catch { return result; }

  const home = await fetchText(website);
  if (home) {
    const ig = home.match(IG_RE);
    if (ig && !/^(p|reel|explore|accounts|stories)$/i.test(ig[1])) result.instagram = ig[1];
    const email = pickEmails(home, host);
    if (email) { result.email = email; return result; }
  }
  for (const p of CONTACT_PATHS.slice(1)) {
    const html = await fetchText(origin + p);
    if (!html) continue;
    if (!result.instagram) {
      const ig = html.match(IG_RE);
      if (ig && !/^(p|reel|explore|accounts|stories)$/i.test(ig[1])) result.instagram = ig[1];
    }
    const email = pickEmails(html, host);
    if (email) { result.email = email; break; }
  }
  return result;
}

export type DiscoverResult = { city: string; uf: string; found: number; inserted: number; updated: number; withEmail: number };

// Descobre clínicas de UMA cidade e grava/atualiza em `leads`. enrich=false
// pula a visita aos sites (mais rápido; clínicas ficam 'pending').
export async function discoverCity(city: string, uf: string, limit = 12, enrich = true): Promise<DiscoverResult> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_PLACES_API_KEY ausente");

  const places = await searchPlaces(apiKey, `clínica veterinária em ${city}, ${uf}`, limit);
  let inserted = 0, updated = 0, withEmail = 0;

  for (const p of places) {
    const name = p.displayName?.text ?? null;
    const phone = toE164BR(p.nationalPhoneNumber);
    const website = p.websiteUri ?? null;

    let email: string | null = null, instagram: string | null = null, enrichment_status = "pending";
    if (enrich) {
      const enr = await enrichFromWebsite(website);
      email = enr.email; instagram = enr.instagram;
      enrichment_status = email ? "enriched" : "no_email";
      if (email) withEmail++;
    }

    const row = {
      place_id: p.id, name, company_name: name, phone, email, instagram_handle: instagram, website,
      city, uf, source: "places", consent_optin: false, legal_basis: "legitimo_interesse_b2b",
      discovered_at: new Date().toISOString(), enrichment_status,
    };

    const { data: existing } = await salesDb.from("leads").select("id").eq("place_id", p.id).maybeSingle();
    if (existing) { await salesDb.from("leads").update(row).eq("id", existing.id); updated++; }
    else {
      const { error } = await salesDb.from("leads").insert(row);
      if (!error) inserted++;
    }
  }

  return { city, uf, found: places.length, inserted, updated, withEmail };
}
