import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { salesDb } from "@/lib/supabase";
import { createMessageWithFallback, SALES_MODEL } from "@/lib/anthropic";
import { isSuppressed } from "@/lib/suppression";
import { BRAND, PRODUCT_INFO } from "@/lib/brand";
import { getLatestPlaybook, playbookBlock } from "@/lib/playbook";

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

REGRAS (padrão definido pelo Diretor em 28/07 — o e-mail frio que um MV dono de clínica NÃO deletaria):
- Curto: 90-130 palavras. Tom humano, gentil, respeitoso. Sem jargão de TI, sem "revolucione/solução completa/próximo nível".
- Abra pelo nome da clínica. Nada de "prezados senhores".
- IDENTIDADE: nós somos a ${BRAND.company}, de ${BRAND.city} — SEMPRE. NUNCA diga ou insinue que somos da cidade da clínica ("somos de BH", "aqui de Campinas" é PROIBIDO). NUNCA se apresente como "fundador". Assine como Rafael, equipe comercial da ${BRAND.company} (${BRAND.city}).
- ESTRUTURA OBRIGATÓRIA: (1) quem somos + motivo do contato em 1-2 frases; (2) a pergunta-chave, com estas palavras ou próximas: "vocês estão 100% satisfeitos com o sistema que usam hoje para administrar a clínica — tanto pelo valor quanto pelo que ele entrega?"; (3) o convite: uma LIGAÇÃO de 15 minutos, sem compromisso, para ouvir a rotina de vocês — nosso trabalho começa ouvindo, não empurrando sistema; (4) perguntar quem é a melhor pessoa para essa conversa.
- NÃO liste funcionalidades, NÃO empurre demo do produto, NÃO mencione preço. No máximo 1 menção leve a um diferencial (ex.: prontuário por voz) se couber naturalmente.
- Terminologia CFMV: Tutor, Pet, Médico Veterinário/MV.
- Não invente dados da clínica que você não recebeu. Não prometa nada fora da base de conhecimento.

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

  // Diretrizes aprendidas das conversas reais (cron prompt-learning).
  const system = EMAIL_SYSTEM + playbookBlock(await getLatestPlaybook());

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
        system,
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
