import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedViewer } from "@/lib/viewer-auth";
import { salesDb } from "@/lib/supabase";
import { cleanText } from "@/crm/lead-intake";

// ===========================================================================
// POST /api/painel/contato-manual — registra um contato que a equipe fez POR
// FORA do sistema (WhatsApp no aparelho dela, ligação, DM). Não envia nada:
// só deixa o rastro na outbox para o relatório do dia e para o Diretor
// acompanhar o que foi feito, sem ninguém precisar escrever resumo à mão.
// ===========================================================================

export const runtime = "nodejs";

const CANAIS = ["whatsapp", "call", "ig_dm"] as const;
type Canal = (typeof CANAIS)[number];

export async function POST(req: NextRequest) {
  if (!isAuthorizedViewer(req)) return new NextResponse("unauthorized", { status: 401 });

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const leadId = cleanText(b?.leadId, 60);
  const channel = cleanText(b?.channel, 20) as Canal;
  const body = cleanText(b?.body, 20_000);
  if (!leadId || !CANAIS.includes(channel)) {
    return NextResponse.json({ ok: false, error: "Canal inválido." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { error } = await salesDb.from("outbox").insert({
    lead_id: leadId,
    channel,
    body: body || `(contato por ${channel} registrado no painel)`,
    status: "sent",
    approved_by: cleanText(b?.sender, 60) || "painel",
    approved_at: now,
    scheduled_for: now,
    sent_at: now,
  });
  if (error) return NextResponse.json({ ok: false, error: "Não consegui registrar." }, { status: 500 });

  const patch: Record<string, unknown> = { last_contact_at: now };
  const { data: lead } = await salesDb.from("leads").select("stage").eq("id", leadId).maybeSingle();
  if (lead?.stage === "new") patch.stage = "engaged";
  await salesDb.from("leads").update(patch).eq("id", leadId);

  return NextResponse.json({ ok: true });
}
