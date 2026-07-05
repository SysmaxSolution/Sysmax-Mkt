import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { salesDb } from "@/lib/supabase";
import { sendEmail } from "@/lib/mailer";
import { sendText } from "@/lib/evolution";
import { isSuppressed } from "@/lib/suppression";

// ===========================================================================
// Worker de envio. Só toca itens JÁ APROVADOS pelo fundador (status='approved')
// e respeita o warm-up do domínio: começa em WARMUP_MIN e-mails/dia e sobe
// WARMUP_STEP por dia até WARMUP_MAX. WhatsApp (warm) tem cap próprio e baixo.
// Cada disparo revalida a suppression list (guardrail LGPD).
// ===========================================================================

export const runtime = "nodejs";
export const maxDuration = 60;

const WARMUP_MIN = parseInt(process.env.WARMUP_MIN ?? "20", 10);
const WARMUP_MAX = parseInt(process.env.WARMUP_MAX ?? "40", 10);
const WARMUP_STEP = parseInt(process.env.WARMUP_STEP ?? "5", 10);
const WA_DAILY_CAP = parseInt(process.env.WA_DAILY_CAP ?? "15", 10);
const SEND_BATCH = parseInt(process.env.OUTBOX_SEND_BATCH ?? "25", 10);

function startOfTodayUTC(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

// Cap de e-mail do dia conforme rampa de aquecimento.
function emailCapToday(): number {
  const startEnv = process.env.WARMUP_START_DATE;
  if (!startEnv) return WARMUP_MIN;
  const start = new Date(startEnv).getTime();
  if (Number.isNaN(start)) return WARMUP_MIN;
  const days = Math.floor((Date.now() - start) / 86_400_000);
  return Math.min(WARMUP_MAX, WARMUP_MIN + Math.max(0, days) * WARMUP_STEP);
}

async function sentTodayCount(channel: "email" | "whatsapp"): Promise<number> {
  const { count } = await salesDb
    .from("outbox")
    .select("id", { count: "exact", head: true })
    .eq("channel", channel)
    .eq("status", "sent")
    .gte("sent_at", startOfTodayUTC());
  return count ?? 0;
}

type Row = {
  id: string;
  channel: "email" | "whatsapp";
  subject: string | null;
  body: string;
  lead_id: string;
  lead: { email: string | null; phone: string | null; opted_out: boolean } | null;
};

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) return new NextResponse("unauthorized", { status: 401 });

  const emailCap = emailCapToday();
  const emailRemaining = Math.max(0, emailCap - (await sentTodayCount("email")));
  const waRemaining = Math.max(0, WA_DAILY_CAP - (await sentTodayCount("whatsapp")));

  const { data, error } = await salesDb
    .from("outbox")
    .select("id,channel,subject,body,lead_id,lead:leads(email,phone,opted_out)")
    .eq("status", "approved")
    .in("channel", ["email", "whatsapp"]) // canais automáticos; call/ig_dm são worklist manual
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(SEND_BATCH * 2);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const rows = (data ?? []) as unknown as Row[];
  let emailsSent = 0, waSent = 0, skipped = 0, failed = 0, processed = 0;

  for (const row of rows) {
    if (processed >= SEND_BATCH) break;
    const lead = row.lead;
    if (!lead || lead.opted_out) { await mark(row.id, "failed", "lead opted_out/ausente"); skipped++; continue; }

    try {
      if (row.channel === "email") {
        if (emailsSent >= emailRemaining) continue;
        if (!lead.email) { await mark(row.id, "failed", "sem e-mail"); skipped++; continue; }
        if (await isSuppressed("email", lead.email)) { await mark(row.id, "rejected", "suppressed"); skipped++; continue; }
        const r = await sendEmail({ to: lead.email, subject: row.subject ?? "", text: row.body, leadId: row.lead_id });
        if (r.skipped) { await mark(row.id, "rejected", r.reason); skipped++; continue; }
        await mark(row.id, "sent", null, r.id);
        await salesDb.from("leads").update({ last_contact_at: new Date().toISOString() }).eq("id", row.lead_id);
        emailsSent++; processed++;
      } else {
        if (waSent >= waRemaining) continue;
        if (!lead.phone) { await mark(row.id, "failed", "sem telefone"); skipped++; continue; }
        if (await isSuppressed("whatsapp", lead.phone)) { await mark(row.id, "rejected", "suppressed"); skipped++; continue; }
        await sendText(lead.phone, row.body); // sendText já aplica throttle
        await mark(row.id, "sent", null);
        await salesDb.from("leads").update({ last_contact_at: new Date().toISOString() }).eq("id", row.lead_id);
        waSent++; processed++;
      }
    } catch (e) {
      await mark(row.id, "failed", e instanceof Error ? e.message : String(e));
      failed++;
    }
  }

  return NextResponse.json({
    ok: true,
    emailCap, emailRemaining, waRemaining,
    emailsSent, waSent, skipped, failed,
  });
}

async function mark(id: string, status: string, error: string | null, providerMsgId?: string): Promise<void> {
  const patch: Record<string, unknown> = { status, error };
  if (status === "sent") { patch.sent_at = new Date().toISOString(); if (providerMsgId) patch.provider_msg_id = providerMsgId; }
  await salesDb.from("outbox").update(patch).eq("id", id);
}
