import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedViewer } from "@/lib/viewer-auth";
import { salesDb } from "@/lib/supabase";

// ===========================================================================
// /api/painel/videos — a prateleira de vídeos prontos para o TikTok.
//
// Combinado em 16/10: eu gero o vídeo com a legenda, ela baixa no PC e
// publica. Link solto no WhatsApp resolve uma vez; na terceira semana
// ninguém acha mais nada e ninguém sabe o que já foi ao ar. Aqui ela vê o
// que existe, copia a legenda e marca o que publicou.
//
// GET  lista os vídeos, não publicados primeiro.
// POST { arquivo, publicado } marca ou desmarca como publicado.
// ===========================================================================

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAuthorizedViewer(req)) return new NextResponse("unauthorized", { status: 401 });
  const { data, error } = await salesDb
    .from("videos_tiktok")
    .select("arquivo,url,titulo,gancho,legenda,duracao_seg,criado_em,publicado_em")
    .order("criado_em", { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: "Não consegui ler os vídeos." }, { status: 500 });
  const itens = (data ?? []).sort((a, b) => Number(!!a.publicado_em) - Number(!!b.publicado_em));
  return NextResponse.json({ ok: true, itens });
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedViewer(req)) return new NextResponse("unauthorized", { status: 401 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const arquivo = typeof b?.arquivo === "string" ? b.arquivo.trim() : "";
  if (!arquivo) return NextResponse.json({ ok: false, error: "Vídeo não informado." }, { status: 400 });
  // Desmarcar existe de propósito: ela pode marcar errado, e tirar de novo
  // não pode exigir pedir para alguém.
  const publicado = b?.publicado !== false;
  const { error } = await salesDb
    .from("videos_tiktok")
    .update({ publicado_em: publicado ? new Date().toISOString() : null })
    .eq("arquivo", arquivo);
  if (error) return NextResponse.json({ ok: false, error: "Não consegui marcar." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
