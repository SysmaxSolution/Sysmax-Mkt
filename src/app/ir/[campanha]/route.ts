import { NextRequest, NextResponse } from "next/server";
import { salesDb } from "@/lib/supabase";

// ===========================================================================
// GET /ir/<campanha>[?p=caminho] — link de divulgação que conta o clique e
// manda a pessoa para o site.
//
// Existe porque o site é estático e não tem nenhuma medição: para o anúncio o
// Gerenciador de Anúncios conta os cliques, mas para post orgânico e para o
// que a equipe espalha em grupo não havia resposta nenhuma ("não sei como ter
// essa resposta se alguém clicou no site" — 2026-10-16).
//
// Não grava nada da pessoa: campanha, destino e horário. Sem IP, sem cookie,
// sem terceiro. A contagem vira número no "Relatório do mês".
//
//   /ir/fb-grupos            → sysmaxsolutions.com
//   /ir/fb-anuncio?p=modulos → sysmaxsolutions.com/modulos
// ===========================================================================

export const runtime = "nodejs";

const SITE = "https://sysmaxsolutions.com";
const CAMPANHA_OK = /^[a-z0-9][a-z0-9-]{0,39}$/;
const CAMINHO_OK = /^[a-z0-9][a-z0-9/_-]{0,59}$/;

export async function GET(req: NextRequest, ctx: { params: Promise<{ campanha: string }> }) {
  const { campanha } = await ctx.params;
  const slug = (campanha ?? "").toLowerCase();

  // Campanha inválida não vira erro na cara de quem clicou: manda para o site
  // do mesmo jeito, só não conta.
  if (!CAMPANHA_OK.test(slug)) return NextResponse.redirect(SITE, 302);

  const p = (req.nextUrl.searchParams.get("p") ?? "").replace(/^\/+/, "").toLowerCase();
  const caminho = p && CAMINHO_OK.test(p) ? `/${p}` : "";

  // utm fica no destino para o dia em que o site tiver medição própria.
  const destino = `${SITE}${caminho}?utm_source=facebook&utm_medium=social&utm_campaign=${encodeURIComponent(slug)}`;

  try {
    await salesDb.from("link_clicks").insert({ campanha: slug, destino: caminho || "/" });
  } catch {
    // Contagem nunca pode segurar o visitante: se o banco falhar, segue o link.
  }

  return NextResponse.redirect(destino, 302);
}
