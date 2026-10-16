import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedViewer } from "@/lib/viewer-auth";
import { salesDb } from "@/lib/supabase";

// ===========================================================================
// POST /api/painel/importar/falha — o NAVEGADOR conta o que deu errado.
//
// Em 16/10 tres importacoes dela sumiram sem deixar rastro nenhum: o painel
// mostrava "falha de rede" e aqui nao chegava nada. Quando a propria rota de
// importacao quebra (tempo estourado, resposta que nao e JSON, erro do
// gateway), nao sobra registro do lado do servidor — so o navegador sabe.
// Entao ele conta. Guarda status HTTP e o tamanho do texto, nunca o texto.
// ===========================================================================

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!isAuthorizedViewer(req)) return new NextResponse("unauthorized", { status: 401 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const status = typeof b?.status === "number" ? b.status : null;
  const chars = typeof b?.chars === "number" ? b.chars : null;
  const etapa = b?.etapa === "gravacao" ? "falha-gravacao" : "falha-previa";
  const detalhe = typeof b?.detalhe === "string" ? b.detalhe.slice(0, 300) : "";
  await salesDb.from("import_runs").insert({
    etapa,
    chars,
    erro: `navegador: HTTP ${status ?? "?"}${detalhe ? ` — ${detalhe}` : ""}`,
  });
  return NextResponse.json({ ok: true });
}
