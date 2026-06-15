import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";

// Follow-ups multi-touch e reengajamento/anti-churn. Fase 4.
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) return new NextResponse("unauthorized", { status: 401 });
  // TODO(Fase 4): selecionar leads frios/clientes em risco e disparar follow-up.
  return NextResponse.json({ ok: true, phase: "scaffold" }, { status: 501 });
}
