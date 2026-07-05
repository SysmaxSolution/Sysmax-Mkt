import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { GET as leadFollowups } from "@/app/api/cron/lead-followups/route";
import { GET as worklistBuild } from "@/app/api/cron/worklist-build/route";
import { GET as contentPipeline } from "@/app/api/cron/content-pipeline/route";

// ===========================================================================
// Orquestrador da MANHÃ (1 cron/dia — compatível com o plano Hobby do Vercel).
// Roda o builder de rascunhos (lead-followups) e a geração do post do dia
// (content-pipeline). Ambos apenas PREPARAM material p/ aprovação; nada é
// enviado aqui. O fundador aprova no /admin/outbox até o disparo da tarde.
// ===========================================================================

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) return new NextResponse("unauthorized", { status: 401 });

  const drafts = await leadFollowups(req).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));
  const worklist = await worklistBuild(req).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));
  const content = await contentPipeline(req).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));

  return NextResponse.json({ ok: true, stage: "daily-am", drafts, worklist, content });
}
