import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedViewer } from "@/lib/viewer-auth";
import { salesDb } from "@/lib/supabase";

// ===========================================================================
// Lote de conteúdo do dia para a aba de Posts do painel: 5 posts + 2 vídeos +
// 1 anúncio (content_calendar, gerado pelo content-pipeline). Só leitura,
// protegido por VIEWER_TOKEN.
// ===========================================================================
export const runtime = "nodejs";

type Item = { id: string; pillar: string; format: string; brief: string; scheduled_for: string | null; status: string; asset_path: string | null };

export async function GET(req: NextRequest) {
  if (!isAuthorizedViewer(req)) return new NextResponse("unauthorized", { status: 401 });

  // pega o lote mais recente (posts/videos/ad), até 3 dias atrás
  const { data, error } = await salesDb
    .from("content_calendar")
    .select("id,pillar,format,brief,scheduled_for,status,asset_path")
    .in("pillar", ["post", "video", "ad"])
    .order("scheduled_for", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(24);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const items = (data ?? []) as Item[];
  const date = items[0]?.scheduled_for ?? null;
  const batch = items.filter((i) => i.scheduled_for === date);

  const parse = (i: Item) => {
    let content: Record<string, unknown> = {};
    try { content = JSON.parse(i.brief); } catch { content = { caption: i.brief }; }
    return { id: i.id, type: i.pillar, format: i.format, status: i.status, assetPath: i.asset_path ?? null, content };
  };

  const posts = batch.filter((i) => i.pillar === "post").map(parse);
  const videos = batch.filter((i) => i.pillar === "video").map(parse);
  const ad = batch.filter((i) => i.pillar === "ad").map(parse)[0] ?? null;

  return NextResponse.json({ ok: true, date, posts, videos, ad });
}
