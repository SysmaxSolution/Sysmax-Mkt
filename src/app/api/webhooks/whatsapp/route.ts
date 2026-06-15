import { NextRequest, NextResponse } from "next/server";
import { sendText, fetchContactByLid } from "@/lib/evolution";
import { runSalesAgent } from "@/agents/sales-agent";
import {
  findOrCreateLeadByPhone,
  getOrCreateConversation,
  getActiveConversationByPhone,
  insertMessage,
  isRecentEcho,
  setConversationStatus,
} from "@/crm/leads";

export const runtime = "nodejs";

// ===========================================================================
// Webhook da instância COMERCIAL da Evolution (número Sysmax).
// Recebe eventos (MESSAGES_UPSERT) e roda o agente comercial B2B.
// ===========================================================================

function normalizeEvent(event: string | undefined): string {
  return (event ?? "").toUpperCase().replace(/\./g, "_");
}

function extractText(msgObj: Record<string, unknown> | undefined): string | null {
  if (!msgObj) return null;
  return (
    (msgObj.conversation as string | undefined) ??
    ((msgObj.extendedTextMessage as Record<string, unknown> | undefined)?.text as string | undefined) ??
    ((msgObj.imageMessage as Record<string, unknown> | undefined)?.caption as string | undefined) ??
    null
  );
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "payload inválido" }, { status: 400 });
  }

  const event = normalizeEvent(body?.event as string | undefined);
  if (event !== "MESSAGES_UPSERT") {
    // CONNECTION_UPDATE / QRCODE_UPDATED e afins: apenas ack.
    return NextResponse.json({ received: true });
  }

  const rawData = body?.data;
  const msgData: Record<string, unknown> | undefined = Array.isArray(rawData) ? rawData[0] : (rawData as Record<string, unknown>);
  if (!msgData) return NextResponse.json({ received: true });

  const key = msgData.key as Record<string, unknown> | undefined;
  const fromMe = key?.fromMe as boolean | undefined;
  const jid = key?.remoteJid as string | undefined;
  const externalId = (key?.id as string | undefined) ?? null;

  if (!jid || jid.endsWith("@g.us")) return NextResponse.json({ received: true });

  // Resolve telefone (trata @lid).
  let phone = jid.replace("@s.whatsapp.net", "");
  if (jid.includes("@lid")) {
    const resolved = await fetchContactByLid(jid);
    if (resolved) phone = resolved.replace("@s.whatsapp.net", "");
  }

  const pushName = (msgData.pushName as string | null) ?? null;
  const messageText = extractText(msgData.message as Record<string, unknown> | undefined);

  // ── fromMe: eco do bot OU resposta humana pelo aparelho (handoff) ─────────
  if (fromMe) {
    const conv = await getActiveConversationByPhone(phone);
    if (!conv) return NextResponse.json({ received: true });
    if (messageText?.trim() && (await isRecentEcho(conv.id, messageText))) {
      return NextResponse.json({ received: true }); // eco do que o bot enviou
    }
    // Consultor humano respondeu pelo celular → pausa o bot.
    if (conv.status !== "human") await setConversationStatus(conv.id, "human");
    if (messageText?.trim()) {
      await insertMessage({ conversationId: conv.id, direction: "outbound", content: messageText, sentBy: "human", externalId });
    }
    return NextResponse.json({ received: true });
  }

  if (!messageText?.trim()) return NextResponse.json({ received: true });

  try {
    await processInbound({ phone, pushName, messageText, externalId });
  } catch (err) {
    console.error("[sales-webhook] erro ao processar:", err);
  }
  return NextResponse.json({ received: true });
}

async function processInbound(params: {
  phone: string;
  pushName: string | null;
  messageText: string;
  externalId: string | null;
}) {
  const { phone, pushName, messageText, externalId } = params;

  const lead = await findOrCreateLeadByPhone(phone, pushName);
  if (!lead) return;

  const conversation = await getOrCreateConversation(lead.id);
  if (!conversation) return;

  // Registra a mensagem recebida.
  await insertMessage({ conversationId: conversation.id, direction: "inbound", content: messageText, sentBy: "client", externalId });

  // Conversa em atendimento humano: não aciona o bot.
  if (conversation.status === "human") return;

  const result = await runSalesAgent({ lead, conversationId: conversation.id, userMessage: messageText });

  await insertMessage({ conversationId: conversation.id, direction: "outbound", content: result.reply, sentBy: "bot" });

  if (result.handoff) await setConversationStatus(conversation.id, "human");

  const ok = await safeSend(phone, result.reply);
  if (!ok) await setConversationStatus(conversation.id, "human");
}

async function safeSend(phone: string, text: string): Promise<boolean> {
  try {
    await sendText(phone, text);
    return true;
  } catch (err) {
    console.error("[sales-webhook] falha ao enviar:", err);
    return false;
  }
}
