import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { salesDb } from "@/lib/supabase";
import { sendText } from "@/lib/evolution";

// ===========================================================================
// Consolida o funil do dia em metrics_daily e monta o placar kill/scale:
// meta = 3 clínicas NOVAS pagando preço cheio em 60 dias (decisão do PO).
// Envia um digest ao fundador (WhatsApp interno — canal warm/próprio, seguro).
// ===========================================================================

export const runtime = "nodejs";
export const maxDuration = 60;

// Meta do piloto (decisão do PO após council 2026-07-01).
const GOAL_CLIENTS = parseInt(process.env.KILLSCALE_GOAL ?? "3", 10);
const GOAL_DAYS = parseInt(process.env.KILLSCALE_DAYS ?? "60", 10);

function dayBoundsUTC(offsetDays = 0): { start: string; end: string; date: string } {
  const now = new Date();
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offsetDays * 86_400_000;
  const start = new Date(base);
  const end = new Date(base + 86_400_000);
  return { start: start.toISOString(), end: end.toISOString(), date: start.toISOString().slice(0, 10) };
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) return new NextResponse("unauthorized", { status: 401 });

  // Consolida o DIA DE HOJE (o cron roda de madrugada; queremos o acumulado corrente).
  const { start, end, date } = dayBoundsUTC(0);
  const head = { count: "exact" as const, head: true };

  const prospects = (await salesDb.from("leads").select("id", head)
    .gte("discovered_at", start).lt("discovered_at", end)).count ?? 0;
  const emailsSent = (await salesDb.from("outbox").select("id", head)
    .eq("channel", "email").eq("status", "sent").gte("sent_at", start).lt("sent_at", end)).count ?? 0;
  const demosScheduled = (await salesDb.from("demos").select("id", head)
    .gte("created_at", start).lt("created_at", end)).count ?? 0;
  const payingFull = (await salesDb.from("leads").select("id", head)
    .eq("stage", "won").gte("won_at", start).lt("won_at", end)).count ?? 0;
  const leadsNew = (await salesDb.from("leads").select("id", head)
    .gte("created_at", start).lt("created_at", end)).count ?? 0;

  await salesDb.from("metrics_daily").upsert({
    date,
    leads_new: leadsNew,
    prospects_discovered: prospects,
    emails_sent: emailsSent,
    demos_scheduled: demosScheduled,
    paying_full_price: payingFull,
    computed_at: new Date().toISOString(),
  }, { onConflict: "date" });

  // --- Placar kill/scale (janela de GOAL_DAYS) ---
  let scoreboard = "";
  const startEnv = process.env.KILLSCALE_START_DATE;
  if (startEnv) {
    const startMs = new Date(startEnv).getTime();
    if (!Number.isNaN(startMs)) {
      const daysElapsed = Math.floor((Date.now() - startMs) / 86_400_000);
      const daysLeft = Math.max(0, GOAL_DAYS - daysElapsed);
      const { count: wonSince } = await salesDb
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("stage", "won")
        .gte("won_at", new Date(startMs).toISOString());
      scoreboard = `\n\nPLACAR (meta ${GOAL_CLIENTS} clientes cheios em ${GOAL_DAYS}d): ${wonSince ?? 0}/${GOAL_CLIENTS} · ${daysLeft} dias restantes`;
    }
  }

  // --- Digest ao fundador (canal interno/warm) ---
  const founder = process.env.FOUNDER_WHATSAPP_PHONE;
  const digest = `Sysmax · funil ${date}
Prospects descobertos: ${prospects}
E-mails enviados: ${emailsSent}
Demos agendadas: ${demosScheduled}
Novos clientes (cheio): ${payingFull}${scoreboard}`;
  let digestSent = false;
  if (founder) {
    try { await sendText(founder, digest); digestSent = true; } catch { /* não bloqueia o rollup */ }
  }

  return NextResponse.json({ ok: true, date, prospects, emailsSent, demosScheduled, payingFull, digestSent });
}
