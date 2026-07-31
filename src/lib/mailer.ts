import { createHmac, timingSafeEqual } from "node:crypto";
import { isSuppressed } from "@/lib/suppression";

// ===========================================================================
// Mailer do outbound frio. Envia via Resend HTTP API (sem SDK) a partir de um
// SUBDOMÍNIO DEDICADO (MAIL_FROM), para proteger a reputação do domínio
// corporativo — guardrail do llm-council.
//
// Env:
//   RESEND_API_KEY       chave do Resend (subdomínio verificado c/ SPF/DKIM/DMARC)
//   MAIL_FROM            ex: "Sysmax Software <contato@mkt.sysmaxsolutions.com>"
//   MAIL_REPLY_TO        inbox real do fundador (respostas caem no Gmail)
//   APP_BASE_URL         base pública p/ o link de unsubscribe
//   UNSUBSCRIBE_SECRET   segredo p/ assinar o link (fallback: ADMIN_TOKEN)
//
// Todo e-mail carrega link de opt-out + header List-Unsubscribe (one-click),
// exigência de LGPD e de deliverability.
// ===========================================================================

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// BOM (U+FEFF) colado em env var derruba o fetch ("ByteString... index 7" =
// Authorization: Bearer <BOM>key — incidente 31/07, 45 e-mails falharam).
// Mesma blindagem já aplicada ao cliente Evolution. Sanitizar SEMPRE.
const cleanEnv = (v: string | undefined) => v?.replace(/^﻿/, "").trim() || undefined;
const resendKey = () => cleanEnv(process.env.RESEND_API_KEY);
const mailFrom = () => cleanEnv(process.env.MAIL_FROM);

function unsubSecret(): string {
  const s = process.env.UNSUBSCRIBE_SECRET ?? process.env.ADMIN_TOKEN;
  if (!s) throw new Error("UNSUBSCRIBE_SECRET (ou ADMIN_TOKEN) ausente — necessário p/ assinar o opt-out.");
  return s;
}

function sign(leadId: string, email: string): string {
  return createHmac("sha256", unsubSecret())
    .update(`${leadId}:${email.toLowerCase()}`)
    .digest("hex");
}

export function verifyUnsub(leadId: string, email: string, token: string): boolean {
  const expected = sign(leadId, email);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function buildUnsubscribeUrl(leadId: string, email: string): string {
  const base = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
  const token = sign(leadId, email);
  const qs = new URLSearchParams({ lead: leadId, email, t: token });
  return `${base}/api/unsubscribe?${qs.toString()}`;
}

export type SendEmailResult = { skipped: true; reason: string } | { skipped: false; id: string };

export async function sendEmail(args: {
  to: string;
  subject: string;
  text: string;
  leadId: string;
}): Promise<SendEmailResult> {
  const { to, subject, text, leadId } = args;

  // Guardrail LGPD: nunca disparar p/ quem optou por sair.
  if (await isSuppressed("email", to)) {
    return { skipped: true, reason: "suppressed" };
  }

  const apiKey = resendKey();
  const from = mailFrom();
  if (!apiKey || !from) {
    throw new Error("RESEND_API_KEY e MAIL_FROM são obrigatórios para enviar e-mail.");
  }

  const unsubUrl = buildUnsubscribeUrl(leadId, to);
  const body = `${text.trim()}

—
Você recebeu este e-mail porque a ${process.env.MAIL_FROM_NAME ?? "Sysmax Software"} identificou sua clínica como possível interessada no SYSVETMAX (contato profissional B2B).
Se não quiser mais receber, cancele aqui: ${unsubUrl}`;

  const payload: Record<string, unknown> = {
    from,
    to: [to],
    subject,
    text: body,
    headers: {
      "List-Unsubscribe": `<${unsubUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
  const replyTo = process.env.MAIL_REPLY_TO;
  if (replyTo) payload.reply_to = replyTo;

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${t}`);
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return { skipped: false, id: data.id ?? "" };
}

// E-mail SOLICITADO pelo lead ("manda por e-mail"): não é cold outreach — o
// pedido explícito é o consentimento. Sem footer de unsubscribe, com anexos
// (one-pager). Reply-To aponta para a inbox real do fundador.
export async function sendSolicitedEmail(args: {
  to: string;
  subject: string;
  text: string;
  attachments?: Array<{ filename: string; content: string }>; // content = base64
}): Promise<string> {
  const apiKey = resendKey();
  const from = mailFrom();
  if (!apiKey || !from) throw new Error("RESEND_API_KEY e MAIL_FROM são obrigatórios.");
  const payload: Record<string, unknown> = {
    from,
    to: [args.to],
    subject: args.subject,
    text: args.text,
  };
  if (args.attachments?.length) payload.attachments = args.attachments;
  const replyTo = process.env.MAIL_REPLY_TO;
  if (replyTo) payload.reply_to = replyTo;
  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text().catch(() => "")}`);
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return data.id ?? "";
}

// E-mail INTERNO (digest ao fundador). Não é cold outreach: sem footer de
// unsubscribe, sem checagem de suppression. Usa o mesmo remetente (MAIL_FROM).
export async function sendInternalEmail(args: { to: string; subject: string; text: string }): Promise<string> {
  const apiKey = resendKey();
  const from = mailFrom();
  if (!apiKey || !from) throw new Error("RESEND_API_KEY e MAIL_FROM são obrigatórios.");
  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from, to: [args.to], subject: args.subject, text: args.text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text().catch(() => "")}`);
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return data.id ?? "";
}
