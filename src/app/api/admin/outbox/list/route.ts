import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/lib/admin-auth";
import { salesDb } from "@/lib/supabase";

// Lista a fila de disparo pendente de decisão do fundador (drafts + aprovados
// ainda não enviados), com o contexto do lead. Protegido por x-admin-token.
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAuthorizedAdmin(req)) return new NextResponse("unauthorized", { status: 401 });

  // kind=auto -> disparos automáticos (email/whatsapp) da tela /admin/outbox
  // kind=manual -> worklist humana (call/ig_dm) da tela /admin/worklist
  const kind = new URL(req.url).searchParams.get("kind") === "manual" ? "manual" : "auto";
  const channels = kind === "manual" ? ["call", "ig_dm"] : ["email", "whatsapp"];

  const { data, error } = await salesDb
    .from("outbox")
    .select("id,channel,subject,body,status,created_at,scheduled_for,lead:leads(company_name,name,city,uf,email,phone,instagram_handle)")
    .in("status", ["draft", "approved"])
    .in("channel", channels)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, items: data ?? [] });
}
