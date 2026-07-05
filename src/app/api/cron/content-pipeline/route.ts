import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { salesDb } from "@/lib/supabase";
import { createMessageWithFallback, SALES_MODEL } from "@/lib/anthropic";
import { BRAND, PRODUCT_INFO } from "@/lib/brand";

// ===========================================================================
// Geração de conteúdo diário. Produz a copy de 1 post por dia (pilar rotativo)
// e grava em content_calendar como 'pending_approval' — o fundador revisa e
// publica (a publicação automática via Meta segue bloqueada por App Review).
// O criativo visual continua no pipeline local (marketing/output); aqui geramos
// a copy + sugestão de formato/asset. Nada é publicado automaticamente.
// ===========================================================================

export const runtime = "nodejs";
export const maxDuration = 60;

// Pilares rotativos (um por dia da semana) derivados dos diferenciais reais.
const PILLARS = [
  { key: "voz", angle: "Prontuário por voz + IA: o MV fala, a IA escreve. Ganho de tempo para MV solo." },
  { key: "whatsapp", angle: "WhatsApp inteligente: agente de IA conversa com o tutor e agenda sozinho." },
  { key: "financeiro", angle: "Caixa/PDV, recebíveis de cartão e NFS-e no checkout — financeiro sem retrabalho." },
  { key: "clinico", angle: "Fluxo clínico completo: recepção, triagem, internação e centro cirúrgico num só lugar." },
  { key: "conformidade", angle: "Conformidade CFMV: revisão do MV, Receituário Azul, carteira de vacinação oficial." },
  { key: "troca", angle: "Migração assistida em até 48h. Saia do sistema sem IA para o SYSVETMAX sem dor." },
  { key: "prova", angle: "Prova social: clínica real usando IA no dia a dia (case Almavet)." },
];

const SYSTEM = `Você é o redator de conteúdo do Instagram/Facebook da ${BRAND.company}, divulgando o ${BRAND.product} para donos de clínicas veterinárias e médicos veterinários.

REGRAS:
- Foco em UM pilar só (não misture diferenciais). Fale do resultado para a clínica, não da feature.
- Tom humano e específico, terminologia CFMV (Tutor, Pet, Médico Veterinário/MV). Sem clichê ("revolucione", "solução completa").
- Caption de 3-6 linhas + 1 CTA suave (teste grátis 30 dias, sem cartão) + 4-6 hashtags do nicho veterinário.
- No máximo 1-2 emojis.

Base de conhecimento:
${PRODUCT_INFO}

Responda SOMENTE com JSON válido, sem markdown:
{"format":"feed|carrossel|reel|story","caption":"...","hashtags":["#...","#..."],"asset_hint":"descrição curta do criativo sugerido"}`;

function extractText(msg: { content: Array<{ type: string; text?: string }> }): string {
  return msg.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) return new NextResponse("unauthorized", { status: 401 });

  const pillar = PILLARS[new Date().getUTCDay() % PILLARS.length];

  let parsed: { format?: string; caption?: string; hashtags?: string[]; asset_hint?: string } | null = null;
  try {
    const msg = await createMessageWithFallback({
      model: SALES_MODEL,
      max_tokens: 700,
      temperature: 0.8,
      system: SYSTEM,
      messages: [{ role: "user", content: `Gere o post de hoje sobre o pilar "${pillar.key}": ${pillar.angle}` }],
    });
    const raw = extractText(msg);
    const json = raw.startsWith("{") ? raw : (raw.match(/\{[\s\S]*\}/)?.[0] ?? "");
    parsed = json ? JSON.parse(json) : null;
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  if (!parsed?.caption) return NextResponse.json({ ok: false, error: "geração falhou" }, { status: 500 });

  const brief = `${parsed.caption}\n\n${(parsed.hashtags ?? []).join(" ")}\n\n[criativo sugerido] ${parsed.asset_hint ?? ""}`;
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString();

  const { data, error } = await salesDb
    .from("content_calendar")
    .insert({
      pillar: pillar.key,
      platform: "instagram",
      format: parsed.format ?? "feed",
      brief,
      scheduled_for: tomorrow,
      status: "pending_approval",
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data?.id, pillar: pillar.key });
}
