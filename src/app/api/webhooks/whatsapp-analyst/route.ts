import { NextRequest, NextResponse } from "next/server";
import { fetchContactByLid } from "@/lib/evolution";
import { findOrCreateLeadByPhone } from "@/crm/leads";
import {
  getOrCreateWaConversation,
  getWaAccountByInstance,
  insertWaMessage,
  setConversationReview,
  setWaAccountStatus,
} from "@/lib/wa-accounts";

export const runtime = "nodejs";

// ===========================================================================
// Webhook das instâncias de ANALISTA (WhatsApp multi-conta no painel).
//
// Diferente de /api/webhooks/whatsapp (instância COMERCIAL fixa, bot roda
// sozinho): aqui o analista é a própria pessoa conversando — o webhook só
// REGISTRA (entrada e saída, já que o painel grava as de saída direto no
// envio) e sinaliza quando a conversa precisa de revisão do Diretor
// (heurística simples por palavra-chave; o copiloto de IA completo é fase 2).
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

// Sinais de que a conversa saiu do script e precisa de uma decisão do
// Diretor (preço fora da tabela, cancelamento, funcionalidade que não existe).
const NEEDS_REVIEW_RE =
  /desconto|cancelar|cancelamento|pre[çc]o\s+especial|condi[çc][aã]o\s+especial|m[uú]lti(plo)?\s*cnpj|painel\s+de\s+chamada/i;

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "payload inválido" }, { status: 400 });
  }

  const instanceName = (body?.instance as string | undefined) ?? "";
  const account = instanceName ? await getWaAccountByInstance(instanceName) : null;
  if (!account) return NextResponse.json({ received: true }); // instancia desconhecida: ignora

  const event = normalizeEvent(body?.event as string | undefined);

  if (event === "CONNECTION_UPDATE") {
    const data = body?.data as Record<string, unknown> | undefined;
    const state = data?.state as string | undefined;
    if (state === "open") await setWaAccountStatus(instanceName, "connected");
    else if (state === "close") await setWaAccountStatus(instanceName, "disconnected");
    return NextResponse.json({ received: true });
  }

  if (event !== "MESSAGES_UPSERT") return NextResponse.json({ received: true });

  const rawData = body?.data;
  const msgData: Record<string, unknown> | undefined = Array.isArray(rawData) ? rawData[0] : (rawData as Record<string, unknown>);
  if (!msgData) return NextResponse.json({ received: true });

  const key = msgData.key as Record<string, unknown> | undefined;
  const fromMe = key?.fromMe as boolean | undefined;
  const jid = key?.remoteJid as string | undefined;
  if (!jid || jid.endsWith("@g.us")) return NextResponse.json({ received: true });

  let phone = jid.replace("@s.whatsapp.net", "");
  if (jid.includes("@lid")) {
    const resolved = await fetchContactByLid(jid);
    if (resolved) phone = resolved.replace("@s.whatsapp.net", "");
  }

  const msgObj = msgData.message as Record<string, unknown> | undefined;
  const text = extractText(msgObj);
  if (!text) return NextResponse.json({ received: true }); // mídia sem legenda: sem o que registrar como texto

  // fromMe=true chega aqui quando o analista manda PELO APP do celular (fora do
  // painel) — ainda registramos, porque é exatamente o caso que queremos
  // deixar de ser invisível.
  const direction: "in" | "out" = fromMe ? "out" : "in";
  const contactName = (msgData.pushName as string | undefined) ?? null;

  const lead = direction === "in" ? await findOrCreateLeadByPhone(phone, contactName) : null;
  const conversation = await getOrCreateWaConversation(account.id, phone, contactName, lead?.id ?? null);
  await insertWaMessage({ conversationId: conversation.id, direction, body: text, rawPayload: msgData });

  if (direction === "in" && NEEDS_REVIEW_RE.test(text)) {
    await setConversationReview(conversation.id, true, "Cliente tocou em assunto que depende do Diretor — confirmar antes de responder.");
  }

  return NextResponse.json({ received: true });
}
