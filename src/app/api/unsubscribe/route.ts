import { NextRequest, NextResponse } from "next/server";
import { salesDb } from "@/lib/supabase";
import { verifyUnsub } from "@/lib/mailer";
import { addSuppression } from "@/lib/suppression";

// ===========================================================================
// Opt-out público (LGPD). Link assinado presente em todo e-mail frio.
// Aceita GET (clique no link) e POST (List-Unsubscribe one-click dos provedores).
// Baixa em suppression + marca lead.opted_out + registra consent_log.optout_at.
// ===========================================================================

export const runtime = "nodejs";

async function process(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const leadId = url.searchParams.get("lead") ?? "";
  const email = url.searchParams.get("email") ?? "";
  const token = url.searchParams.get("t") ?? "";

  if (!leadId || !email || !token || !verifyUnsub(leadId, email, token)) {
    return NextResponse.json({ ok: false, error: "link inválido" }, { status: 400 });
  }

  // 1) suppression global no canal e-mail (idempotente)
  await addSuppression("email", email, "unsubscribe");

  // 2) marca o lead como opted_out
  await salesDb.from("leads").update({ opted_out: true }).eq("id", leadId);

  // 3) trilha LGPD
  await salesDb.from("consent_log").insert({
    lead_id: leadId,
    identifier: email.toLowerCase(),
    channel: "email",
    optout_at: new Date().toISOString(),
  });

  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<div style="font-family:system-ui,sans-serif;max-width:480px;margin:64px auto;padding:0 24px;color:#0f172a">
<h2 style="color:#0d9488">Pronto, você foi removido.</h2>
<p>Não enviaremos mais e-mails para <strong>${email.replace(/</g, "&lt;")}</strong>. Desculpe pelo incômodo.</p>
<p style="color:#64748b;font-size:14px">Sysmax Software · SYSVETMAX</p>
</div>`;
  return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(req: NextRequest) {
  return process(req);
}

export async function POST(req: NextRequest) {
  return process(req);
}
