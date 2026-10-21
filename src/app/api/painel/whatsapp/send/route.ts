import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedViewer } from "@/lib/viewer-auth";
import { sendText } from "@/lib/evolution";
import {
  getOrCreateWaConversation,
  getWaAccountById,
  getWaConversationById,
  insertWaMessage,
  setConversationReview,
} from "@/lib/wa-accounts";
import { findOrCreateLeadByPhone } from "@/crm/leads";
import { cleanText } from "@/crm/lead-intake";

export const runtime = "nodejs";

// ===========================================================================
// POST /api/painel/whatsapp/send — envia pelo painel E registra.
// O registro é o próprio efeito do envio: não existe caminho de enviar sem
// gravar em wa_messages (diferente do fluxo antigo de copiar/colar).
//
// Aceita conversationId (conversa já existente) OU
// { waAccountId, contactPhone, contactName } para abrir uma conversa nova.
// ===========================================================================

export async function POST(req: NextRequest) {
  if (!isAuthorizedViewer(req)) return new NextResponse("unauthorized", { status: 401 });

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const body = typeof b?.body === "string" ? b.body.trim() : "";
  if (!body) return NextResponse.json({ ok: false, error: "Mensagem vazia." }, { status: 400 });
  if (body.length > 10_000) return NextResponse.json({ ok: false, error: "Mensagem grande demais." }, { status: 413 });

  let conversationId = cleanText(b?.conversationId, 60);
  let waAccountId = cleanText(b?.waAccountId, 60);

  if (!conversationId) {
    const contactPhone = cleanText(b?.contactPhone, 30);
    if (!waAccountId || !contactPhone) {
      return NextResponse.json({ ok: false, error: "Informe conversationId ou (waAccountId + contactPhone)." }, { status: 400 });
    }
    const contactName = cleanText(b?.contactName, 120) ?? null;
    const lead = await findOrCreateLeadByPhone(contactPhone, contactName);
    const conversation = await getOrCreateWaConversation(waAccountId, contactPhone, contactName, lead?.id ?? null);
    conversationId = conversation.id;
  }

  const conversation = await getWaConversationById(conversationId);
  if (!conversation) return NextResponse.json({ ok: false, error: "Conversa não encontrada." }, { status: 404 });
  waAccountId = conversation.wa_account_id;

  const account = await getWaAccountById(waAccountId);
  if (!account) return NextResponse.json({ ok: false, error: "Conta WhatsApp não encontrada." }, { status: 404 });

  try {
    await sendText(conversation.contact_phone, body, account.evolution_instance_id);
  } catch (e) {
    return NextResponse.json({ ok: false, error: `Falha ao enviar: ${(e as Error).message}` }, { status: 502 });
  }
  await insertWaMessage({ conversationId, direction: "out", body });
  // Analista agiu: a pendência de revisão referente a essa conversa foi tratada.
  await setConversationReview(conversationId, false);

  return NextResponse.json({ ok: true, conversationId });
}
