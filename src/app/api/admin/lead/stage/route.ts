import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedViewer } from "@/lib/viewer-auth";
import { salesDb } from "@/lib/supabase";

// ===========================================================================
// Atualiza o estágio (funil) de um lead a partir do painel comercial.
// Autorizado pelo VIEWER_TOKEN — o analista registra o progresso do prospecto:
// new → engaged (contatado) → qualified (respondeu) → demo → won (cliente) / lost.
// Carimba as datas de qualificação/fechamento e o último contato.
// ===========================================================================
export const runtime = "nodejs";

const STAGES = ["new", "engaged", "qualified", "demo", "won", "lost"] as const;
type Stage = (typeof STAGES)[number];

export async function POST(req: NextRequest) {
  if (!isAuthorizedViewer(req)) return new NextResponse("unauthorized", { status: 401 });

  const body = (await req.json().catch(() => null)) as { lead_id?: string; stage?: string } | null;
  const leadId = body?.lead_id;
  const stage = body?.stage as Stage | undefined;
  if (!leadId || !stage || !STAGES.includes(stage)) {
    return NextResponse.json({ ok: false, error: "lead_id e stage válido são obrigatórios" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { stage };
  if (stage !== "new") patch.last_contact_at = now;
  if (stage === "qualified") patch.qualified_at = now;
  if (stage === "won") patch.won_at = now;

  const { error } = await salesDb.from("leads").update(patch).eq("id", leadId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, stage });
}
