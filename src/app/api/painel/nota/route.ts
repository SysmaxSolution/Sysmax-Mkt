import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedViewer } from "@/lib/viewer-auth";
import { salesDb } from "@/lib/supabase";
import { cleanText } from "@/crm/lead-intake";

// ===========================================================================
// POST /api/painel/nota — o que foi dito na conversa com a clínica.
//
// O painel sabia QUE houve contato e por qual canal, mas não O QUE foi falado.
// Argumento dela em 16/10: "como você vai ter certeza dos resultados ou ações
// feitas fora do painel? tudo que é feito dentro do painel tem relatório".
// Sem isso, o conteúdo da ligação vive só na memória de quem ligou — e some
// junto com a pessoa.
//
// Grava em leads.notes (campo que já existia e só era lido na aba de leads do
// site). Texto livre, limite generoso.
// ===========================================================================

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!isAuthorizedViewer(req)) return new NextResponse("unauthorized", { status: 401 });

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const leadId = cleanText(b?.leadId, 60);
  if (!leadId) return NextResponse.json({ ok: false, error: "Clínica não informada." }, { status: 400 });

  const texto = typeof b?.texto === "string" ? b.texto.trim() : "";
  if (texto.length > 20_000) {
    return NextResponse.json({ ok: false, error: "Anotação grande demais." }, { status: 413 });
  }

  const { error } = await salesDb.from("leads").update({ notes: texto || null }).eq("id", leadId);
  if (error) return NextResponse.json({ ok: false, error: "Não consegui salvar a anotação." }, { status: 500 });

  return NextResponse.json({ ok: true, texto: texto || null });
}
