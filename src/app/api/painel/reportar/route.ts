import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedViewer } from "@/lib/viewer-auth";
import { salesDb } from "@/lib/supabase";

// ===========================================================================
// /api/painel/reportar — canal de erro/problema para quem usa o painel sem
// acesso ao WhatsApp da equipe (os funcionários). Qualquer um com VIEWER_TOKEN
// pode registrar; a leitura é só para quem acompanha o canal de suporte.
// ===========================================================================

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!isAuthorizedViewer(req)) return new NextResponse("unauthorized", { status: 401 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const mensagem = typeof b?.mensagem === "string" ? b.mensagem.trim().slice(0, 2000) : "";
  if (!mensagem) return NextResponse.json({ ok: false, error: "Descreva o problema antes de enviar." }, { status: 400 });
  const autor = typeof b?.autor === "string" ? b.autor.trim().slice(0, 120) || null : null;
  const pagina = typeof b?.pagina === "string" ? b.pagina.trim().slice(0, 120) || null : null;
  const { error } = await salesDb.from("support_reports").insert({ autor, pagina, mensagem });
  if (error) return NextResponse.json({ ok: false, error: "Não consegui registrar. Tente de novo." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
