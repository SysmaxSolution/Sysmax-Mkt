import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { salesDb } from "@/lib/supabase";
import { sendText } from "@/lib/evolution";

// ===========================================================================
// Preview diário no WhatsApp PESSOAL do fundador (REVIEW_WHATSAPP_PHONE — um
// número DIFERENTE do da instância). Lista o que está na fila para aprovar
// (clínica · canal · trecho) + link do painel. A APROVAÇÃO continua no painel
// (não por link, para o app de mensagens não aprovar sozinho ao escanear URL).
// ===========================================================================

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_PER_SECTION = 8;

type Row = { channel: string; subject: string | null; body: string; lead: { company_name?: string; name?: string; city?: string; uf?: string; instagram_handle?: string } | null };

function clinicName(r: Row): string {
  return r.lead?.company_name ?? r.lead?.name ?? "clínica";
}
function firstLine(s: string, n = 60): string {
  const line = (s || "").split("\n").find((l) => l.trim()) ?? "";
  return line.length > n ? line.slice(0, n) + "…" : line;
}
function section(title: string, rows: Row[], render: (r: Row) => string): string {
  if (!rows.length) return "";
  const shown = rows.slice(0, MAX_PER_SECTION).map((r) => `• ${render(r)}`);
  const extra = rows.length > MAX_PER_SECTION ? `\n  +${rows.length - MAX_PER_SECTION} mais` : "";
  return `\n\n*${title} (${rows.length})*\n${shown.join("\n")}${extra}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) return new NextResponse("unauthorized", { status: 401 });

  const phone = process.env.REVIEW_WHATSAPP_PHONE;
  if (!phone) return NextResponse.json({ ok: true, skipped: "REVIEW_WHATSAPP_PHONE não configurado" });

  const { data, error } = await salesDb
    .from("outbox")
    .select("channel,subject,body,lead:leads(company_name,name,city,uf,instagram_handle)")
    .eq("status", "draft")
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const rows = (data ?? []) as unknown as Row[];
  const emails = rows.filter((r) => r.channel === "email");
  const calls = rows.filter((r) => r.channel === "call");
  const dms = rows.filter((r) => r.channel === "ig_dm");

  const { count: posts } = await salesDb
    .from("content_calendar")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending_approval");

  const total = rows.length;
  if (total === 0 && !posts) {
    return NextResponse.json({ ok: true, sent: false, reason: "fila vazia" });
  }

  const base = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
  let msg = `*Sysmax · fila de hoje (${total})*`;
  msg += section("E-mails p/ aprovar", emails, (r) => `${clinicName(r)} — ${firstLine(r.subject ?? "", 50)}`);
  msg += section("Ligações", calls, (r) => `${clinicName(r)} (${r.lead?.city ?? ""})`);
  msg += section("DM Instagram", dms, (r) => `${clinicName(r)}${r.lead?.instagram_handle ? " @" + r.lead.instagram_handle : ""}`);
  if (posts) msg += `\n\n*Posts p/ revisar:* ${posts}`;
  msg += `\n\nAprovar e-mails: ${base}/admin/outbox\nWorklist (ligar/DM): ${base}/admin/worklist`;

  try {
    await sendText(phone, msg);
    return NextResponse.json({ ok: true, sent: true, total, emails: emails.length, calls: calls.length, dms: dms.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
