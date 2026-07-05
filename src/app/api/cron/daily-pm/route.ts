import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { GET as outboxSend } from "@/app/api/cron/outbox-send/route";
import { GET as metricsRollup } from "@/app/api/cron/metrics-rollup/route";

// ===========================================================================
// Orquestrador da TARDE (1 cron/dia — compatível com o plano Hobby do Vercel).
// Envia os itens JÁ APROVADOS pelo fundador (outbox-send, respeitando warm-up)
// e depois consolida o funil do dia + digest (metrics-rollup).
// ===========================================================================

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) return new NextResponse("unauthorized", { status: 401 });

  const sent = await outboxSend(req).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));
  const metrics = await metricsRollup(req).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));

  return NextResponse.json({ ok: true, stage: "daily-pm", sent, metrics });
}
