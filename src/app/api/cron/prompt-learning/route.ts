import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { salesDb } from "@/lib/supabase";
import { createMessageWithFallback, SALES_MODEL } from "@/lib/anthropic";
import { BRAND } from "@/lib/brand";
import { savePlaybook } from "@/lib/playbook";

// ===========================================================================
// PROMPT LEARNING — o bot estuda o que aconteceu de verdade para escrever
// melhor amanhã. Fontes:
//   1. Conversas de WhatsApp dos últimos 14 dias (cliente, bot e CONSULTOR
//      HUMANO — o texto do humano é o padrão-ouro de tom).
//   2. Resultados do outbox: o que o fundador enviou/executou vs pulou/
//      rejeitou, por canal (email, call, ig_dm, whatsapp).
// Destila até 12 diretrizes acionáveis e grava em sales_playbook (append-only).
// A versão mais recente é injetada nos prompts de worklist-build,
// lead-followups e no system prompt do sales-agent.
// Roda no início do daily-am, antes dos builders do dia.
// ===========================================================================

export const runtime = "nodejs";
export const maxDuration = 60;

const LOOKBACK_DAYS = parseInt(process.env.LEARNING_LOOKBACK_DAYS ?? "14", 10);
const MAX_CONVERSATIONS = 20;
const MAX_MSG_CHARS = 220;

const LEARN_SYSTEM = `Você é o coach comercial da ${BRAND.company} (${BRAND.product}, sistema para clínicas veterinárias). Estude o material real abaixo — conversas de WhatsApp (bot, consultor humano e clientes) e o placar das mensagens preparadas (enviadas/executadas vs puladas/rejeitadas pelo fundador) — e destile DIRETRIZES PRÁTICAS para as próximas mensagens geradas: e-mail frio, roteiro de ligação, DM de Instagram e respostas do bot no WhatsApp.

Procure especialmente:
- O que o CONSULTOR HUMANO escreveu que o bot não faria (tom, abertura, tamanho, timing) — imite.
- Mensagens AUTOMÁTICAS de clínicas (menus "digite 1", fora do horário, saudação de robô): como reconhecê-las e nunca tratá-las como pessoa.
- Objeções recorrentes e as respostas que avançaram o lead no funil.
- Padrões nas mensagens que o fundador pulou/rejeitou (evitar) vs enviou/executou (repetir).
- Erros do bot: responder quando não devia, repetir pergunta, mensagem longa demais, pitch prematuro.

SAÍDA: somente linhas iniciando com "- " (até 12 bullets), em pt-BR, curtas e acionáveis, começando com verbo no imperativo. Sem título, sem introdução, sem conclusão. Máximo 1200 caracteres no total. Se o material for insuficiente para uma conclusão, não invente: escreva menos bullets.`;

type Msg = { conversation_id: string; direction: string; sent_by: string; content: string; created_at: string };

function extractText(msg: { content: Array<{ type: string; text?: string }> }): string {
  return msg.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
}

function speakerLabel(m: Msg): string {
  if (m.direction === "inbound") return "CLIENTE";
  return m.sent_by === "human" ? "CONSULTOR HUMANO" : "BOT";
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) return new NextResponse("unauthorized", { status: 401 });

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();

  // 1) Conversas recentes de WhatsApp.
  const { data: msgs, error: msgErr } = await salesDb
    .from("messages")
    .select("conversation_id,direction,sent_by,content,created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(400);
  if (msgErr) return NextResponse.json({ ok: false, error: msgErr.message }, { status: 500 });

  const byConv = new Map<string, Msg[]>();
  for (const m of (msgs ?? []) as Msg[]) {
    const list = byConv.get(m.conversation_id) ?? [];
    list.push(m);
    byConv.set(m.conversation_id, list);
  }

  // Status da conversa + estágio do lead para dar contexto de resultado.
  const convIds = [...byConv.keys()].slice(0, MAX_CONVERSATIONS);
  const convMeta = new Map<string, { status: string; stage: string }>();
  if (convIds.length) {
    const { data: convs } = await salesDb
      .from("conversations")
      .select("id,status,lead_id,leads(stage)")
      .in("id", convIds);
    for (const c of convs ?? []) {
      const lead = c.leads as unknown as { stage?: string } | { stage?: string }[] | null;
      const stage = (Array.isArray(lead) ? lead[0]?.stage : lead?.stage) ?? "?";
      convMeta.set(c.id as string, { status: c.status as string, stage });
    }
  }

  // 2) Placar do outbox (o que o fundador aprovou/executou vs pulou).
  const { data: outcomes } = await salesDb
    .from("outbox")
    .select("channel,status,subject,body")
    .gte("created_at", since)
    .in("status", ["sent", "rejected"])
    .limit(80);

  const msgCount = msgs?.length ?? 0;
  const outCount = outcomes?.length ?? 0;
  if (msgCount < 6 && outCount < 5) {
    return NextResponse.json({ ok: true, skipped: "material insuficiente", messages: msgCount, outbox: outCount });
  }

  // 3) Monta o dossiê compacto para estudo.
  const parts: string[] = [];
  let i = 0;
  for (const id of convIds) {
    i++;
    const meta = convMeta.get(id);
    const lines = (byConv.get(id) ?? []).map(
      (m) => `[${speakerLabel(m)}] ${m.content.slice(0, MAX_MSG_CHARS)}`,
    );
    parts.push(`### Conversa ${i} (status: ${meta?.status ?? "?"}, estágio do lead: ${meta?.stage ?? "?"})\n${lines.join("\n")}`);
  }

  if (outCount) {
    const score: Record<string, { sent: number; rejected: number }> = {};
    const samples: string[] = [];
    for (const o of outcomes ?? []) {
      const ch = o.channel as string;
      score[ch] = score[ch] ?? { sent: 0, rejected: 0 };
      score[ch][o.status as "sent" | "rejected"]++;
      if (samples.length < 10) {
        samples.push(`[${ch} · ${o.status === "sent" ? "ENVIADO/EXECUTADO" : "PULADO/REJEITADO"}] ${(o.subject ? o.subject + " — " : "")}${(o.body as string).slice(0, 260)}`);
      }
    }
    parts.push(`### Placar do outbox por canal\n${JSON.stringify(score)}\n\n### Amostras de mensagens preparadas\n${samples.join("\n---\n")}`);
  }

  // 4) Destila as diretrizes.
  let insights: string;
  try {
    const msg = await createMessageWithFallback({
      model: SALES_MODEL,
      max_tokens: 700,
      temperature: 0.3,
      system: LEARN_SYSTEM,
      messages: [{ role: "user", content: `Material dos últimos ${LOOKBACK_DAYS} dias:\n\n${parts.join("\n\n")}` }],
    });
    insights = extractText(msg);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  // Aceita só saída no formato esperado (linhas "- ").
  const bullets = insights.split("\n").filter((l) => l.trim().startsWith("- "));
  if (!bullets.length) {
    return NextResponse.json({ ok: false, error: "saída sem bullets — playbook não atualizado" }, { status: 422 });
  }
  const finalText = bullets.slice(0, 12).join("\n").slice(0, 1500);

  await savePlaybook("global", finalText, {
    lookback_days: LOOKBACK_DAYS,
    conversations: convIds.length,
    messages: msgCount,
    outbox_outcomes: outCount,
  });

  return NextResponse.json({ ok: true, conversations: convIds.length, messages: msgCount, outbox: outCount, bullets: bullets.length });
}
