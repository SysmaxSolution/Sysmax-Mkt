import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { salesDb } from "@/lib/supabase";

// ===========================================================================
// Score automático do lead — NINGUÉM digita este número.
// Base para o Kanban (quente/frio) e para o copiloto de sugestão identificarem
// prioridade sem depender de "feeling" do analista.
//
// Fórmula (0-100, documentada para poder ajustar sem virar caixa-preta):
//   base 50
//   - até -40 por dias sem contato (last_contact_at), -10 se nunca contatado
//   + até +30 por mensagens recebidas (wa_messages, direction=in) nos últimos 7 dias
//   + 15 se a conversa está marcada needs_director_review (sinal de engajamento real)
//   - 15 se opted_out
// ===========================================================================

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) return new NextResponse("unauthorized", { status: 401 });

  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 86_400_000).toISOString();

  const { data: leads, error: le } = await salesDb
    .from("leads")
    .select("id, last_contact_at, opted_out, stage")
    .not("stage", "in", "(won,lost)");
  if (le) return NextResponse.json({ ok: false, error: le.message }, { status: 500 });

  const { data: conversations } = await salesDb
    .from("wa_conversations")
    .select("id, lead_id, needs_director_review")
    .not("lead_id", "is", null);

  const convByLead = new Map<string, { ids: string[]; review: boolean }>();
  for (const c of (conversations ?? []) as { id: string; lead_id: string; needs_director_review: boolean }[]) {
    const entry = convByLead.get(c.lead_id) ?? { ids: [], review: false };
    entry.ids.push(c.id);
    entry.review = entry.review || c.needs_director_review;
    convByLead.set(c.lead_id, entry);
  }

  const allConvIds = [...convByLead.values()].flatMap((v) => v.ids);
  const inboundCountByConv = new Map<string, number>();
  if (allConvIds.length > 0) {
    const { data: msgs } = await salesDb
      .from("wa_messages")
      .select("conversation_id")
      .eq("direction", "in")
      .gte("sent_at", sevenDaysAgo)
      .in("conversation_id", allConvIds);
    for (const m of (msgs ?? []) as { conversation_id: string }[]) {
      inboundCountByConv.set(m.conversation_id, (inboundCountByConv.get(m.conversation_id) ?? 0) + 1);
    }
  }

  let updated = 0;
  for (const lead of (leads ?? []) as { id: string; last_contact_at: string | null; opted_out: boolean | null; stage: string }[]) {
    let score = 50;

    if (!lead.last_contact_at) {
      score -= 10;
    } else {
      const daysSince = (now - new Date(lead.last_contact_at).getTime()) / 86_400_000;
      score -= Math.min(40, Math.round(daysSince * 2));
    }

    const conv = convByLead.get(lead.id);
    if (conv) {
      const inbound = conv.ids.reduce((sum, id) => sum + (inboundCountByConv.get(id) ?? 0), 0);
      score += Math.min(30, inbound * 5);
      if (conv.review) score += 15;
    }

    if (lead.opted_out) score -= 15;

    score = Math.max(0, Math.min(100, score));

    const { error } = await salesDb
      .from("leads")
      .update({ lead_score: score, lead_score_computed_at: new Date().toISOString() })
      .eq("id", lead.id);
    if (!error) updated++;
  }

  return NextResponse.json({ ok: true, updated, total: leads?.length ?? 0 });
}
