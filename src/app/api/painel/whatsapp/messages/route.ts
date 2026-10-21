import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedViewer } from "@/lib/viewer-auth";
import { listWaMessages } from "@/lib/wa-accounts";
import { cleanText } from "@/crm/lead-intake";

export const runtime = "nodejs";

// GET /api/painel/whatsapp/messages?conversationId=... — historico de uma conversa.
export async function GET(req: NextRequest) {
  if (!isAuthorizedViewer(req)) return new NextResponse("unauthorized", { status: 401 });
  const conversationId = cleanText(req.nextUrl.searchParams.get("conversationId"), 60);
  if (!conversationId) return NextResponse.json({ ok: false, error: "Conversa não informada." }, { status: 400 });
  const messages = await listWaMessages(conversationId);
  return NextResponse.json({ ok: true, messages });
}
