import { createHash, timingSafeEqual } from "node:crypto";
import { salesDb } from "@/lib/supabase";
import type { LeadAlertInfo } from "@/lib/lead-alert";

// ===========================================================================
// Entrada de leads INBOUND: formulário do site, cadastro Free no app e o
// "Vim pelo site" do WhatsApp. Aqui só se grava e classifica — o contato é
// sempre humano (estes leads nunca entram nos builders de outbound, que leem
// apenas source='places').
// ===========================================================================

// --- Telefone ---------------------------------------------------------------

// Normaliza para 55 + DDD + número. Retorna null se não parecer telefone BR.
export function normalizePhoneBR(raw: string): string | null {
  let d = (raw ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  if (!d.startsWith("55") || (d.length !== 12 && d.length !== 13)) return null;
  const ddd = parseInt(d.slice(2, 4), 10);
  if (ddd < 11 || ddd > 99) return null;
  // Celular antigo sem o 9 (12 dígitos e 1º dígito do assinante 6–9): acrescenta o 9.
  if (d.length === 12 && /^[6-9]/.test(d.slice(4))) d = d.slice(0, 4) + "9" + d.slice(4);
  return d;
}

// Variantes com/sem o 9 — a Evolution às vezes entrega o JID no formato antigo.
export function phoneVariants(p: string): string[] {
  const out = new Set([p]);
  if (p.length === 13 && p[4] === "9") out.add(p.slice(0, 4) + p.slice(5));
  if (p.length === 12 && /^[6-9]/.test(p.slice(4))) out.add(p.slice(0, 4) + "9" + p.slice(4));
  return [...out];
}

// --- Utilitários ------------------------------------------------------------

export function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  // remove caracteres de controle (mantém \n) e limita o tamanho
  return v.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim().slice(0, max);
}

export function cleanRef(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const r = v.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 40);
  return r || null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function cleanEmail(v: unknown): string | null {
  const e = cleanText(v, 160).toLowerCase();
  return e && EMAIL_RE.test(e) ? e : null;
}

export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function brDate(d = new Date()): string {
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function appendNote(prev: string | null, line: string): string {
  return [prev?.trim(), line].filter(Boolean).join("\n");
}

type LeadRow = {
  id: string; name: string | null; phone: string | null; email: string | null; company_name: string | null;
  city: string | null; source: string; source_ref: string | null; stage: string; notes: string | null;
  consent_at: string | null; signup_at: string | null; opted_out: boolean;
};
const ROW_FIELDS = "id,name,phone,email,company_name,city,source,source_ref,stage,notes,consent_at,signup_at,opted_out";

async function findByPhone(phone: string): Promise<LeadRow | null> {
  const { data } = await salesDb.from("leads").select(ROW_FIELDS).in("phone", phoneVariants(phone)).limit(1);
  return ((data ?? [])[0] as LeadRow | undefined) ?? null;
}

async function findByEmail(email: string): Promise<LeadRow | null> {
  const { data } = await salesDb.from("leads").select(ROW_FIELDS).eq("email", email).limit(1);
  return ((data ?? [])[0] as LeadRow | undefined) ?? null;
}

export type IntakeResult = { created: boolean; leadId: string; alert: LeadAlertInfo | null };

// --- Formulário do site -----------------------------------------------------

export type SiteFormInput = {
  name: string; clinic: string; phone: string; email: string | null;
  city: string | null; message: string | null; ref: string | null; page: string | null;
};

export async function intakeSiteForm(i: SiteFormInput): Promise<IntakeResult> {
  const nowIso = new Date().toISOString();
  const noteParts = [
    i.city ? `Cidade: ${i.city}` : null,
    i.message ? `Mensagem: ${i.message}` : null,
    i.page ? `Página: ${i.page}` : null,
  ].filter(Boolean);
  const alertBase = { name: i.name, clinic: i.clinic, city: i.city, phone: i.phone, email: i.email, message: i.message, ref: i.ref };

  const existing = await findByPhone(i.phone);
  if (existing) return onExistingFromForm(existing, i, noteParts as string[], nowIso, alertBase);

  const { data, error } = await salesDb
    .from("leads")
    .insert({
      name: i.name,
      phone: i.phone,
      email: i.email,
      company_name: i.clinic,
      city: i.city,
      source: "site",
      source_ref: i.ref,
      stage: "new",
      consent_optin: true,
      consent_at: nowIso,
      legal_basis: "consentimento (formulário do site)",
      notes: noteParts.join("\n") || null,
    })
    .select("id")
    .single();

  if (error) {
    // corrida: outro envio gravou o mesmo telefone entre o select e o insert
    if (error.code === "23505") {
      const again = await findByPhone(i.phone);
      if (again) return onExistingFromForm(again, i, noteParts as string[], nowIso, alertBase);
    }
    throw new Error(`falha ao gravar lead: ${error.message}`);
  }

  await salesDb.from("consent_log").insert({ lead_id: data.id, identifier: i.phone, channel: "whatsapp", optin_at: nowIso });
  return { created: true, leadId: data.id as string, alert: { kind: "site_form", ...alertBase } };
}

async function onExistingFromForm(
  lead: LeadRow, i: SiteFormInput, noteParts: string[], nowIso: string, alertBase: Omit<LeadAlertInfo, "kind">,
): Promise<IntakeResult> {
  const line = `[${brDate()}] voltou pelo formulário do site${noteParts.length ? " — " + noteParts.join(" | ") : ""}`;
  const patch: Record<string, unknown> = { notes: appendNote(lead.notes, line) };
  // preenche só o que estava em branco; nunca muda source nem rebaixa o estágio
  if (!lead.name) patch.name = i.name;
  if (!lead.company_name) patch.company_name = i.clinic;
  if (!lead.email && i.email) patch.email = i.email;
  if (!lead.city && i.city) patch.city = i.city;
  if (!lead.source_ref && i.ref && lead.source === "site") patch.source_ref = i.ref;
  if (!lead.opted_out) { patch.consent_optin = true; if (!lead.consent_at) patch.consent_at = nowIso; }
  await salesDb.from("leads").update(patch).eq("id", lead.id);
  return { created: false, leadId: lead.id, alert: { kind: "site_form_return", ...alertBase } };
}

// --- Cadastro Free (webhook do app) ------------------------------------------

export type SignupInput = {
  clinicName: string; adminName: string | null; email: string | null; phone: string | null;
  cnpj: string | null; createdAt: string | null;
};

export async function intakeFreeSignup(i: SignupInput): Promise<IntakeResult & { duplicate: boolean }> {
  const signupAt = i.createdAt && !Number.isNaN(Date.parse(i.createdAt)) ? new Date(i.createdAt).toISOString() : new Date().toISOString();
  const alertBase = { name: i.adminName, clinic: i.clinicName, phone: i.phone, email: i.email };

  const existing = (i.phone ? await findByPhone(i.phone) : null) ?? (i.email ? await findByEmail(i.email) : null);
  if (existing) {
    // idempotente: o mesmo cadastro reenviado não duplica nota nem alerta
    if (existing.signup_at) return { created: false, duplicate: true, leadId: existing.id, alert: null };
    const patch: Record<string, unknown> = {
      signup_at: signupAt,
      notes: appendNote(existing.notes, `[${brDate(new Date(signupAt))}] criou conta Free no SYSVETMAX (${i.clinicName}${i.cnpj ? `, CNPJ ${i.cnpj}` : ""})`),
    };
    if (!existing.company_name) patch.company_name = i.clinicName;
    if (!existing.name && i.adminName) patch.name = i.adminName;
    if (!existing.email && i.email) patch.email = i.email;
    if (!existing.phone && i.phone) patch.phone = i.phone;
    await salesDb.from("leads").update(patch).eq("id", existing.id);
    return { created: false, duplicate: false, leadId: existing.id, alert: { kind: "cadastro_free_known", ...alertBase } };
  }

  const { data, error } = await salesDb
    .from("leads")
    .insert({
      name: i.adminName,
      phone: i.phone,
      email: i.email,
      company_name: i.clinicName,
      source: "cadastro_free",
      stage: "new",
      consent_optin: false,
      signup_at: signupAt,
      legal_basis: "execução de contrato (conta Free)",
      notes: i.cnpj ? `CNPJ: ${i.cnpj}` : null,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { created: false, duplicate: true, leadId: "", alert: null };
    throw new Error(`falha ao gravar cadastro Free: ${error.message}`);
  }
  return { created: true, duplicate: false, leadId: data.id as string, alert: { kind: "cadastro_free", ...alertBase } };
}

// --- "Vim pelo site" no WhatsApp ---------------------------------------------

const FROM_SITE_RE = /vim\s+pelo\s+site/i;
const REF_RE = /\(\s*ref\s*:\s*([a-z0-9._-]{1,40})\s*\)|\[\s*ref\s*:\s*([a-z0-9._-]{1,40})\s*\]/i;

// Marca como 'site' o lead que chegou pelo botão de WhatsApp do site. Só mexe
// em leads de origem 'whatsapp'/'outro' — prospecção outbound (places etc.)
// nunca é reclassificada. Retorna info para o alerta quando houve marcação.
export async function tagSiteOriginFromWhatsApp(
  phone: string, messageText: string, pushName: string | null,
): Promise<LeadAlertInfo | null> {
  if (!FROM_SITE_RE.test(messageText)) return null;
  const lead = await findByPhone(phone);
  if (!lead) return null;
  const ref = cleanRef(messageText.match(REF_RE)?.slice(1).find(Boolean) ?? null);

  if (lead.source === "site") {
    if (ref && !lead.source_ref) await salesDb.from("leads").update({ source_ref: ref }).eq("id", lead.id);
    return null;
  }
  if (lead.source !== "whatsapp" && lead.source !== "outro") return null;

  const patch: Record<string, unknown> = { source: "site" };
  if (ref) patch.source_ref = ref;
  await salesDb.from("leads").update(patch).eq("id", lead.id);
  return { kind: "site_whatsapp", name: lead.name ?? pushName, clinic: lead.company_name, phone: lead.phone ?? phone, ref };
}

// --- Rate limit do formulário público ----------------------------------------

const RATE_MAX = 5;
const RATE_WINDOW_MS = 60 * 60_000;

export function hashIp(ip: string): string {
  const salt = process.env.CRON_SECRET ?? "sysmax";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

// true = pode seguir (e já registra o hit); false = estourou o limite.
export async function takeRateSlot(ipHash: string): Promise<boolean> {
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count } = await salesDb
    .from("lead_form_hits")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);
  if ((count ?? 0) >= RATE_MAX) return false;
  await salesDb.from("lead_form_hits").insert({ ip_hash: ipHash });
  if (Math.random() < 0.05) {
    await salesDb.from("lead_form_hits").delete().lt("created_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString());
  }
  return true;
}
