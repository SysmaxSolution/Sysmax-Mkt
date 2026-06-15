import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";

// Gera/publica as pecas da semana orquestrando o pipeline em marketing/. Fase 3.
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) return new NextResponse("unauthorized", { status: 401 });
  // TODO(Fase 3): planejar semana, gerar criativos e publicar via Graph API.
  return NextResponse.json({ ok: true, phase: "scaffold" }, { status: 501 });
}
