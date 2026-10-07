import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedViewer } from "@/lib/viewer-auth";
import { salesDb } from "@/lib/supabase";

// ===========================================================================
// GET /api/painel/site-leads — aba "Leads do site" do /painel. Quem levantou a
// mão no site (formulário, botão de WhatsApp) ou criou conta Free no app, do
// mais recente ao mais antigo, com os números de resumo. Somente leitura.
// Protegido por VIEWER_TOKEN (ou ADMIN_TOKEN).
// ===========================================================================
export const runtime = "nodejs";
export const maxDuration = 30;

const SOURCES = ["site", "cadastro_free"];
const DAY = 86_400_000;
const BRT_OFFSET = 3 * 3_600_000; // Brasil sem horário de verão desde 2019

function brtDay(ms: number): string {
  return new Date(ms - BRT_OFFSET).toISOString().slice(0, 10);
}

type Slim = { source: string; source_ref: string | null; stage: string; created_at: string };

export async function GET(req: NextRequest) {
  if (!isAuthorizedViewer(req)) return new NextResponse("unauthorized", { status: 401 });

  const [list, slim] = await Promise.all([
    salesDb
      .from("leads")
      .select("id,name,company_name,city,uf,phone,email,source,source_ref,stage,notes,created_at,signup_at,consent_at,last_contact_at")
      .in("source", SOURCES)
      .order("created_at", { ascending: false })
      .limit(300),
    salesDb
      .from("leads")
      .select("source,source_ref,stage,created_at")
      .in("source", SOURCES)
      .order("created_at", { ascending: false })
      .limit(5000),
  ]);
  if (list.error || slim.error) {
    return NextResponse.json({ ok: false, error: (list.error ?? slim.error)?.message }, { status: 500 });
  }

  const all = (slim.data ?? []) as Slim[];
  const now = Date.now();
  const bySource: Record<string, number> = {};
  const byStage: Record<string, number> = {};
  const byRefMap = new Map<string, number>();
  let last7 = 0, last30 = 0;
  const dailyMap = new Map<string, number>();
  for (let k = 13; k >= 0; k--) dailyMap.set(brtDay(now - k * DAY), 0);

  for (const l of all) {
    bySource[l.source] = (bySource[l.source] ?? 0) + 1;
    byStage[l.stage] = (byStage[l.stage] ?? 0) + 1;
    if (l.source_ref) byRefMap.set(l.source_ref, (byRefMap.get(l.source_ref) ?? 0) + 1);
    const t = Date.parse(l.created_at);
    if (now - t <= 7 * DAY) last7++;
    if (now - t <= 30 * DAY) last30++;
    const d = brtDay(t);
    if (dailyMap.has(d)) dailyMap.set(d, (dailyMap.get(d) ?? 0) + 1);
  }

  const byRef = [...byRefMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([ref, n]) => ({ ref, n }));
  const daily = [...dailyMap.entries()].map(([date, n]) => ({ date, n }));

  const rows = (list.data ?? []).map((l) => ({
    leadId: l.id as string,
    name: l.name as string | null,
    clinic: (l.company_name as string | null) ?? null,
    city: l.city as string | null,
    uf: l.uf as string | null,
    phone: l.phone as string | null,
    email: l.email as string | null,
    source: l.source as string,
    ref: l.source_ref as string | null,
    stage: l.stage as string,
    notes: l.notes as string | null,
    createdAt: l.created_at as string,
    signupAt: l.signup_at as string | null,
    consentAt: l.consent_at as string | null,
    lastContactAt: l.last_contact_at as string | null,
  }));

  return NextResponse.json({
    ok: true,
    rows,
    stats: { total: all.length, last7, last30, bySource, byStage, byRef, daily },
  });
}
