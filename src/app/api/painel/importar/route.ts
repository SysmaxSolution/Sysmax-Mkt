import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedViewer } from "@/lib/viewer-auth";
import { salesDb } from "@/lib/supabase";
import { parseLeadList, type ParsedLead } from "@/lib/parse-leads";
import { cleanEmail, cleanText } from "@/crm/lead-intake";
import { montarTelefone } from "@/lib/phone-intl";

// ===========================================================================
// POST /api/painel/importar — a equipe cola a lista que extraiu com a IA dela
// e o portal transforma em clínicas no CRM.
//
// Dois passos, de propósito: primeiro devolve a PRÉVIA do que entendeu (com
// avisos e duplicatas marcadas) e só grava quando ela confirma os itens. Nunca
// importa às cegas — interpretar texto livre erra, e errar aqui significa
// mandar e-mail para o endereço errado.
// ===========================================================================

export const runtime = "nodejs";
export const maxDuration = 60;

const LIMITE = 200;

type Item = {
  clinic: string; contact: string | null; city: string | null;
  country: string; email: string | null; phone: string | null;
  subject?: string | null; emailBody?: string | null;
  uf?: string | null; nota?: string | null;
};

function normalizaFone(raw: string | null, country: string): string | null {
  if (!raw) return null;
  const r = montarTelefone(raw, country);
  return r.ok ? r.e164 : null;
}

// Marca o que já existe no CRM, para a prévia avisar antes de duplicar.
async function marcarExistentes(itens: ParsedLead[] | Item[]): Promise<Set<string>> {
  const emails = itens.map((i) => i.email).filter((e): e is string => !!e);
  const fones = itens.map((i) => i.phone).filter((p): p is string => !!p);
  const achados = new Set<string>();
  if (emails.length) {
    const { data } = await salesDb.from("leads").select("email").in("email", emails.slice(0, LIMITE));
    for (const r of data ?? []) if (r.email) achados.add(`e:${String(r.email).toLowerCase()}`);
  }
  if (fones.length) {
    const { data } = await salesDb.from("leads").select("phone").in("phone", fones.slice(0, LIMITE));
    for (const r of data ?? []) if (r.phone) achados.add(`p:${r.phone}`);
  }
  return achados;
}

function jaExiste(set: Set<string>, email: string | null, phone: string | null): boolean {
  return (!!email && set.has(`e:${email.toLowerCase()}`)) || (!!phone && set.has(`p:${phone}`));
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedViewer(req)) return new NextResponse("unauthorized", { status: 401 });

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const confirmar = b?.confirmar === true;
  const paisPadrao = (cleanText(b?.paisPadrao, 2) || "US").toUpperCase();

  // --- Passo 1: prévia ------------------------------------------------------
  if (!confirmar) {
    const texto = typeof b?.texto === "string" ? b.texto : "";
    if (!texto.trim()) {
      return NextResponse.json({ ok: false, error: "Cole a lista no campo acima." }, { status: 400 });
    }
    if (texto.length > 200_000) {
      return NextResponse.json({ ok: false, error: "A lista é grande demais. Divida em partes." }, { status: 413 });
    }
    const lidos = parseLeadList(texto, paisPadrao);
    if (!lidos.length) {
      return NextResponse.json({
        ok: false,
        error: 'Não encontrei nenhuma clínica nesse texto. O formato esperado tem uma linha "Nome da clínica:" para cada uma.',
      }, { status: 422 });
    }
    const cortados = lidos.length > LIMITE ? lidos.length - LIMITE : 0;
    const usar = lidos.slice(0, LIMITE).map((l) => ({ ...l, phone: normalizaFone(l.phone, l.country) }));
    const existentes = await marcarExistentes(usar);

    return NextResponse.json({
      ok: true,
      total: usar.length,
      cortados,
      itens: usar.map((l) => ({
        clinic: l.clinic, contact: l.contact, city: l.city, country: l.country,
        email: l.email, phone: l.phone,
        subject: l.subject, emailBody: l.emailBody,
        uf: l.uf, nota: l.nota,
        warnings: l.warnings,
        existing: jaExiste(existentes, l.email, l.phone),
      })),
    });
  }

  // --- Passo 2: gravar o que ela confirmou ----------------------------------
  const brutos = Array.isArray(b?.itens) ? (b.itens as unknown[]) : [];
  if (!brutos.length) return NextResponse.json({ ok: false, error: "Nenhuma clínica selecionada." }, { status: 400 });
  if (brutos.length > LIMITE) return NextResponse.json({ ok: false, error: `Importe no máximo ${LIMITE} por vez.` }, { status: 413 });

  const itens: Item[] = [];
  for (const r of brutos) {
    const o = r as Record<string, unknown>;
    const clinic = cleanText(o.clinic, 160);
    if (!clinic) continue;
    const country = (cleanText(o.country, 2) || paisPadrao).toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) continue;
    const email = cleanEmail(o.email);
    const phone = normalizaFone(cleanText(o.phone, 40) || null, country);
    if (!email && !phone) continue; // sem forma de contato não serve
    itens.push({
      clinic,
      contact: cleanText(o.contact, 120) || null,
      city: cleanText(o.city, 80) || null,
      country, email, phone,
      subject: cleanText(o.subject, 200) || null,
      emailBody: typeof o.emailBody === "string" ? o.emailBody.slice(0, 20_000) : null,
    });
  }
  if (!itens.length) {
    return NextResponse.json({ ok: false, error: "Nenhuma das clínicas tem e-mail ou telefone válido." }, { status: 422 });
  }

  const existentes = await marcarExistentes(itens);
  const agora = new Date().toISOString();
  const novos: Record<string, unknown>[] = [];
  const comTexto: Item[] = []; // mesma ordem de `novos`, p/ casar com os ids
  const vistos = new Set<string>();
  let pulados = 0;

  for (const i of itens) {
    const chave = `${i.email ?? ""}|${i.phone ?? ""}`;
    if (vistos.has(chave) || jaExiste(existentes, i.email, i.phone)) { pulados++; continue; }
    vistos.add(chave);
    comTexto.push(i);
    novos.push({
      company_name: i.clinic,
      name: i.contact,
      city: i.city,
      country: i.country,
      email: i.email,
      phone: i.phone,
      uf: i.uf ?? null,
      stage: "new",
      source: "manual",
      legal_basis: "legitimo_interesse_b2b",
      consent_optin: false,
      discovered_at: agora,
      notes: i.nota ? `Importada da lista da equipe. ${i.nota}` : "Importada da lista extraída pela equipe comercial.",
    });
  }

  if (!novos.length) {
    return NextResponse.json({ ok: true, criados: 0, pulados, message: "Todas já estavam cadastradas." });
  }

  const { data, error } = await salesDb.from("leads").insert(novos).select("id,email");
  if (error) {
    return NextResponse.json({ ok: false, error: "Não consegui gravar as clínicas. Tente de novo." }, { status: 500 });
  }

  // A IA da equipe já entrega o e-mail redigido por clínica. Guardamos como
  // rascunho para o cartão abrir com o texto pronto — ela confere e envia, sem
  // copiar e colar. Rascunho não dispara nada sozinho: o worker só toca
  // 'approved', e o envio pelo painel é sempre um clique dela.
  //
  // O casamento é pelo e-mail, NUNCA pela ordem do retorno do insert: ordem não
  // é garantida e trocar os pares colaria o texto de uma clínica na ficha de
  // outra — ou seja, mandar a mensagem errada para o destinatário errado.
  const criados = data ?? [];
  const textoPorEmail = new Map<string, Item>();
  for (const i of comTexto) if (i.email) textoPorEmail.set(i.email.toLowerCase(), i);

  const rascunhos = criados
    .map((row) => ({ row, item: row.email ? textoPorEmail.get(String(row.email).toLowerCase()) : undefined }))
    .filter((p): p is { row: { id: string; email: string }; item: Item } => !!p.item && !!(p.item.subject || p.item.emailBody))
    .map(({ row, item }) => ({
      lead_id: row.id,
      channel: "email",
      subject: item.subject ?? "",
      body: item.emailBody ?? "",
      status: "draft",
      scheduled_for: new Date().toISOString(),
    }));
  if (rascunhos.length) await salesDb.from("outbox").insert(rascunhos);

  return NextResponse.json({ ok: true, criados: criados.length, pulados, rascunhos: rascunhos.length });
}
