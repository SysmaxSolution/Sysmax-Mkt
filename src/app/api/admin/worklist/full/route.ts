import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedViewer } from "@/lib/viewer-auth";
import { salesDb } from "@/lib/supabase";

// ===========================================================================
// Painel comercial consolidado (/painel). Retorna TODA a fila draft/approved
// agrupada por clínica, já com o CANAL RECOMENDADO por heurística de alcance
// B2B. Protegido por VIEWER_TOKEN (ou ADMIN_TOKEN). Somente leitura.
// ===========================================================================
export const runtime = "nodejs";
export const maxDuration = 30;

// e-mail pessoal/inválido não serve como canal frio corporativo
const badEmail = /(yahoo|gmail|hotmail|outlook|exemplo|example|seuemail|mysite|gserviceaccount|wixsite|godaddy|no-?reply)/i;
// handle de IG quebrado (recurso do Facebook, path de post, etc.)
const badIg = /\.php|^(p|reel|reels|explore|accounts|stories)$/i;

const CH_LABEL: Record<string, string> = { email: "E-mail", whatsapp: "WhatsApp", call: "Ligação", ig_dm: "Instagram DM" };

type Lead = {
  id: string; name: string | null; company_name: string | null; city: string | null; uf: string | null;
  phone: string | null; email: string | null; instagram_handle: string | null; website: string | null;
  enrichment_status: string | null; stage: string | null;
};
type Ob = { id: string; lead_id: string; channel: string; subject: string | null; body: string; status: string };

export async function GET(req: NextRequest) {
  if (!isAuthorizedViewer(req)) return new NextResponse("unauthorized", { status: 401 });

  const [{ data: leads, error: le }, { data: outbox, error: oe }] = await Promise.all([
    salesDb.from("leads").select("id,name,company_name,city,uf,phone,email,instagram_handle,website,enrichment_status,stage").eq("source", "places"),
    salesDb.from("outbox").select("id,lead_id,channel,subject,body,status").in("status", ["draft", "approved"]).order("created_at", { ascending: false }).limit(2000),
  ]);
  if (le || oe) return NextResponse.json({ ok: false, error: (le ?? oe)?.message }, { status: 500 });

  const leadById = new Map<string, Lead>((leads ?? []).map((l) => [l.id, l as Lead]));
  const byLead = new Map<string, Ob[]>();
  for (const o of (outbox ?? []) as Ob[]) {
    const arr = byLead.get(o.lead_id) ?? [];
    arr.push(o);
    byLead.set(o.lead_id, arr);
  }

  const rows = [];
  for (const [leadId, items] of byLead) {
    const l = leadById.get(leadId);
    if (!l) continue;
    const chans = new Set(items.map((i) => i.channel));
    const hasIg = !!l.instagram_handle && !badIg.test(l.instagram_handle);
    const goodEmail = !!l.email && !badEmail.test(l.email);

    let rec: string, reason: string;
    if (chans.has("email") && goodEmail) {
      rec = "email"; reason = "E-mail corporativo válido — canal frio automatizável.";
    } else if (chans.has("email") && l.email) {
      rec = "whatsapp_manual"; reason = `E-mail é pessoal (${l.email}) — melhor abordar por WhatsApp/telefone.`;
    } else if (hasIg && chans.has("ig_dm")) {
      rec = "ig_dm"; reason = "Sem e-mail, mas ativa no Instagram — DM tem alta taxa de leitura.";
    } else if (chans.has("call")) {
      rec = "call"; reason = "Sem e-mail e sem Instagram — ligação/WhatsApp no telefone é o caminho.";
    } else if (chans.has("ig_dm")) {
      rec = "call"; reason = "Handle do Instagram inválido — abordar por telefone/WhatsApp.";
    } else {
      rec = [...chans][0] ?? "call"; reason = "Único canal disponível.";
    }

    let ig = hasIg ? l.instagram_handle : null;
    if (!ig && l.website) {
      const m = l.website.match(/instagram\.com\/([a-z0-9._]{2,30})/i);
      if (m && !badIg.test(m[1])) ig = m[1];
    }

    rows.push({
      leadId: l.id,
      stage: l.stage ?? "new",
      clinic: l.company_name ?? l.name ?? "(sem nome)",
      city: l.city, uf: l.uf,
      phone: l.phone ?? null,
      email: goodEmail ? l.email : null,
      instagram: ig,
      website: l.website ?? null,
      recommended: rec,
      recommendedReason: reason,
      messages: items.map((i) => ({ id: i.id, channel: i.channel, channelLabel: CH_LABEL[i.channel] ?? i.channel, subject: i.subject ?? null, body: i.body, status: i.status })),
    });
  }

  const recKey = (r: string) => (r === "whatsapp_manual" ? "wa" : r === "ig_dm" ? "ig" : r);
  const orderRank: Record<string, number> = { email: 0, ig_dm: 1, whatsapp_manual: 2, call: 3 };
  rows.sort((a, b) => (orderRank[a.recommended] ?? 9) - (orderRank[b.recommended] ?? 9) || (a.city ?? "").localeCompare(b.city ?? ""));

  const counts = { email: 0, ig: 0, wa: 0, call: 0 } as Record<string, number>;
  for (const r of rows) counts[recKey(r.recommended)]++;

  return NextResponse.json({ ok: true, total: rows.length, counts, rows });
}
