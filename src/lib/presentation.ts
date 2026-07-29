import { BRAND } from "@/lib/brand";
import { sendSolicitedEmail } from "@/lib/mailer";
import { sendText, sendDocument } from "@/lib/evolution";
import { insertMessage, moveStage, type Lead } from "@/crm/leads";
import { salesDb } from "@/lib/supabase";

// ===========================================================================
// Fluxo "mande por e-mail" (ordem do Diretor 29/07): quando o lead pede a
// proposta por e-mail, enviamos TUDO na hora — e-mail com o one-pager anexo,
// confirmação gentil no WhatsApp e o mesmo PDF no chat. O texto do WhatsApp é
// FIXO (palavras do Diretor); o agente fica em silêncio depois do pacote.
// ===========================================================================

const PDF_NAME = "SYSVETMAX_Apresentacao.pdf";

export const WHATSAPP_CONFIRMATION =
  "Maravilha! Estarei enviando o material e a proposta por e-mail agora mesmo — e deixo a apresentação aqui abaixo também. Só me confirma se receberam por gentileza? 😊";

function pdfUrl(): string {
  const base = (process.env.APP_BASE_URL ?? "https://dev.mkt.sysmaxsolutions.com").replace(/\/$/, "");
  return `${base}/${PDF_NAME}`;
}

function proposalBody(companyName: string | null): string {
  const empresa = companyName?.trim() || "equipe";
  return `Olá, ${empresa}! Tudo bem?

Me chamo Rafael, sou da ${BRAND.company}, de ${BRAND.city}. Conforme combinamos pelo WhatsApp, segue nossa apresentação e a proposta de conversa.

Quem somos: desenvolvemos o ${BRAND.product}, um sistema de gestão 100% em nuvem para clínicas e hospitais veterinários. Nosso diferencial não é só o produto — é o método: antes de qualquer proposta, ouvimos como funciona a rotina de cada setor e desenhamos a solução para o fluxo de vocês, não o contrário.

Alguns destaques do que o ${BRAND.product} entrega:

- Prontuário por voz com IA — o Médico Veterinário fala a consulta e o sistema escreve a evolução, com revisão e assinatura do MV (conformidade CFMV);
- Internação e Centro Cirúrgico — kanban em tempo real, prescrições com aprazamento e checklist cirúrgico;
- Recepção, agenda e triagem integradas, do check-in à alta;
- Financeiro completo — caixa central, PDV, NFS-e no checkout e conciliação de cartões;
- WhatsApp integrado — carteira de vacinação digital (modelo CFMV), lembretes e documentos entregues ao tutor;
- Estoque e compras com entrada por XML de NF-e.

E o mais importante para quem já usa outro sistema: a migração completa de dados está inclusa — pets, tutores, históricos, vacinas e anexos vêm junto. Migramos recentemente uma clínica inteira do SimplesVet sem perder um único registro.

Investimento: planos a partir de R$ 149,90/mês, com teste de 30 dias sem cartão e sem fidelidade.

Nossa proposta (sem compromisso): uma reunião remota de 10 a 15 minutos para nos conhecermos, ouvirmos a rotina de vocês e fazermos o levantamento do que faz sentido para a operação. Basta responder este e-mail com o melhor dia e horário, e enviamos o link.

Obrigado pela atenção!

Abraço,

Rafael · ${BRAND.company}
${BRAND.city} · (16) 99725-3250
sysvetmax.sysmaxsolutions.com`;
}

export type PresentationResult = { ok: true } | { ok: false; error: string };

export async function sendPresentationPackage(params: {
  lead: Lead;
  email: string;
  conversationId: string;
}): Promise<PresentationResult> {
  const { lead, email, conversationId } = params;
  const to = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { ok: false, error: `e-mail inválido: ${email}` };

  // 1) baixa o one-pager do próprio deploy (public/)
  const pdfRes = await fetch(pdfUrl());
  if (!pdfRes.ok) return { ok: false, error: `one-pager indisponível (${pdfRes.status})` };
  const pdfBase64 = Buffer.from(await pdfRes.arrayBuffer()).toString("base64");

  // 2) e-mail solicitado pelo lead (não é cold — sem footer de unsubscribe)
  const subject = `SYSVETMAX — apresentação e proposta de reunião${lead.company_name ? ` | ${lead.company_name}` : ""}`;
  const body = proposalBody(lead.company_name);
  let providerId: string;
  try {
    providerId = await sendSolicitedEmail({
      to,
      subject,
      text: body,
      attachments: [{ filename: PDF_NAME, content: pdfBase64 }],
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // 3) confirmação no WhatsApp (texto fixo do Diretor) + o PDF no chat
  if (lead.phone) {
    try {
      await sendText(lead.phone, WHATSAPP_CONFIRMATION);
      await insertMessage({ conversationId, direction: "outbound", content: WHATSAPP_CONFIRMATION, sentBy: "bot" });
      await sendDocument(lead.phone, pdfBase64, PDF_NAME);
      await insertMessage({ conversationId, direction: "outbound", content: `[documento: ${PDF_NAME}]`, sentBy: "bot" });
    } catch (e) {
      // e-mail já foi — não falha o pacote por causa do anexo no chat
      console.error("[presentation] falha no envio WhatsApp:", e);
    }
  }

  // 4) rastro: outbox (auditoria/dedup) + lead atualizado
  await salesDb.from("outbox").insert({
    lead_id: lead.id,
    channel: "email",
    subject,
    body,
    status: "sent",
    sent_at: new Date().toISOString(),
    provider_msg_id: providerId,
    approved_by: "fluxo mande-por-email (Diretor 29/07)",
    approved_at: new Date().toISOString(),
  });
  await salesDb
    .from("leads")
    .update({ email: to, last_contact_at: new Date().toISOString() })
    .eq("id", lead.id);
  if (lead.stage === "new") await moveStage(lead.id, "engaged");

  return { ok: true };
}
