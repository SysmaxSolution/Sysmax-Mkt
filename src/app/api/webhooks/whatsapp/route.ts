import { NextRequest, NextResponse } from "next/server";
import { sendText, fetchContactByLid } from "@/lib/evolution";
import { runSalesAgent } from "@/agents/sales-agent";
import {
  findOrCreateLeadByPhone,
  getOrCreateConversation,
  getActiveConversationByPhone,
  getConversationStatus,
  insertMessage,
  isRecentEcho,
  setConversationStatus,
  startHumanConversation,
} from "@/crm/leads";

export const runtime = "nodejs";

// ===========================================================================
// Webhook da instância COMERCIAL da Evolution (número Sysmax).
// Recebe eventos (MESSAGES_UPSERT) e roda o agente comercial B2B.
// ===========================================================================

function normalizeEvent(event: string | undefined): string {
  return (event ?? "").toUpperCase().replace(/\./g, "_");
}

// Padrões de resposta automática (URA/robô de clínica): o bot NÃO deve
// conversar com outro robô — registra a mensagem e fica em silêncio.
const AUTO_REPLY_PATTERNS: RegExp[] = [
  /mensagem\s+autom[aá]tica/i,
  /resposta\s+autom[aá]tica/i,
  /atendimento\s+(autom[aá]tico|virtual|eletr[oô]nico)/i,
  /fora\s+do\s+(nosso\s+)?hor[aá]rio/i,
  /hor[aá]rio\s+de\s+(atendimento|funcionamento)\s*[:\n]/i,
  /retornaremos\s+(o\s+contato|em\s+breve|assim\s+que)/i,
  /responderemos\s+(em\s+breve|assim\s+que|o\s+mais\s+breve)/i,
  /digite\s+(o\s+n[uú]mero|uma\s+op[cç][aã]o|a\s+op[cç][aã]o|\d)/i,
  /(escolha|selecione)\s+uma\s+(das\s+)?op[cç][aãoõ]/i,
  /aguarde\s+(um\s+momento|um\s+instante|que\s+em\s+breve)/i,
  /protocolo\s+(de\s+atendimento|n[uú]mero)/i,
  /este\s+(canal|n[uú]mero)\s+n[aã]o\s+[eé]\s+monitorado/i,
];

function looksLikeAutoReply(text: string): boolean {
  return AUTO_REPLY_PATTERNS.some((re) => re.test(text));
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
    if (!conv) {
      // Conversa NOVA iniciada pelo consultor pelo aparelho → nasce em modo
      // humano. Assim o bot não intervém quando a clínica responde (nem
      // quando chega a saudação automática dela).
      if (messageText?.trim()) {
        const started = await startHumanConversation(phone, null);
        if (started) {
          await insertMessage({ conversationId: started.id, direction: "outbound", content: messageText, sentBy: "human", externalId });
        }
      }
      return NextResponse.json({ received: true });
    }
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

  // Resposta automática de robô/URA da clínica: registra, mas não responde.
  if (looksLikeAutoReply(messageText)) {
    console.log("[sales-webhook] mensagem automática detectada — bot não responde:", messageText.slice(0, 80));
    return;
  }

  const result = await runSalesAgent({ lead, conversationId: conversation.id, userMessage: messageText });

  // Re-checa o status ANTES de registrar/enviar: o agente pode levar vários
  // segundos e, nesse intervalo, o consultor pode ter assumido a conversa
  // pelo celular (fromMe → status 'human'). Se assumiu, o bot se cala — não
  // registra nem envia, evitando atropelar o humano.
  const latest = await getConversationStatus(conversation.id);
  if (latest === "human") {
    console.log("[sales-webhook] humano assumiu durante o processamento — resposta do bot descartada");
    return;
  }

  await insertMessage({ conversationId: conversation.id, direction: "outbound", content: result.reply, sentBy: "bot" });

  // Erros transitórios da API (Claude sem crédito ou instabilidade) NÃO transferem
  // para humano — bot tenta novamente na próxima mensagem.
  const isTransientError =
    result.handoffReason === "anthropic_error" || result.handoffReason === "anthropic_no_credits";
  if (result.handoff && !isTransientError) {
    await setConversationStatus(conversation.id, "human");
  }

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
