import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { GET as promptLearning } from "@/app/api/cron/prompt-learning/route";
import { GET as discover } from "@/app/api/cron/discover/route";
import { GET as leadFollowups } from "@/app/api/cron/lead-followups/route";
import { GET as worklistBuild } from "@/app/api/cron/worklist-build/route";
import { GET as contentPipeline } from "@/app/api/cron/content-pipeline/route";
import { GET as outboxSend } from "@/app/api/cron/outbox-send/route";

// ===========================================================================
// Orquestrador da MANHÃ (1 cron/dia — compatível com o plano Hobby do Vercel).
// Roda às 14:00 UTC (11h BRT): descobre clínicas novas (discover, 1 cidade/dia),
// prepara as mensagens (lead-followups + worklist-build), o post do dia
// (content-pipeline) e faz o 1º DISPARO do dia (outbox-send, até WA_RUN_CAP).
// O daily-pm (17h BRT) faz o 2º disparo, completando o cap diário.
// ===========================================================================

export const runtime = "nodejs";
// Builders + discovery + content + 1º disparo (15 WA c/ throttle + e-mails) — 60s era pouco.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) return new NextResponse("unauthorized", { status: 401 });

  // 0) estudo das conversas/mensagens de ontem → playbook usado pelos builders de hoje
  const learning = await promptLearning(req).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));
  // 1) descoberta (topo de funil) — precisa vir antes p/ os builders pegarem os novos leads
  const discovered = await discover(req).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));
  // 2) preparação de mensagens (não envia)
  const drafts = await leadFollowups(req).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));
  const worklist = await worklistBuild(req).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));
  const content = await contentPipeline(req).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));

  // 3) 1º disparo do dia (Diretor 31/07): este cron roda às 14:00 UTC = 11h BRT
  // e envia até WA_RUN_CAP mensagens aprovadas; o daily-pm (17h BRT) completa o dia.
  const sent = await outboxSend(req).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));

  return NextResponse.json({ ok: true, stage: "daily-am", learning, discovered, drafts, worklist, content, sent });
}
