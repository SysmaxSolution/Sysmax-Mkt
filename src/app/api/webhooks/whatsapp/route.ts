import { NextRequest, NextResponse } from "next/server";
import { sendText, fetchContactByLid } from "@/lib/evolution";
import { runSalesAgent } from "@/agents/sales-agent";
import { notifyOwner, reasonLabel } from "@/lib/owner-alert";
import {
  countRecentBotMessages,
  findOrCreateLeadByPhone,
  getOrCreateConversation,
  getActiveConversationByPhone,
  getConversationStatus,
  getLastOutboundAt,
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

// ── Modo proprietário ───────────────────────────────────────────────────────
// Números do DONO da empresa: o bot NUNCA trata como prospect. Atua como
// ponte: registra tudo que chegar (comentários e áudios encaminhados, ex.:
// respostas do Dr. Vinicius) para o Claude puxar depois, e confirma o
// encerramento quando o dono disser "isso é tudo".
const OWNER_PHONES = (process.env.OWNER_PHONES ?? "5516996095475")
  .split(",")
  .map((s) => s.replace(/\D/g, ""))
  .filter(Boolean);

function isOwnerPhone(phone: string): boolean {
  return OWNER_PHONES.includes(phone.replace(/\D/g, ""));
}

const OWNER_DONE_RE = /isso\s+[eé]\s+tudo/i;

// ── Lista de bloqueio TOTAL ─────────────────────────────────────────────────
// Números em que o bot JAMAIS abre a boca (ordem estrita do Diretor 27/07:
// conversas da Clínica Animais são conduzidas SÓ por humanos). O webhook
// ignora o evento por completo — não registra, não processa, não responde.
// Adicionar mais números via env BOT_BLOCKED_PHONES (CSV, só dígitos).
const BLOCKED_PHONES = new Set(
  [
    "5521979770080", // ASL Softhouse / Worklist (Flavio) — Clínica Animais
    "551141336300",  // MedMax (analisador MaxBio) — Clínica Animais
    "5511984822612", // Ambra PACS (Mariana) — Clínica Animais
    "553139910184",  // Manancial Medical — Clínica Animais
    "5511977697777", // Acessória Científica (Hellen) — Clínica Animais
    "551151024433",  // MHLAB (URIT) — Clínica Animais
    ...(process.env.BOT_BLOCKED_PHONES ?? "").split(","),
  ]
    .map((s) => s.replace(/\D/g, ""))
    .filter(Boolean)
);

function isBlockedPhone(phone: string): boolean {
  return BLOCKED_PHONES.has(phone.replace(/\D/g, ""));
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

  // Números bloqueados: o bot sai da frente por completo — nem registra.
  if (isBlockedPhone(phone)) return NextResponse.json({ received: true });

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

  // Mensagem do PROPRIETÁRIO: nunca aciona o agente de vendas.
  if (isOwnerPhone(phone)) {
    try {
      await processOwnerInbound({ phone, messageText, msgData, externalId });
    } catch (err) {
      console.error("[sales-webhook] erro no modo proprietário:", err);
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

// Ponte proprietário → Claude: registra comentários e áudios encaminhados no
// CRM (o binário do áudio fica no armazém da Evolution, de onde o Claude
// baixa). Responde só no início de uma rajada e no encerramento, para não
// poluir o chat do dono durante os encaminhamentos.
async function processOwnerInbound(params: {
  phone: string;
  messageText: string | null;
  msgData: Record<string, unknown>;
  externalId: string | null;
}) {
  const { phone, messageText, msgData, externalId } = params;

  const lead = await findOrCreateLeadByPhone(phone, null);
  if (!lead) return;
  const conversation = await getOrCreateConversation(lead.id);
  if (!conversation) return;

  const audio = (msgData.message as Record<string, unknown> | undefined)?.audioMessage as
    | { seconds?: number }
    | undefined;
  const content = messageText?.trim()
    ? messageText
    : audio
      ? `[áudio encaminhado ${audio.seconds ?? "?"}s]`
      : "[mídia não textual]";

  // Rajada nova? (nenhuma mensagem na última meia hora) → avisa que está na escuta.
  const lastOutboundAt = await getLastOutboundAt(conversation.id);
  const quietForMs = lastOutboundAt ? Date.now() - lastOutboundAt.getTime() : Infinity;

  await insertMessage({ conversationId: conversation.id, direction: "inbound", content, sentBy: "client", externalId });

  if (messageText && OWNER_DONE_RE.test(messageText)) {
    const done =
      "Recebido, chefe! ✅ Lote encerrado — o Claude vai baixar os áudios da Evolution, transcrever e organizar as respostas no questionário.";
    if (await safeSend(phone, done)) {
      await insertMessage({ conversationId: conversation.id, direction: "outbound", content: done, sentBy: "bot" });
    }
    return;
  }

  if (quietForMs > 30 * 60_000) {
    const intro =
      'Na escuta, chefe 👊 Modo ponte ativado: estou registrando cada áudio/comentário encaminhado. Quando terminar, diga "Isso é tudo até o momento".';
    if (await safeSend(phone, intro)) {
      await insertMessage({ conversationId: conversation.id, direction: "outbound", content: intro, sentBy: "bot" });
    }
  }
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

  // Registra a mensagem recebida. Se for reentrega do MESMO evento (a Evolution
  // repete o messages.upsert quando o webhook demora a responder), aborta aqui —
  // processar de novo era o loop do incidente DogFel 29/07.
  const fresh = await insertMessage({ conversationId: conversation.id, direction: "inbound", content: messageText, sentBy: "client", externalId });
  if (!fresh) {
    console.log("[sales-webhook] evento duplicado ignorado (external_id já processado):", externalId);
    return;
  }

  // Conversa em atendimento humano: o bot fica em silêncio. PONTO.
  // O "reassumir após 60min de inatividade" foi DESLIGADO por ordem do
  // Diretor (incidente 27/07: o bot atropelou negociações conduzidas por
  // humano — Clínica Animais e VFP — e queimou prospect). Reassumir agora é
  // opt-in explícito: só se HUMAN_IDLE_TAKEOVER_MINUTES for definido > 0.
  if (conversation.status === "human") {
    const idleMinutes = parseInt(process.env.HUMAN_IDLE_TAKEOVER_MINUTES ?? "0", 10);
    if (!Number.isFinite(idleMinutes) || idleMinutes <= 0) return;
    const lastOutboundAt = await getLastOutboundAt(conversation.id);
    const humanActive = lastOutboundAt && Date.now() - lastOutboundAt.getTime() < idleMinutes * 60_000;
    if (humanActive) return;
    await setConversationStatus(conversation.id, "bot");
    console.log(`[sales-webhook] humano inativo há +${idleMinutes}min — bot reassumiu a conversa (opt-in via env)`);
  }

  // Resposta automática de robô/URA da clínica: registra, mas não responde.
  if (looksLikeAutoReply(messageText)) {
    console.log("[sales-webhook] mensagem automática detectada — bot não responde:", messageText.slice(0, 80));
    return;
  }

  // Guarda-corpo anti-rajada: se o bot já falou 6+ vezes em 30min nesta
  // conversa, algo está errado (loop, robô do outro lado) — silencia e
  // transfere para humano em vez de continuar metralhando o prospect.
  const recentBot = await countRecentBotMessages(conversation.id, 30 * 60_000);
  if (recentBot >= 6) {
    console.error(`[sales-webhook] ANTI-RAJADA: ${recentBot} respostas do bot em 30min — conversa ${conversation.id} transferida para humano`);
    await setConversationStatus(conversation.id, "human");
    await notifyOwner(`⚠️ *ASSUMIR CONVERSA — possível loop*\n*${leadLabel(lead, phone)}*\nO bot respondeu ${recentBot}x em 30min e foi silenciado. A conversa está com você.`);
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

  // 🔥 Lead quente: o bot fechou uma reunião — o Diretor assume a condução.
  if (result.demoScheduled) {
    const { date, time } = result.demoScheduled;
    const label = new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
    await notifyOwner(`🔥 *REUNIÃO AGENDADA PELO BOT*\n*${leadLabel(lead, phone)}*\n📅 ${label} às ${time}\nÚltima msg do cliente: "${clip(messageText)}"\nAssuma a conversa no WhatsApp comercial para confirmar o link.`);
  }

  // Erros transitórios da API (Claude sem crédito ou instabilidade) NÃO transferem
  // para humano — bot tenta novamente na próxima mensagem.
  const isTransientError =
    result.handoffReason === "anthropic_error" || result.handoffReason === "anthropic_no_credits";
  if (result.handoff && !isTransientError) {
    await setConversationStatus(conversation.id, "human");
    await notifyOwner(`🔴 *ASSUMIR CONVERSA*\n*${leadLabel(lead, phone)}*\nMotivo: ${reasonLabel(result.handoffReason)}\nÚltima msg do cliente: "${clip(messageText)}"\nO bot silenciou — a conversa está com você no WhatsApp comercial.`);
  } else if (result.handoff && isTransientError) {
    await notifyOwner(`🟡 *LEAD SEM RESPOSTA (IA instável)*\n*${leadLabel(lead, phone)}*\nMotivo: ${reasonLabel(result.handoffReason)}\nMsg do cliente: "${clip(messageText)}"\nO bot tentará de novo na próxima mensagem — se quiser, assuma antes.`);
  }

  // Resposta vazia = o agente decidiu ficar em silêncio (incerteza/erro).
  // Nunca enviar string vazia nem placeholder.
  if (!result.reply.trim()) return;

  await insertMessage({ conversationId: conversation.id, direction: "outbound", content: result.reply, sentBy: "bot" });

  const ok = await safeSend(phone, result.reply);
  if (!ok) {
    await setConversationStatus(conversation.id, "human");
    await notifyOwner(`🔴 *ASSUMIR CONVERSA*\n*${leadLabel(lead, phone)}*\nMotivo: falha ao ENVIAR a resposta do bot (Evolution). Lead ficou sem retorno.\nÚltima msg do cliente: "${clip(messageText)}"`);
  }
}

function leadLabel(lead: { company_name?: string | null; name?: string | null }, phone: string): string {
  return `${lead.company_name ?? lead.name ?? "Lead sem nome"} · ${phone}`;
}

function clip(text: string | null | undefined): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > 180 ? t.slice(0, 180) + "…" : t;
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
