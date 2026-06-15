import { NextRequest, NextResponse } from "next/server";

// Webhook da instancia COMERCIAL da Evolution API (numero Sysmax).
// Fase 1: normaliza evento MESSAGES_UPSERT, registra a mensagem inbound,
// detecta handoff (fromMe) e aciona o sales-agent.

export async function POST(_req: NextRequest) {
  // TODO(Fase 1): processar evento da Evolution e chamar runSalesAgent.
  return NextResponse.json({ ok: true, phase: "scaffold" }, { status: 501 });
}
