import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";

// Fallback de mencoes nao cobertas pelo webhook Meta. Fase 2.
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) return new NextResponse("unauthorized", { status: 401 });
  // TODO(Fase 2): varrer mencoes recentes via Graph API e gravar social_events.
  return NextResponse.json({ ok: true, phase: "scaffold" }, { status: 501 });
}
