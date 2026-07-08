import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { salesDb } from "@/lib/supabase";
import { createMessageWithFallback, SALES_MODEL } from "@/lib/anthropic";
import { BRAND, PRODUCT_INFO } from "@/lib/brand";
import { getLatestPlaybook, playbookBlock } from "@/lib/playbook";

// ===========================================================================
// Builder da WORKLIST manual. Para clínicas sem e-mail (enrichment_status=
// 'no_email'), o bot NÃO dispara nada: prepara um roteiro de LIGAÇÃO curto e,
// quando há Instagram, um texto de DM pronto. Vira item no outbox (channel
// 'call' / 'ig_dm', status 'draft') que aparece em /admin/worklist para o
// fundador EXECUTAR na mão. Guardrail do council: o humano conduz a conversa.
// ===========================================================================

export const runtime = "nodejs";
export const maxDuration = 60;

const BUILD_CAP = parseInt(process.env.WORKLIST_BUILD_CAP ?? "20", 10);

const SYSTEM = `Você prepara material para o FUNDADOR da ${BRAND.company} abordar PESSOALMENTE (ligação e DM) uma clínica veterinária que ainda não nos conhece, para oferecer uma apresentação remota gratuita do ${BRAND.product}, sem compromisso.

Gere DOIS textos curtos:
1. "call_script": roteiro de ligação de 20-30s que o fundador vai FALAR. Estrutura: cumprimento + quem somos em 1 frase + gancho do prontuário por voz (o MV fala, a IA escreve) + pedir para falar com o responsável e propor uma demo de 15 min sem compromisso. Tom humano, natural de fala (não de texto). Uma pergunta só ao final.
2. "dm_text": mensagem curta de Instagram DM (3-4 linhas), mesma proposta, tom leve, terminando com uma pergunta.

Terminologia CFMV: Tutor, Pet, Médico Veterinário/MV. Sem clichê, sem jargão de TI. Não invente dados da clínica.

Base de conhecimento:
${PRODUCT_INFO}

Responda SOMENTE com JSON válido, sem markdown:
{"call_script":"...","dm_text":"..."}`;

function extractText(msg: { content: Array<{ type: string; text?: string }> }): string {
  return msg.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) return new NextResponse("unauthorized", { status: 401 });

  const { data: leads, error } = await salesDb
    .from("leads")
    .select("id,name,company_name,city,uf,phone,instagram_handle")
    .eq("source", "places")
    .eq("enrichment_status", "no_email")
    .eq("opted_out", false)
    .not("phone", "is", null)
    .limit(BUILD_CAP * 3);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Diretrizes aprendidas das conversas reais (cron prompt-learning).
  const system = SYSTEM + playbookBlock(await getLatestPlaybook());

  // exclui quem já tem item de worklist (call/ig_dm) no outbox
  const ids = (leads ?? []).map((l) => l.id);
  const done = new Set<string>();
  if (ids.length) {
    const { data: ex } = await salesDb.from("outbox").select("lead_id").in("channel", ["call", "ig_dm"]).in("lead_id", ids);
    for (const r of ex ?? []) done.add(r.lead_id as string);
  }

  let built = 0;
  const errors: string[] = [];
  for (const lead of leads ?? []) {
    if (built >= BUILD_CAP) break;
    if (done.has(lead.id)) continue;

    const context = `Clínica: ${lead.company_name ?? lead.name ?? "(sem nome)"}
Cidade/UF: ${lead.city ?? "?"}/${lead.uf ?? "?"}
Telefone: ${lead.phone ?? "?"}
Instagram: ${lead.instagram_handle ? "@" + lead.instagram_handle : "(não tem)"}`;

    try {
      const msg = await createMessageWithFallback({
        model: SALES_MODEL,
        max_tokens: 700,
        temperature: 0.7,
        system,
        messages: [{ role: "user", content: `Prepare a abordagem para esta clínica:\n${context}` }],
      });
      const raw = extractText(msg);
      const json = raw.startsWith("{") ? raw : (raw.match(/\{[\s\S]*\}/)?.[0] ?? "");
      const parsed = json ? JSON.parse(json) : null;
      if (!parsed?.call_script) { errors.push(`${lead.id}: parse falhou`); continue; }

      const rows: Array<Record<string, unknown>> = [
        { lead_id: lead.id, channel: "call", body: parsed.call_script, status: "draft" },
      ];
      if (lead.instagram_handle && parsed.dm_text) {
        rows.push({ lead_id: lead.id, channel: "ig_dm", body: parsed.dm_text, status: "draft" });
      }
      const { error: insErr } = await salesDb.from("outbox").insert(rows);
      if (insErr) { errors.push(`${lead.id}: ${insErr.message}`); continue; }
      built++;
    } catch (e) {
      errors.push(`${lead.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({ ok: true, built, cap: BUILD_CAP, errors: errors.slice(0, 10) });
}
