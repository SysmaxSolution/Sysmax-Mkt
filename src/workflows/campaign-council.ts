// ===========================================================================
// Workflow: Conselho de Marketing SYSVETMAX
// Uso: Workflow({ scriptPath: "src/workflows/campaign-council.ts", args: brief })
// args: { type: "post"|"reel"|"story"|"ad"|"copy", brief: string, channel: string }
// Retorna: { approved: boolean, content: string, councilNotes: string }
// ===========================================================================

export const meta = {
  name: "campaign-council",
  description: "Gera e aprova conteúdo de marketing B2B veterinário via conselho LLM triplo",
  phases: [
    { title: "Geração", detail: "3 variantes de conteúdo em paralelo" },
    { title: "Conselho", detail: "Triagem criativa, eficácia e voz da marca" },
    { title: "Síntese", detail: "Presidente consolida e aprova ou reprovoa" },
  ],
};

const BRAND_CONTEXT = `
Empresa: Sysmax Software
Produto: SYSVETMAX
Posicionamento: Primeiro sistema veterinário com IA de verdade do Brasil.
Tagline: "Você atende; o SYSVETMAX escreve, agenda, cobra e concilia."
Público-alvo: MVs solos, donos de clínicas veterinárias e hospitais veterinários — Brasil.
Tom: direto, confiante, sem clichê, linguagem profissional mas acessível.
Proibido: "revolucione", "solução completa", "próximo nível", "inovador", "disruptivo".
Terminologia CFMV: Tutor (não dono), Pet/Animal (não paciente), MV (não médico).
Planos: Starter R$189/mês | Premium R$359,90/mês | Enterprise R$1.299/mês.
Diferenciais únicos: prontuário por voz IA, WhatsApp IA para tutores, conciliação Petlove, NFS-e no checkout.
Concorrentes: SimplesVet (~R$400/mês), VetDashboard — SYSVETMAX tem IA real, eles não.
`;

const CONTENT_SCHEMA = {
  type: "object",
  properties: {
    content: { type: "string", description: "Conteúdo pronto para publicar" },
    hook: { type: "string", description: "Primeira linha ou frase de gancho" },
    cta: { type: "string", description: "Call to action no final" },
    rationale: { type: "string", description: "Por que esta abordagem vai funcionar" },
  },
  required: ["content", "hook", "cta", "rationale"],
};

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "number", description: "Nota de 0 a 10" },
    approved: { type: "boolean" },
    strengths: { type: "array", items: { type: "string" } },
    weaknesses: { type: "array", items: { type: "string" } },
    suggestion: { type: "string", description: "Sugestão específica de melhoria" },
  },
  required: ["score", "approved", "strengths", "weaknesses", "suggestion"],
};

const SYNTHESIS_SCHEMA = {
  type: "object",
  properties: {
    approved: { type: "boolean" },
    final_content: { type: "string", description: "Conteúdo final aprovado ou melhorado pelo presidente" },
    council_notes: { type: "string", description: "Resumo das deliberações e mudanças feitas" },
    publish_ready: { type: "boolean", description: "true = pode publicar sem revisão humana adicional" },
  },
  required: ["approved", "final_content", "council_notes", "publish_ready"],
};

// ─── Geração ────────────────────────────────────────────────────────────────
phase("Geração");

const brief = args as { type: string; brief: string; channel: string };
const contentType = brief?.type ?? "post";
const channel = brief?.channel ?? "Instagram";
const briefText = brief?.brief ?? "Campanha geral de aquisição de leads veterinários";

const APPROACHES = [
  { label: "dor-direto", angle: "Aborde a maior dor operacional do MV (tempo perdido em prontuário) e mostre o ganho quantificado em minutos/dia." },
  { label: "roi-financeiro", angle: "Mostre o ROI financeiro: quanto o MV paga hoje vs o que pagaria com SYSVETMAX, e o que ganha além da economia." },
  { label: "prova-social", angle: "Use linguagem de prova social e escassez: clínicas que adotaram estão 40% mais baratas que a concorrência. Convide para teste gratuito." },
];

const variants = await parallel(
  APPROACHES.map((approach) => () =>
    agent(
      `Você é um especialista em marketing B2B para SaaS veterinário.
Crie um ${contentType} para ${channel} com esta abordagem: ${approach.angle}

BRIEF: ${briefText}

CONTEXTO DA MARCA:
${BRAND_CONTEXT}

Retorne o conteúdo completo pronto para publicar, com gancho forte, corpo e CTA claro.
O conteúdo deve ser autêntico, sem exageros e adequado para ${channel}.`,
      { label: `gerar:${approach.label}`, phase: "Geração", schema: CONTENT_SCHEMA }
    )
  )
);

const validVariants = variants.filter(Boolean);
if (!validVariants.length) {
  log("Nenhuma variante gerada — abortando.");
  return { approved: false, content: "", councilNotes: "Falha na geração de variantes." };
}

// ─── Conselho ───────────────────────────────────────────────────────────────
phase("Conselho");

const LENSES = [
  { key: "criatividade", role: "especialista em criatividade e copywriting B2B", question: "O gancho é forte o suficiente para parar o scroll? A linguagem é original e autêntica?" },
  { key: "eficacia", role: "especialista em conversão e growth para SaaS", question: "Este conteúdo vai gerar lead qualificado? O CTA é claro e tem fricção baixa?" },
  { key: "marca", role: "guardião de marca e voz editorial do SYSVETMAX", question: "A terminologia está correta (Tutor, Pet/Animal, MV)? Está alinhado ao tom: direto, confiante, sem clichê?" },
];

// Cada variante passa pelos 3 juízes em paralelo
const councilResults = await parallel(
  validVariants.flatMap((variant, vi) =>
    LENSES.map((lens) => () =>
      agent(
        `Você é ${lens.role} e membro do conselho de qualidade de marketing do SYSVETMAX.
Avalie criticamente este ${contentType} para ${channel}:

--- CONTEÚDO ---
${variant!.content}
--- FIM ---

Pergunta focal: ${lens.question}

CONTEXTO DA MARCA:
${BRAND_CONTEXT}

Seja rigoroso. Se houver clichê, termo errado ou CTA fraco, aponte sem rodeios.`,
        { label: `conselho:v${vi + 1}:${lens.key}`, phase: "Conselho", schema: REVIEW_SCHEMA }
      ).then((r) => ({ variant: variant!, variantIndex: vi, lens: lens.key, review: r }))
    )
  )
);

// Agrupa reviews por variante
const byVariant: Record<number, typeof councilResults> = {};
for (const r of councilResults.filter(Boolean)) {
  if (!r) continue;
  if (!byVariant[r.variantIndex]) byVariant[r.variantIndex] = [];
  byVariant[r.variantIndex].push(r);
}

// ─── Síntese ────────────────────────────────────────────────────────────────
phase("Síntese");

const councilSummary = validVariants.map((v, vi) => {
  const reviews = byVariant[vi] ?? [];
  const avgScore = reviews.reduce((s, r) => s + (r?.review?.score ?? 0), 0) / (reviews.length || 1);
  return `VARIANTE ${vi + 1} (score médio: ${avgScore.toFixed(1)}):
${v!.content}

Avaliações:
${reviews.map((r) => `  [${r?.lens}] score=${r?.review?.score} aprovado=${r?.review?.approved}\n  Pontos fortes: ${r?.review?.strengths?.join(", ")}\n  Pontos fracos: ${r?.review?.weaknesses?.join(", ")}\n  Sugestão: ${r?.review?.suggestion}`).join("\n\n")}`;
}).join("\n\n---\n\n");

const synthesis = await agent(
  `Você é o Presidente do Conselho de Marketing do SYSVETMAX.
Três conselheiros (criatividade, conversão, marca) avaliaram ${validVariants.length} variante(s) de ${contentType} para ${channel}.

BRIEF ORIGINAL: ${briefText}

AVALIAÇÕES DO CONSELHO:
${councilSummary}

CONTEXTO DA MARCA:
${BRAND_CONTEXT}

Sua missão:
1. Identifique a variante mais forte ou combine o melhor de cada uma.
2. Faça os ajustes necessários para garantir qualidade máxima.
3. Produza o conteúdo final aprovado — pronto para publicar no ${channel}.
4. Se NENHUMA variante atende o padrão mínimo (score <6 em todas), reprove e explique o que refazer.
5. Só marque publish_ready=true se o conteúdo não precisa de nenhuma revisão humana adicional.`,
  { label: "presidente:síntese", phase: "Síntese", schema: SYNTHESIS_SCHEMA }
);

if (!synthesis) {
  return { approved: false, content: "", councilNotes: "Síntese do presidente falhou." };
}

log(`Presidente: aprovado=${synthesis.approved}, publish_ready=${synthesis.publish_ready}`);

return {
  approved: synthesis.approved,
  content: synthesis.final_content,
  councilNotes: synthesis.council_notes,
  publishReady: synthesis.publish_ready,
};
