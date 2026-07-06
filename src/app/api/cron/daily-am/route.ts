import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { GET as discover } from "@/app/api/cron/discover/route";
import { GET as leadFollowups } from "@/app/api/cron/lead-followups/route";
import { GET as worklistBuild } from "@/app/api/cron/worklist-build/route";
import { GET as contentPipeline } from "@/app/api/cron/content-pipeline/route";

// ===========================================================================
// Orquestrador da MANHÃ (1 cron/dia — compatível com o plano Hobby do Vercel).
// Descobre clínicas novas (discover, 1 cidade/dia) e depois prepara as mensagens
// (lead-followups + worklist-build) e o post do dia (content-pipeline). Tudo só
// PREPARA material p/ aprovação; nada é enviado aqui. O fundador aprova no
// /admin/outbox até o disparo da tarde.
// ===========================================================================

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) return new NextResponse("unauthorized", { status: 401 });

  // 1) descoberta (topo de funil) — precisa vir antes p/ os builders pegarem os novos leads
  const discovered = await discover(req).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));
  // 2) preparação de mensagens (não envia)
  const drafts = await leadFollowups(req).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));
  const worklist = await worklistBuild(req).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));
  const content = await contentPipeline(req).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));

  return NextResponse.json({ ok: true, stage: "daily-am", discovered, drafts, worklist, content });
}
