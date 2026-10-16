import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedViewer } from "@/lib/viewer-auth";
import { salesDb } from "@/lib/supabase";
import { startOfTodayUTC } from "@/lib/send-quota";

// ===========================================================================
// GET /api/painel/meu-dia — relatório do dia, montado do próprio rastro das
// ações (outbox + leads criados). Pedido da captação: substituir o resumo
// escrito à mão no WhatsApp e dar ao Diretor acompanhamento diário de quem
// trabalhou e o que foi feito.
// ===========================================================================

export const runtime = "nodejs";

const LABEL: Record<string, string> = {
  email: "E-mails enviados",
  whatsapp: "WhatsApp",
  call: "Ligações",
  ig_dm: "Instagram DM",
  wa_call: "WhatsApp ligação",
};

export async function GET(req: NextRequest) {
  if (!isAuthorizedViewer(req)) return new NextResponse("unauthorized", { status: 401 });

  const since = startOfTodayUTC();
  const { data: sent } = await salesDb
    .from("outbox")
    .select("channel,approved_by,sent_at,lead:leads(company_name,city,country)")
    .eq("status", "sent")
    .gte("sent_at", since)
    .order("sent_at", { ascending: false })
    .limit(500);

  const { data: novos } = await salesDb
    .from("leads")
    .select("company_name,city,country,email,phone")
    .eq("source", "manual")
    .gte("discovered_at", since)
    .order("discovered_at", { ascending: false })
    .limit(200);

  const rows = (sent ?? []) as unknown as Array<{
    channel: string; approved_by: string | null; sent_at: string;
    lead: { company_name: string | null; city: string | null; country: string | null } | null;
  }>;

  const porCanal: Record<string, number> = {};
  const porPessoa: Record<string, number> = {};
  for (const r of rows) {
    porCanal[r.channel] = (porCanal[r.channel] ?? 0) + 1;
    const quem = r.approved_by ?? "não identificado";
    porPessoa[quem] = (porPessoa[quem] ?? 0) + 1;
  }

  return NextResponse.json({
    ok: true,
    resumo: Object.entries(porCanal).map(([ch, n]) => ({ canal: LABEL[ch] ?? ch, total: n })),
    porPessoa: Object.entries(porPessoa).map(([quem, n]) => ({ quem, total: n })),
    clinicasNovas: (novos ?? []).length,
    novas: novos ?? [],
    acoes: rows.map((r) => ({
      canal: LABEL[r.channel] ?? r.channel,
      clinica: r.lead?.company_name ?? "(sem nome)",
      onde: [r.lead?.city, r.lead?.country].filter(Boolean).join(" · "),
      quando: r.sent_at,
      quem: r.approved_by,
    })),
  });
}
