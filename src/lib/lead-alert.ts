import { sendText } from "@/lib/evolution";

// ===========================================================================
// Alerta INTERNO de lead novo (site / cadastro Free) no WhatsApp da equipe
// comercial: Diretor + Jéssica. Vai pela instância comercial, só para esses
// números — nunca para o lead. Falha silenciosa: nunca derruba o fluxo.
// LEAD_ALERT_PHONES (CSV, só dígitos) sobrescreve; vazio = não envia nada.
// ===========================================================================

const DEFAULT_ALERT_PHONES = "5516996095475,5511939623300"; // Diretor, Jéssica

export function alertPhones(): string[] {
  const raw = process.env.LEAD_ALERT_PHONES ?? DEFAULT_ALERT_PHONES;
  return raw.split(",").map((s) => s.replace(/\D/g, "")).filter(Boolean);
}

export async function notifyLeadTeam(text: string): Promise<void> {
  for (const phone of alertPhones()) {
    try {
      await sendText(phone, text);
    } catch (e) {
      console.error("[lead-alert] falha ao avisar", phone.slice(-4), e instanceof Error ? e.message : e);
    }
  }
}

export function panelUrl(): string {
  const base = (process.env.APP_BASE_URL ?? "https://dev.mkt.sysmaxsolutions.com").replace(/\/$/, "");
  return `${base}/painel`;
}

function clip(text: string | null | undefined, max: number): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

export type LeadAlertInfo = {
  kind: "site_form" | "site_form_return" | "site_whatsapp" | "cadastro_free" | "cadastro_free_known";
  name?: string | null;
  clinic?: string | null;
  city?: string | null;
  phone?: string | null;
  email?: string | null;
  message?: string | null;
  ref?: string | null;
};

const HEAD: Record<LeadAlertInfo["kind"], string> = {
  site_form: "🆕 *Novo lead do site* (formulário)",
  site_form_return: "🔁 *Lead já conhecido voltou pelo formulário do site*",
  site_whatsapp: "🆕 *Novo lead do site* (chamou no WhatsApp)",
  cadastro_free: "🆕 *Nova conta Free no SYSVETMAX*",
  cadastro_free_known: "🔁 *Lead já conhecido criou conta Free no SYSVETMAX*",
};

export function buildLeadAlert(i: LeadAlertInfo): string {
  const who = [clip(i.name, 60), clip(i.clinic, 80)].filter(Boolean).join(" · ") || "Sem nome";
  const digits = (i.phone ?? "").replace(/\D/g, "");
  const lines = [HEAD[i.kind], `*${who}*`];
  if (i.city) lines.push(`📍 ${clip(i.city, 60)}`);
  if (digits) lines.push(`👉 https://wa.me/${digits}`);
  if (i.email) lines.push(`✉️ ${clip(i.email, 80)}`);
  if (i.message) lines.push(`💬 "${clip(i.message, 160)}"`);
  if (i.ref) lines.push(`Origem: ${clip(i.ref, 40)}`);
  lines.push(`Painel: ${panelUrl()}`);
  return lines.join("\n");
}
