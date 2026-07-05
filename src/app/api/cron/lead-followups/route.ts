import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { salesDb } from "@/lib/supabase";
import { createMessageWithFallback, SALES_MODEL } from "@/lib/anthropic";
import { isSuppressed } from "@/lib/suppression";
import { BRAND, PRODUCT_INFO } from "@/lib/brand";

// ===========================================================================
// Builder do outbound frio (e-mail). NÃO ENVIA — apenas prepara rascunhos
// personalizados na fila `outbox` (status='draft'), que o fundador revisa e
// aprova em /admin/outbox. O envio real é feito pelo worker /api/cron/outbox-send
// respeitando o warm-up. Guardrail do council: humano aprova todo disparo.
// ===========================================================================

export const runtime = "nodejs";
export const maxDuration = 60;

const BUILD_CAP = parseInt(process.env.OUTBOX_BUILD_CAP ?? "30", 10);

const EMAIL_SYSTEM = `Você escreve o PRIMEIRO e-mail de prospecção B2B da ${BRAND.company} para uma clínica veterinária que ainda não nos conhece. Objetivo do e-mail: conseguir uma conversa e oferecer uma apresentação remota gratuita do ${BRAND.product}, sem compromisso.

REGRAS (o e-mail frio que um MV dono de clínica NÃO deletaria):
- Curto: 90-130 palavras. Tom humano, direto, respeitoso. Sem jargão de TI, sem "revolucione/solução completa/próximo nível".
- Abra reconhecendo a clínica pelo nome e cidade (contexto local). Nada de "prezados senhores".
- Fisgue com o diferencial real: prontuário por voz + IA (o MV fala, a IA escreve) — nenhum concorrente brasileiro tem.
- UM único pedido claro: perguntar quem é o responsável / se topa uma demonstração remota de 15 min, sem compromisso. Não empurre preço no primeiro e-mail.
- Terminologia CFMV: Tutor, Pet, Médico Veterinário/MV. Assine como equipe comercial da ${BRAND.company}.
- Não invente dados da clínica que você não recebeu. Não prometa nada que não esteja na base de conhecimento.

Base de conhecimento do produto:
${PRODUCT_INFO}

Responda SOMENTE com um JSON válido, sem markdown, no formato:
{"subject":"...", "body":"..."}
O subject deve ter no máximo 60 caracteres, ser específico e não parecer spam (evite CAPS, "!!!", "grátis" no assunto).`;

function extractText(msg: { content: Array<{ type: string; text?: string }> }): string {
  return msg.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
}

function parseDraft(raw: string): { subject: string; body: string } | null {
  const jsonStr = raw.startsWith("{") ? raw : (raw.match(/\{[\s\S]*\}/)?.[0] ?? "");
  if (!jsonStr) return null;
  try {
    const obj = JSON.parse(jsonStr);
    if (typeof obj.subject === "string" && typeof obj.body === "string") {
      return { subject: obj.subject.slice(0, 120), body: obj.body };
    }
  } catch {
    /* json inválido */
  }
  return null;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) return new NextResponse("unauthorized", { status: 401 });

  // 1) candidatos: prospects com e-mail, ainda não contatados, não opt-out.
  const { data: leads, error } = await salesDb
    .from("leads")
    .select("id,name,company_name,email,city,uf,website,current_software")
    .eq("source", "places")
    .eq("enrichment_status", "enriched")
    .eq("opted_out", false)
    .eq("stage", "new")
    .not("email", "is", null)
    .limit(BUILD_CAP * 3);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // 2) excluir leads que já têm e-mail no outbox (qualquer status).
  const ids = (leads ?? []).map((l) => l.id);
  const alreadyQueued = new Set<string>();
  if (ids.length) {
    const { data: existing } = await salesDb
      .from("outbox")
      .select("lead_id")
      .eq("channel", "email")
      .in("lead_id", ids);
    for (const r of existing ?? []) alreadyQueued.add(r.lead_id as string);
  }

  let built = 0;
  const errors: string[] = [];
  for (const lead of leads ?? []) {
    if (built >= BUILD_CAP) break;
    if (alreadyQueued.has(lead.id)) continue;
    if (!lead.email) continue;
    if (await isSuppressed("email", lead.email)) continue;

    const context = `Clínica: ${lead.company_name ?? lead.name ?? "(sem nome)"}
Cidade/UF: ${lead.city ?? "?"}/${lead.uf ?? "?"}
Site: ${lead.website ?? "(desconhecido)"}
Sistema atual conhecido: ${lead.current_software ?? "(desconhecido)"}`;

    try {
      const msg = await createMessageWithFallback({
        model: SALES_MODEL,
        max_tokens: 700,
        temperature: 0.7,
        system: EMAIL_SYSTEM,
        messages: [{ role: "user", content: `Escreva o e-mail para esta clínica:\n${context}` }],
      });
      const draft = parseDraft(extractText(msg));
      if (!draft) { errors.push(`${lead.id}: parse falhou`); continue; }

      const { error: insErr } = await salesDb.from("outbox").insert({
        lead_id: lead.id,
        channel: "email",
        subject: draft.subject,
        body: draft.body,
        status: "draft",
      });
      if (insErr) { errors.push(`${lead.id}: ${insErr.message}`); continue; }
      built++;
    } catch (e) {
      errors.push(`${lead.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({ ok: true, built, cap: BUILD_CAP, errors: errors.slice(0, 10) });
}
