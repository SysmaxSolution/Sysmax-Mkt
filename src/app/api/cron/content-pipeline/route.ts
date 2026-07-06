import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { salesDb } from "@/lib/supabase";
import { createMessageWithFallback, SALES_MODEL } from "@/lib/anthropic";
import { BRAND, PRODUCT_INFO } from "@/lib/brand";

// ===========================================================================
// Geração de conteúdo diário EM LOTE para a aba de Posts do painel: 5 posts +
// 2 vídeos (roteiro) + 1 anúncio para impulsionar. Uma chamada ao modelo
// retorna o lote inteiro; cada item vira uma linha em content_calendar
// (status 'pending_approval'), com o conteúdo estruturado em JSON no campo brief.
// A equipe de marketing baixa a imagem/roteiro e publica manualmente (IG, status
// do WhatsApp, Facebook). Nada é publicado automaticamente.
// ===========================================================================

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `Você é o redator de conteúdo de redes sociais da ${BRAND.company}, divulgando o ${BRAND.product} para donos de clínicas veterinárias e médicos veterinários no Instagram, status do WhatsApp e Facebook.

Gere o LOTE de conteúdo de HOJE: 5 posts + 2 vídeos + 1 anúncio para impulsionar.

REGRAS GERAIS:
- Cada peça foca em UM ângulo (não misture diferenciais). Fale do resultado para a clínica, não da feature.
- Tom humano e específico. Terminologia CFMV: Tutor, Pet, Médico Veterinário/MV. Sem clichê ("revolucione", "solução completa", "próximo nível"). No máximo 1-2 emojis.
- Varie os ângulos entre as peças: prontuário por voz+IA, WhatsApp inteligente, financeiro/caixa/NFS-e, fluxo clínico (internação/cirurgia), conformidade CFMV, migração assistida 48h, prova social (case Almavet, clínica real usando IA).
- Destaque a PROMOÇÃO quando fizer sentido (não em todas): Plano Starter de R$189 por R$149,90/mês, com prontuário por voz IA, WhatsApp IA e caixa. Teste grátis 30 dias, sem cartão.

PARA CADA POST (5): headline curta (até 60 caracteres, para aparecer na arte), caption de 3-6 linhas para o texto da publicação, 4-6 hashtags do nicho veterinário, e o formato ("feed", "carrossel" ou "story"). Varie os formatos.
PARA CADA VÍDEO (2): roteiro de reel de 20-40s — gancho de abertura forte, 2-4 cenas curtas descritas, CTA final, e sugestão de áudio/trilha. Também uma caption curta e hashtags.
PARA O ANÚNCIO (1): headline de venda, texto do anúncio (2-4 linhas), público-alvo sugerido para impulsionar, e uma sugestão de verba/dia.

Base de conhecimento:
${PRODUCT_INFO}

Responda SOMENTE com JSON válido, sem markdown, no formato EXATO:
{
  "posts": [ {"format":"feed|carrossel|story","headline":"...","caption":"...","hashtags":["#...","#..."]} ],
  "videos": [ {"headline":"...","hook":"...","scenes":["...","..."],"cta":"...","audio":"...","caption":"...","hashtags":["#..."]} ],
  "ad": {"headline":"...","caption":"...","target":"...","budget":"...","hashtags":["#..."]}
}
Exatamente 5 posts e 2 videos.`;

type Post = { format?: string; headline?: string; caption?: string; hashtags?: string[] };
type Video = { headline?: string; hook?: string; scenes?: string[]; cta?: string; audio?: string; caption?: string; hashtags?: string[] };
type Ad = { headline?: string; caption?: string; target?: string; budget?: string; hashtags?: string[] };
type Batch = { posts?: Post[]; videos?: Video[]; ad?: Ad };

function extractText(msg: { content: Array<{ type: string; text?: string }> }): string {
  return msg.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) return new NextResponse("unauthorized", { status: 401 });

  let batch: Batch | null = null;
  try {
    const msg = await createMessageWithFallback({
      model: SALES_MODEL,
      max_tokens: 3200,
      temperature: 0.85,
      system: SYSTEM,
      messages: [{ role: "user", content: "Gere o lote de conteúdo de hoje (5 posts + 2 vídeos + 1 anúncio)." }],
    });
    const raw = extractText(msg);
    const json = raw.startsWith("{") ? raw : (raw.match(/\{[\s\S]*\}/)?.[0] ?? "");
    batch = json ? (JSON.parse(json) as Batch) : null;
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  if (!batch?.posts?.length) return NextResponse.json({ ok: false, error: "geração falhou" }, { status: 500 });

  const today = new Date().toISOString().slice(0, 10);
  const rows: Array<Record<string, unknown>> = [];
  for (const p of (batch.posts ?? []).slice(0, 5)) {
    rows.push({ pillar: "post", platform: "instagram", format: p.format ?? "feed", brief: JSON.stringify(p), scheduled_for: today, status: "pending_approval" });
  }
  for (const v of (batch.videos ?? []).slice(0, 2)) {
    rows.push({ pillar: "video", platform: "instagram", format: "reel", brief: JSON.stringify(v), scheduled_for: today, status: "pending_approval" });
  }
  if (batch.ad) {
    rows.push({ pillar: "ad", platform: "instagram", format: "ad", brief: JSON.stringify(batch.ad), scheduled_for: today, status: "pending_approval" });
  }

  // evita duplicar o lote do dia se o cron rodar de novo
  const { data: existing } = await salesDb
    .from("content_calendar")
    .select("id")
    .eq("scheduled_for", today)
    .in("pillar", ["post", "video", "ad"])
    .limit(1);
  if (existing?.length) {
    return NextResponse.json({ ok: true, skipped: "lote de hoje já existe", date: today });
  }

  const { error } = await salesDb.from("content_calendar").insert(rows);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, date: today, posts: batch.posts?.length ?? 0, videos: batch.videos?.length ?? 0, ad: !!batch.ad });
}
