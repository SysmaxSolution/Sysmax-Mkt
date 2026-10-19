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

// wa_call = ligacao PELO WhatsApp. Separado do "whatsapp" escrito a pedido
// da captacao: sao caminhos com taxa de resposta diferente e ela quer medir
// cada um sem misturar.
const CANAIS = ["whatsapp", "wa_call", "call", "ig_dm", "fb_dm", "tiktok_dm"] as const;
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

  // Desmarcar: ela pediu em 16/10 -- "da pra marcar, mas nao consigo
  // desmarcar". Marca errada que nao sai e pior que marca nenhuma, porque
  // suja o relatorio e ela perde a confianca no que ve.
  if (b?.remover === true) {
    const { error: eDel } = await salesDb
      .from("outbox")
      .delete()
      .eq("lead_id", leadId)
      .eq("channel", channel)
      .eq("status", "sent");
    if (eDel) return NextResponse.json({ ok: false, error: "Não consegui desmarcar." }, { status: 500 });
    return NextResponse.json({ ok: true, removido: true });
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
