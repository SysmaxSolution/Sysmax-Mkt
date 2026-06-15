import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";

// Consolida os KPIs do dia em metrics_daily. Fase 4.
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) return new NextResponse("unauthorized", { status: 401 });
  // TODO(Fase 4): calcular qualificacoes, conversao, tempo medio de resposta.
  return NextResponse.json({ ok: true, phase: "scaffold" }, { status: 501 });
}
