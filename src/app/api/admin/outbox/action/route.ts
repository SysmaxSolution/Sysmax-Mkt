import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/lib/admin-auth";
import { isAuthorizedViewer } from "@/lib/viewer-auth";
import { salesDb } from "@/lib/supabase";

// Ação de aprovação sobre itens do outbox. Aceita edição de subject/body no ato
// da aprovação. approve => status 'approved' (fica elegível ao worker de envio,
// que ainda respeita o warm-up). reject => 'rejected'. done => item da worklist
// executado à mão.
// AUTORIZAÇÃO: 'approve' exige ADMIN_TOKEN (autoriza disparo). 'done'/'reject'
// aceitam o VIEWER_TOKEN — a equipe comercial trabalha a worklist sem poder
// aprovar envios automáticos.
export const runtime = "nodejs";

type Body = {
  ids?: string[];
  id?: string;
  action: "approve" | "reject" | "done";
  subject?: string;
  body?: string;
  approved_by?: string;
};

export async function POST(req: NextRequest) {
  const payload = (await req.json().catch(() => null)) as Body | null;
  const valid = payload && ["approve", "reject", "done"].includes(payload.action);
  if (!valid) return NextResponse.json({ ok: false, error: "payload inválido" }, { status: 400 });

  const authed = payload!.action === "approve" ? isAuthorizedAdmin(req) : isAuthorizedViewer(req);
  if (!authed) return new NextResponse("unauthorized", { status: 401 });
  const ids = payload!.ids ?? (payload!.id ? [payload!.id] : []);
  if (!ids.length) return NextResponse.json({ ok: false, error: "nenhum id" }, { status: 400 });

  if (payload!.action === "reject") {
    const { error } = await salesDb.from("outbox").update({ status: "rejected" }).in("id", ids);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, updated: ids.length });
  }

  // done — item da worklist executado à mão (ligação/DM). Marca 'sent' e
  // atualiza o último contato dos leads envolvidos.
  if (payload!.action === "done") {
    const { data: rows } = await salesDb.from("outbox").select("lead_id").in("id", ids);
    const { error } = await salesDb
      .from("outbox")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .in("id", ids);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    const leadIds = [...new Set((rows ?? []).map((r) => r.lead_id as string))];
    if (leadIds.length) {
      await salesDb.from("leads").update({ last_contact_at: new Date().toISOString() }).in("id", leadIds);
    }
    return NextResponse.json({ ok: true, updated: ids.length });
  }

  // approve — permite editar subject/body apenas quando 1 item (edição individual).
  const patch: Record<string, unknown> = {
    status: "approved",
    approved_at: new Date().toISOString(),
    approved_by: payload.approved_by ?? "fundador",
    scheduled_for: new Date().toISOString(),
  };
  if (ids.length === 1) {
    if (typeof payload.subject === "string") patch.subject = payload.subject;
    if (typeof payload.body === "string") patch.body = payload.body;
  }
  const { error } = await salesDb.from("outbox").update(patch).in("id", ids).eq("status", "draft");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, updated: ids.length });
}
