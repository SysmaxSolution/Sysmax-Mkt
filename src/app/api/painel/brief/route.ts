import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedViewer } from "@/lib/viewer-auth";
import { salesDb } from "@/lib/supabase";

// ===========================================================================
// Briefing da equipe: contexto/direção que o gerador de conteúdo (content-
// pipeline) segue na próxima geração de posts/vídeos. Guardado como uma linha
// marcadora em content_calendar (pillar='brief'). GET lê o atual, POST salva.
// Protegido por VIEWER_TOKEN.
// ===========================================================================
export const runtime = "nodejs";

// util compartilhado: retorna o texto do briefing atual (ou "").
export async function getActiveBrief(): Promise<string> {
  const { data } = await salesDb
    .from("content_calendar")
    .select("brief")
    .eq("pillar", "brief")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.brief as string) ?? "";
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedViewer(req)) return new NextResponse("unauthorized", { status: 401 });
  const { data } = await salesDb
    .from("content_calendar")
    .select("id,brief,created_at")
    .eq("pillar", "brief")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return NextResponse.json({ ok: true, brief: (data?.brief as string) ?? "", updatedAt: data?.created_at ?? null });
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedViewer(req)) return new NextResponse("unauthorized", { status: 401 });
  const body = (await req.json().catch(() => null)) as { brief?: string } | null;
  const text = (body?.brief ?? "").toString().slice(0, 4000).trim();

  // mantém uma única linha ativa: atualiza a mais recente, senão cria.
  const { data: existing } = await salesDb
    .from("content_calendar")
    .select("id")
    .eq("pillar", "brief")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await salesDb.from("content_calendar").update({ brief: text }).eq("id", existing.id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  } else {
    const { error } = await salesDb
      .from("content_calendar")
      .insert({ pillar: "brief", platform: "instagram", format: "brief", brief: text, status: "planned" });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
