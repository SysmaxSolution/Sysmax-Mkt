import { salesDb } from "@/lib/supabase";

// ===========================================================================
// Camada de CRM sobre o Supabase Sysmax (salesDb usa service_role).
// ===========================================================================

export type LeadStage = "new" | "engaged" | "qualified" | "demo" | "won" | "lost";

export type Lead = {
  id: string;
  name: string | null;
  phone: string | null;
  company_name: string | null;
  clinic_size: string | null;
  employees: number | null;
  current_software: string | null;
  pains: string[] | null;
  stage: LeadStage;
};

const LEAD_FIELDS = "id, name, phone, company_name, clinic_size, employees, current_software, pains, stage";

// Encontra (ou cria) o lead pelo telefone. O inbound do WhatsApp implica opt-in.
export async function findOrCreateLeadByPhone(phone: string, name: string | null): Promise<Lead | null> {
  const { data: existing } = await salesDb
    .from("leads")
    .select(LEAD_FIELDS)
    .eq("phone", phone)
    .maybeSingle();

  if (existing) {
    if (!existing.name && name) {
      await salesDb.from("leads").update({ name }).eq("id", existing.id);
      existing.name = name;
    }
    return existing as Lead;
  }

  const { data: created, error } = await salesDb
    .from("leads")
    .insert({ phone, name, source: "whatsapp", stage: "new", consent_optin: true })
    .select(LEAD_FIELDS)
    .single();
  if (error) {
    console.error("[crm] falha ao criar lead:", error.message);
    return null;
  }
  await salesDb.from("consent_log").insert({
    lead_id: created.id,
    identifier: phone,
    channel: "whatsapp",
    optin_at: new Date().toISOString(),
  });
  return created as Lead;
}

export type Conversation = { id: string; status: "bot" | "human" | "closed" };

// Conversa ativa (não fechada) do lead no canal WhatsApp; cria se não existir.
export async function getOrCreateConversation(leadId: string): Promise<Conversation | null> {
  const { data: existing } = await salesDb
    .from("conversations")
    .select("id, status")
    .eq("lead_id", leadId)
    .eq("channel", "whatsapp")
    .neq("status", "closed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing as Conversation;

  const { data: created, error } = await salesDb
    .from("conversations")
    .insert({ lead_id: leadId, channel: "whatsapp", status: "bot" })
    .select("id, status")
    .single();
  if (error) {
    console.error("[crm] falha ao criar conversa:", error.message);
    return null;
  }
  return created as Conversation;
}

// Conversa ativa do lead por telefone — usado no fluxo fromMe (handoff).
export async function getActiveConversationByPhone(
  phone: string,
): Promise<(Conversation & { lead_id: string }) | null> {
  const { data: lead } = await salesDb.from("leads").select("id").eq("phone", phone).maybeSingle();
  if (!lead) return null;
  const { data: conv } = await salesDb
    .from("conversations")
    .select("id, status, lead_id")
    .eq("lead_id", lead.id)
    .eq("channel", "whatsapp")
    .neq("status", "closed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (conv as (Conversation & { lead_id: string }) | null) ?? null;
}

type Direction = "inbound" | "outbound";
type SentBy = "bot" | "human" | "client";

export async function insertMessage(params: {
  conversationId: string;
  direction: Direction;
  content: string;
  sentBy: SentBy;
  externalId?: string | null;
}): Promise<void> {
  await salesDb.from("messages").insert({
    conversation_id: params.conversationId,
    direction: params.direction,
    channel: "whatsapp",
    content: params.content,
    sent_by: params.sentBy,
    external_id: params.externalId ?? null,
  });
  await salesDb.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", params.conversationId);
}

// Normaliza texto para comparação de eco: unicode NFKC, remove TODO
// whitespace e baixa caixa. Tolera as variações de encoding que o
// WhatsApp aplica em \n e emoji no evento fromMe devolvido pela Evolution.
function normalizeForEcho(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

// Decide se uma mensagem fromMe é ECO de algo que o BOT enviou (e não
// uma intervenção humana). Compara CONTEÚDO — não basta o bot ter mandado
// algo recentemente. Mensagens do bot são longas; o eco pode voltar
// truncado/reencodado, então casamos por prefixo a partir de 16 chars.
function isEchoMatch(botText: string, incoming: string): boolean {
  const a = normalizeForEcho(botText);
  const b = normalizeForEcho(incoming);
  if (!a || !b) return false;
  if (a === b) return true;
  const head = Math.min(a.length, b.length, 40);
  return head >= 16 && a.slice(0, head) === b.slice(0, head);
}

// Verifica se a mensagem fromMe corresponde a uma mensagem que o BOT
// enviou nos últimos 90s. Como comparamos conteúdo, uma resposta humana
// digitada logo após o bot (texto diferente) NÃO é tratada como eco e
// dispara corretamente o handoff — esse era o furo que deixava o bot
// atropelar o consultor.
export async function isRecentEcho(conversationId: string, content: string): Promise<boolean> {
  if (!content?.trim()) return false;
  const since = new Date(Date.now() - 90_000).toISOString();
  const { data } = await salesDb
    .from("messages")
    .select("content")
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    .eq("sent_by", "bot")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5);
  if (!data?.length) return false;
  return data.some((m) => isEchoMatch((m as { content: string }).content, content));
}

// Status atual da conversa — usado para re-checar handoff logo antes de o
// bot enviar (o humano pode ter assumido durante o processamento do agente).
export async function getConversationStatus(
  conversationId: string,
): Promise<Conversation["status"] | null> {
  const { data } = await salesDb
    .from("conversations")
    .select("status")
    .eq("id", conversationId)
    .maybeSingle();
  return (data?.status as Conversation["status"] | undefined) ?? null;
}

export async function getRecentHistory(
  conversationId: string,
): Promise<{ direction: Direction; content: string }[]> {
  const { data } = await salesDb
    .from("messages")
    .select("direction, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(10);
  return ((data ?? []) as { direction: Direction; content: string }[]).reverse();
}

export async function setConversationStatus(conversationId: string, status: Conversation["status"]): Promise<void> {
  await salesDb.from("conversations").update({ status }).eq("id", conversationId);
}

// --- Mutações de funil (usadas pelas tools do agente) ----------------------

export async function updateLeadProfile(
  leadId: string,
  profile: Partial<Pick<Lead, "name" | "company_name" | "clinic_size" | "employees" | "current_software" | "pains">>,
): Promise<void> {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(profile)) {
    if (v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)) patch[k] = v;
  }
  if (Object.keys(patch).length === 0) return;
  patch.last_contact_at = new Date().toISOString();
  await salesDb.from("leads").update(patch).eq("id", leadId);
}

export async function moveStage(leadId: string, stage: LeadStage): Promise<void> {
  const patch: Record<string, unknown> = { stage, last_contact_at: new Date().toISOString() };
  if (stage === "qualified") patch.qualified_at = new Date().toISOString();
  if (stage === "won") patch.won_at = new Date().toISOString();
  await salesDb.from("leads").update(patch).eq("id", leadId);
}

export async function scheduleDemo(leadId: string, scheduledAt: string, notes: string | null): Promise<void> {
  await salesDb.from("demos").insert({ lead_id: leadId, scheduled_at: scheduledAt, notes, status: "scheduled" });
  await moveStage(leadId, "demo");
}
