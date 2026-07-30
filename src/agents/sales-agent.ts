import Anthropic from "@anthropic-ai/sdk";
import { createMessageWithFallback, hasFallbackKey, SALES_MODEL } from "@/lib/anthropic";
import { PRODUCT_INFO, SALES_SYSTEM_PROMPT } from "@/lib/brand";
import { sendPresentationPackage } from "@/lib/presentation";
import { getLatestPlaybook, playbookBlock } from "@/lib/playbook";
import {
  findDemoConflict,
  getRecentHistory,
  listUpcomingDemos,
  moveStage,
  scheduleDemo,
  updateLeadProfile,
  type Lead,
  type LeadStage,
} from "@/crm/leads";

// ─── Ferramentas do agente comercial ───────────────────────────────────────
const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_product_info",
    description: "Retorna fatos sobre o SYSVETMAX (diferenciais, fluxo, financeiro, planos e oferta). Use antes de citar qualquer preço ou funcionalidade.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "save_lead_profile",
    description: "Salva o que você descobriu sobre a clínica do lead. Chame assim que tiver qualquer um destes dados.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Nome da pessoa com quem você fala" },
        company_name: { type: "string", description: "Nome da clínica/hospital" },
        clinic_size: { type: "string", enum: ["solo", "pequena", "media", "grande", "rede"], description: "Porte da clínica" },
        employees: { type: "number", description: "Número de funcionários" },
        current_software: { type: "string", description: "Sistema que usa hoje (ou 'planilha'/'papel'/'nenhum')" },
        pains: { type: "array", items: { type: "string" }, description: "Principais dores citadas" },
      },
      required: [],
    },
  },
  {
    name: "mark_stage",
    description: "Move o lead no funil. engaged = conversa real iniciada; qualified = já sabe porte e dores; demo = demonstração agendada; lost = sem interesse.",
    input_schema: {
      type: "object" as const,
      properties: { stage: { type: "string", enum: ["engaged", "qualified", "demo", "lost"] } },
      required: ["stage"],
    },
  },
  {
    name: "schedule_demo",
    description: "Agenda a demonstração gratuita. Use depois de combinar data e horário com o lead.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: { type: "string", description: "Data no formato YYYY-MM-DD" },
        time: { type: "string", description: "Horário no formato HH:MM" },
        notes: { type: "string", description: "Observações (opcional)" },
      },
      required: ["date", "time"],
    },
  },
  {
    name: "send_presentation_email",
    description:
      "Use IMEDIATAMENTE quando o lead pedir a apresentação/proposta por e-mail. O sistema envia o e-mail com o PDF institucional, manda a confirmação no WhatsApp e o mesmo PDF no chat — tudo automático. Você NÃO precisa escrever nada depois. Se o lead ainda não informou o endereço, pergunte o e-mail antes de chamar esta ferramenta.",
    input_schema: {
      type: "object" as const,
      properties: { email: { type: "string", description: "Endereço de e-mail informado pelo lead" } },
      required: ["email"],
    },
  },
  {
    name: "request_human_handoff",
    description: "Transfere para um consultor humano: pedido explícito, insatisfação, negociação avançada ou assunto fora do escopo comercial.",
    input_schema: {
      type: "object" as const,
      properties: { reason: { type: "string", description: "Motivo da transferência" } },
      required: ["reason"],
    },
  },
];

export type SalesResult = {
  reply: string;
  handoff: boolean;
  handoffReason?: string;
  stageChanged?: LeadStage;
  demoScheduled?: { date: string; time: string }; // alerta de lead quente ao dono
};

// "2026-07-31T09:30:00+00:00" → "sexta-feira 31/07 às 09:30". O horário é
// gravado como HORA DE PAREDE (o bot combina em horário local do lead) — nunca
// converter timezone aqui, só fatiar a string.
function slotLabel(scheduledAt: string): string {
  const [d, rest] = scheduledAt.split("T");
  const hm = (rest ?? "").slice(0, 5);
  const weekday = new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long" });
  const [, m, day] = d.split("-");
  return `${weekday} ${day}/${m} às ${hm}`;
}

function leadContext(lead: Lead): string {
  const known: string[] = [];
  if (lead.name) known.push(`Nome: ${lead.name}`);
  if (lead.company_name) known.push(`Clínica: ${lead.company_name}`);
  if (lead.clinic_size) known.push(`Porte: ${lead.clinic_size}`);
  if (lead.employees) known.push(`Funcionários: ${lead.employees}`);
  if (lead.current_software) known.push(`Sistema atual: ${lead.current_software}`);
  if (lead.pains?.length) known.push(`Dores: ${lead.pains.join(", ")}`);
  known.push(`Estágio atual no funil: ${lead.stage}`);
  return known.length ? `Dados já conhecidos deste lead:\n${known.join("\n")}` : "Lead novo — você ainda não sabe nada sobre a clínica.";
}

export async function runSalesAgent(params: {
  lead: Lead;
  conversationId: string;
  userMessage: string;
}): Promise<SalesResult> {
  const { lead, conversationId, userMessage } = params;

  const history = await getRecentHistory(conversationId);
  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.direction === "inbound" ? "user" : "assistant",
    content: m.content,
  }));
  messages.push({ role: "user", content: userMessage });

  const today = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  // Diretrizes aprendidas das conversas reais (cron prompt-learning).
  const learned = playbookBlock(await getLatestPlaybook());
  // Agenda ocupada: o Diretor conduz as reuniões pessoalmente — o bot não pode
  // propor nem aceitar horário que colida com compromisso já marcado.
  const upcoming = await listUpcomingDemos(10);
  const agendaBlock = upcoming.length
    ? `AGENDA — HORÁRIOS JÁ OCUPADOS (reuniões são conduzidas pelo nosso diretor; NUNCA proponha nem aceite horário a menos de 1h destes — ofereça alternativa próxima):\n${upcoming
        .map((d) => `- ${slotLabel(d.scheduled_at)}${d.company ? ` (${d.company})` : ""}`)
        .join("\n")}`
    : "";
  const systemPrompt = [SALES_SYSTEM_PROMPT + learned, `Hoje é ${today}.`, agendaBlock, leadContext(lead)]
    .filter(Boolean)
    .join("\n\n");

  let stageChanged: LeadStage | undefined;
  let demoScheduled: { date: string; time: string } | undefined;
  let currentMessages = [...messages];

  for (let iter = 0; iter < 5; iter++) {
    let response: Anthropic.Message;
    try {
      response = await createMessageWithFallback({
        model: SALES_MODEL,
        max_tokens: 600,
        system: systemPrompt,
        tools: TOOLS,
        messages: currentMessages,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isCredits = msg.includes("credit balance") || msg.includes("insufficient_quota");
      console.error("[sales-agent] erro Anthropic:", isCredits ? `sem créditos (fallback=${hasFallbackKey()})` : msg);
      // Silêncio: mandar "instabilidade técnica" repetido já queimou prospect
      // (incidente 27/07 — 5 mensagens duplicadas). Erro transitório = não
      // responde nada; o webhook não envia reply vazio.
      return {
        reply: "",
        handoff: true,
        handoffReason: isCredits ? "anthropic_no_credits" : "anthropic_error",
      };
    }

    const toolUses = response.content.filter((b) => b.type === "tool_use");

    // Pacote "mande por e-mail": determinístico e encerra o loop. O próprio
    // sendPresentationPackage envia a confirmação FIXA no WhatsApp (palavras
    // do Diretor) + PDF + e-mail; devolvemos reply vazio SEM handoff para o
    // webhook não enviar nada por cima.
    const presBlock = toolUses.find((b) => b.type === "tool_use" && b.name === "send_presentation_email");
    if (presBlock && presBlock.type === "tool_use") {
      const email = String((presBlock.input as { email?: string }).email ?? "");
      const sent = await sendPresentationPackage({ lead, email, conversationId });
      if (sent.ok) return { reply: "", handoff: false, stageChanged: stageChanged ?? "engaged" };
      console.error("[sales-agent] pacote de apresentação falhou:", sent.error);
      // Falha no envio: silêncio + humano assume (nunca prometer e não entregar).
      return { reply: "", handoff: true, handoffReason: `presentation_failed: ${sent.error}`, stageChanged, demoScheduled };
    }

    // Handoff explícito encerra o loop.
    const handoffBlock = toolUses.find((b) => b.type === "tool_use" && b.name === "request_human_handoff");
    if (handoffBlock && handoffBlock.type === "tool_use") {
      const reason = (handoffBlock.input as { reason?: string }).reason ?? "handoff";
      return { reply: "Perfeito, vou te conectar com um consultor da nossa equipe — em instantes alguém continua por aqui. 😊", handoff: true, handoffReason: reason, stageChanged, demoScheduled };
    }

    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find((b) => b.type === "text");
      let reply = textBlock?.type === "text" ? textBlock.text.trim() : "";
      // O modelo às vezes "sinaliza silêncio" com placeholder — e isso ia como
      // mensagem real ao cliente ("*(aguardando)*", 3x em 30/07). Placeholder =
      // silêncio de verdade, sem handoff.
      const isPlaceholder =
        reply.length > 0 &&
        (/^[\s*_(\[]*\(?\s*(sil[êe]ncio|aguardando|sem\s+resposta|no[- ]?reply)/i.test(reply) || /^[.…\s*_]+$/.test(reply));
      if (isPlaceholder) return { reply: "", handoff: false, stageChanged, demoScheduled }; // silêncio deliberado
      // Resposta vazia do modelo = incerteza. NUNCA mandar "Desculpe, pode
      // repetir?" (incidente VFP 27/07 — perdeu o prospecto). Silêncio + humano.
      if (!reply) return { reply: "", handoff: true, handoffReason: "empty_reply", stageChanged, demoScheduled };
      return { reply, handoff: false, stageChanged, demoScheduled };
    }

    if (response.stop_reason === "tool_use") {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUses) {
        if (block.type !== "tool_use") continue;
        const input = block.input as Record<string, unknown>;
        let result = "ok";

        if (block.name === "get_product_info") {
          result = PRODUCT_INFO;
        } else if (block.name === "save_lead_profile") {
          await updateLeadProfile(lead.id, {
            name: input.name as string | undefined,
            company_name: input.company_name as string | undefined,
            clinic_size: input.clinic_size as string | undefined,
            employees: input.employees as number | undefined,
            current_software: input.current_software as string | undefined,
            pains: input.pains as string[] | undefined,
          });
          result = "Perfil do lead atualizado.";
        } else if (block.name === "mark_stage") {
          const stage = input.stage as LeadStage;
          await moveStage(lead.id, stage);
          stageChanged = stage;
          result = `Lead movido para o estágio ${stage}.`;
        } else if (block.name === "schedule_demo") {
          const date = input.date as string;
          const time = input.time as string;
          const label = new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
          // Trava de conflito (Diretor 30/07): reuniões são dele — nada de dois
          // compromissos na mesma janela. ±45min cobre reunião de 15-30min + folga.
          const conflict = await findDemoConflict(`${date}T${time}:00`, 45);
          if (conflict) {
            result = `⚠️ CONFLITO DE AGENDA: já existe reunião marcada em ${slotLabel(conflict.scheduled_at)}${conflict.company ? ` com ${conflict.company}` : ""}. NÃO confirme ${label} às ${time}. Peça desculpas pelo horário indisponível e ofereça 2 alternativas concretas fora dessa janela (ex.: 1h30 depois, ou outro período do mesmo dia / dia seguinte). Só chame schedule_demo de novo com o horário novo combinado.`;
          } else {
            await scheduleDemo(lead.id, `${date}T${time}:00`, (input.notes as string | undefined) ?? null);
            stageChanged = "demo";
            demoScheduled = { date, time };
            result = `Demonstração registrada para ${label} às ${time}. Confirme ao lead com simpatia.`;
          }
        }

        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      }

      currentMessages = [
        ...currentMessages,
        { role: "assistant", content: response.content },
        { role: "user", content: toolResults },
      ];
      continue;
    }

    break;
  }

  // Loop esgotado sem resposta útil: silêncio + transferir para humano em vez
  // de resposta burra que queima o prospect.
  return { reply: "", handoff: true, handoffReason: "agent_loop_exhausted", stageChanged, demoScheduled };
}
