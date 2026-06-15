import Anthropic from "@anthropic-ai/sdk";
import { createMessageWithFallback, hasFallbackKey, SALES_MODEL } from "@/lib/anthropic";
import { PRODUCT_INFO, SALES_SYSTEM_PROMPT } from "@/lib/brand";
import {
  getRecentHistory,
  updateLeadProfile,
  moveStage,
  scheduleDemo,
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
};

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
  const systemPrompt = [SALES_SYSTEM_PROMPT, `Hoje é ${today}.`, leadContext(lead)].join("\n\n");

  let stageChanged: LeadStage | undefined;
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
      return {
        reply: "Tive uma instabilidade técnica agora há pouco. Já vou pedir para um consultor da Sysmax te chamar, tudo bem?",
        handoff: true,
        handoffReason: isCredits ? "anthropic_no_credits" : "anthropic_error",
      };
    }

    const toolUses = response.content.filter((b) => b.type === "tool_use");

    // Handoff explícito encerra o loop.
    const handoffBlock = toolUses.find((b) => b.type === "tool_use" && b.name === "request_human_handoff");
    if (handoffBlock && handoffBlock.type === "tool_use") {
      const reason = (handoffBlock.input as { reason?: string }).reason ?? "handoff";
      return { reply: "Perfeito, vou te conectar com um consultor da nossa equipe — em instantes alguém continua por aqui. 😊", handoff: true, handoffReason: reason, stageChanged };
    }

    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find((b) => b.type === "text");
      const reply = textBlock?.type === "text" ? textBlock.text.trim() : "";
      return { reply: reply || "Desculpe, pode repetir?", handoff: false, stageChanged };
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
          await scheduleDemo(lead.id, `${date}T${time}:00`, (input.notes as string | undefined) ?? null);
          stageChanged = "demo";
          const label = new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
          result = `Demonstração registrada para ${label} às ${time}. Confirme ao lead com simpatia.`;
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

  return { reply: "Desculpe, não consegui processar agora. Pode reformular?", handoff: false, stageChanged };
}
