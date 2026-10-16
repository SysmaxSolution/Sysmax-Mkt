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
//   MAIL_REPLY_TO        inbox(es) real(is) que recebem as respostas; aceita
//                        vários endereços separados por vírgula
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

// Reply-To aceita lista separada por vírgula: o time comercial acompanha as
// respostas na própria caixa sem precisar de mailbox no subdomínio de envio.
function replyToList(): string[] | undefined {
  const raw = cleanEnv(process.env.MAIL_REPLY_TO);
  if (!raw) return undefined;
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : undefined;
}

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

// APP_BASE_URL nunca foi configurada na Vercel, o que gerava link de opt-out
// sem domínio (e-mail frio sem opt-out válido = exposição de LGPD). As vars da
// Vercel vêm sem esquema, por isso o https:// na frente.
function publicBase(): string {
  const explicit = cleanEnv(process.env.APP_BASE_URL);
  if (explicit) return explicit.replace(/\/$/, "");
  const host = cleanEnv(process.env.VERCEL_PROJECT_PRODUCTION_URL) ?? cleanEnv(process.env.VERCEL_URL);
  if (host) return `https://${host.replace(/\/$/, "")}`;
  throw new Error("Sem base pública para o link de opt-out: configure APP_BASE_URL.");
}

export function buildUnsubscribeUrl(leadId: string, email: string): string {
  const base = publicBase();
  const token = sign(leadId, email);
  const qs = new URLSearchParams({ lead: leadId, email, t: token });
  return `${base}/api/unsubscribe?${qs.toString()}`;
}

export type SendEmailResult = { skipped: true; reason: string } | { skipped: false; id: string };

// A captacao viu o e-mail como a clinica recebe (16/10) e apontou: chega sem
// nenhuma imagem, nem a marca. Para quem abre, parece mensagem de alguem sem
// empresa por tras. A marca entra na ASSINATURA, nao como banner no topo:
// banner no alto e o formato de newsletter promocional, e a gente ja sabe que
// o Gmail carimba esse envio como Promocoes. Assinatura e formato de e-mail
// de pessoa -- o mesmo conteudo, sem reforcar o carimbo.
//
// O texto puro continua sendo enviado junto (multipart/alternative): cliente
// que nao mostra imagem, ou leitor de tela, recebe a mensagem inteira. A
// imagem tem alt com o nome da empresa pelo mesmo motivo.
const ESCAPES: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};
const escapeHtml = (t: string) => t.replace(/[&<>"']/g, (c) => ESCAPES[c]);

function logoUrl(): string | null {
  try {
    return `${publicBase()}/marca/sysmax.png`;
  } catch {
    return null; // sem base publica a marca simplesmente nao entra
  }
}

// A marca vai ANEXADA e embutida (cid:), nao como link para imagem na web.
// Imagem remota em e-mail de remetente desconhecido e o caso classico de
// "nao aparece nada": o cliente bloqueia, ou o proxy falha, e a assinatura
// vira um quadrado vazio. Anexo embutido viaja dentro da mensagem e aparece
// sem depender de o leitor liberar imagem externa.
// Busca uma vez por processo e guarda; se falhar, cai para a imagem remota,
// que e melhor do que nenhuma.
const LOGO_CID = "marca-sysmax";
let logoBase64: string | null | undefined;

async function carregarLogo(): Promise<string | null> {
  if (logoBase64 !== undefined) return logoBase64;
  logoBase64 = null;
  const url = logoUrl();
  if (url) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 0 && buf.length < 200_000) logoBase64 = buf.toString("base64");
      }
    } catch {
      /* sem marca e melhor do que sem e-mail */
    }
  }
  return logoBase64;
}

function montarHtml(texto: string, aviso: string, unsubUrl: string, embutida: boolean): string {
  const corpo = escapeHtml(texto.trim()).replace(/\r?\n/g, "<br>");
  const src = embutida ? `cid:${LOGO_CID}` : logoUrl();
  const marca = src
    ? `<img src="${src}" alt="Sysmax Software" width="200" height="40" style="display:block;border:0;outline:none;text-decoration:none">`
    : `<span style="font:600 15px/1.4 Arial,Helvetica,sans-serif;color:#0f172a">Sysmax Software</span>`;
  return [
    '<div style="font:15px/1.6 Arial,Helvetica,sans-serif;color:#0f172a;max-width:560px">',
    `<div>${corpo}</div>`,
    '<div style="margin:26px 0 0;padding:18px 0 0;border-top:1px solid #e2e8f0">',
    marca,
    `<p style="margin:12px 0 0;font:12px/1.5 Arial,Helvetica,sans-serif;color:#64748b">${escapeHtml(aviso)}<br>`,
    `<a href="${unsubUrl}" style="color:#64748b">Se nao quiser mais receber, cancele aqui.</a></p>`,
    "</div></div>",
  ].join("");
}

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
  const logo = await carregarLogo();
  const aviso = `Você recebeu este e-mail porque a ${process.env.MAIL_FROM_NAME ?? "Sysmax Software"} identificou sua clínica como possível interessada no SYSVETMAX (contato profissional B2B).`;
  const body = `${text.trim()}

—
${aviso}
Se não quiser mais receber, cancele aqui: ${unsubUrl}`;

  const payload: Record<string, unknown> = {
    from,
    to: [to],
    subject,
    text: body,
    html: montarHtml(text, aviso, unsubUrl, !!logo),
    headers: {
      "List-Unsubscribe": `<${unsubUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
  if (logo) {
    payload.attachments = [{
      filename: "sysmax.png",
      content: logo,
      content_type: "image/png",
      content_id: LOGO_CID,
    }];
  }
  const replyTo = replyToList();
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
  const replyTo = replyToList();
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
