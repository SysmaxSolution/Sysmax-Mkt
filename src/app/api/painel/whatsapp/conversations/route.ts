import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedViewer } from "@/lib/viewer-auth";
import { listWaConversations } from "@/lib/wa-accounts";

export const runtime = "nodejs";

// GET /api/painel/whatsapp/conversations — fila de conversas (todas as contas,
// mais recente primeiro). O historico cronologico existe porque toda mensagem
// enviada/recebida pelo painel grava aqui, sem depender de ninguem marcar.
export async function GET(req: NextRequest) {
  if (!isAuthorizedViewer(req)) return new NextResponse("unauthorized", { status: 401 });
  const conversations = await listWaConversations();
  return NextResponse.json({ ok: true, conversations });
}
