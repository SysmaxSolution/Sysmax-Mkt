import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedViewer } from "@/lib/viewer-auth";
import { salesDb } from "@/lib/supabase";
import { cleanEmail, cleanText } from "@/crm/lead-intake";
import { montarTelefone } from "@/lib/phone-intl";

// ===========================================================================
// POST /api/painel/lead — a equipe cadastra na hora uma clínica que ela mesma
// encontrou, sem depender da fila descoberta pelo Google Places. Nasceu do
// pedido da captação (2026-10-15): a prospecção dela é no exterior e o painel
// só servia contatos pré-existentes.
//
// Entra como source='manual'. Dedup por e-mail/telefone para não criar duas
// fichas da mesma clínica. Base legal igual à dos leads frios B2B.
// ===========================================================================

export const runtime = "nodejs";

const COUNTRY_RE = /^[A-Z]{2}$/;

export async function POST(req: NextRequest) {
  if (!isAuthorizedViewer(req)) return new NextResponse("unauthorized", { status: 401 });

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const clinic = cleanText(b?.clinic, 160);
  const city = cleanText(b?.city, 80) || null;
  const country = (cleanText(b?.country, 2) || "BR").toUpperCase();
  const email = cleanEmail(b?.email);
  const phoneRaw = cleanText(b?.phone, 40);
  const notes = cleanText(b?.notes, 2000) || null;
  const contact = cleanText(b?.contact, 120) || null;

  if (!clinic) return NextResponse.json({ ok: false, error: "Informe o nome da clínica." }, { status: 400 });
  if (!COUNTRY_RE.test(country)) {
    return NextResponse.json({ ok: false, error: "País inválido. Use a sigla de 2 letras: US, PT, AE, BR." }, { status: 400 });
  }
  let phone: string | null = null;
  if (phoneRaw) {
    const r = montarTelefone(phoneRaw, country);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.erro }, { status: 400 });
    phone = r.e164;
  }
  if (!email && !phone) {
    return NextResponse.json({ ok: false, error: "Informe pelo menos o e-mail ou o WhatsApp da clínica." }, { status: 400 });
  }

  // Dedup: mesma clínica já cadastrada não vira ficha nova.
  const ors: string[] = [];
  if (email) ors.push(`email.eq.${email}`);
  if (phone) ors.push(`phone.eq.${phone}`);
  const { data: dup } = await salesDb
    .from("leads")
    .select("id,company_name,stage,opted_out")
    .or(ors.join(","))
    .limit(1);
  if (dup?.length) {
    const d = dup[0];
    return NextResponse.json({
      ok: true,
      leadId: d.id,
      existing: true,
      optedOut: d.opted_out,
      message: d.opted_out
        ? `Essa clínica (${d.company_name}) já está cadastrada e pediu para não receber contato.`
        : `Essa clínica já estava cadastrada como "${d.company_name}". Usei a ficha que já existe.`,
    });
  }

  const { data, error } = await salesDb
    .from("leads")
    .insert({
      company_name: clinic,
      name: contact,
      city, country,
      email, phone,
      notes,
      stage: "new",
      source: "manual",
      legal_basis: "legitimo_interesse_b2b",
      consent_optin: false,
      discovered_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) {
    return NextResponse.json({ ok: false, error: "Não consegui salvar a clínica. Tente de novo." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, leadId: data.id, existing: false });
}
