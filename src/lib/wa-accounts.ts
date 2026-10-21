import { salesDb } from "@/lib/supabase";

// ===========================================================================
// WhatsApp multi-instancia dentro do painel — uma conta Evolution por
// analista. Toda mensagem enviada pelo painel ou recebida pelo webhook passa
// por aqui e fica registrada: nao depende do analista "marcar que fez".
// ===========================================================================

export type WaAccount = {
  id: string;
  analyst_name: string;
  evolution_instance_id: string;
  phone_e164: string | null;
  status: "pending" | "connected" | "disconnected";
};

export type WaConversation = {
  id: string;
  wa_account_id: string;
  lead_id: string | null;
  contact_phone: string;
  contact_name: string | null;
  last_message_at: string | null;
  ai_suggestion: string | null;
  needs_director_review: boolean;
};

// Slug estavel a partir do nome do analista — usado como instanceId na Evolution.
export function instanceIdFor(analystName: string): string {
  const slug = analystName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `sysmax-analista-${slug}`;
}

export async function getOrCreateWaAccount(analystName: string): Promise<WaAccount> {
  const evolution_instance_id = instanceIdFor(analystName);
  const { data: existing } = await salesDb
    .from("wa_accounts")
    .select("id, analyst_name, evolution_instance_id, phone_e164, status")
    .eq("evolution_instance_id", evolution_instance_id)
    .maybeSingle();
  if (existing) return existing as WaAccount;

  const { data: created, error } = await salesDb
    .from("wa_accounts")
    .insert({ analyst_name: analystName, evolution_instance_id })
    .select("id, analyst_name, evolution_instance_id, phone_e164, status")
    .single();
  if (error) throw error;
  return created as WaAccount;
}

export async function getWaAccountById(id: string): Promise<WaAccount | null> {
  const { data } = await salesDb
    .from("wa_accounts")
    .select("id, analyst_name, evolution_instance_id, phone_e164, status")
    .eq("id", id)
    .maybeSingle();
  return (data as WaAccount) ?? null;
}

export async function getWaConversationById(id: string): Promise<WaConversation | null> {
  const { data } = await salesDb
    .from("wa_conversations")
    .select("id, wa_account_id, lead_id, contact_phone, contact_name, last_message_at, ai_suggestion, needs_director_review")
    .eq("id", id)
    .maybeSingle();
  return (data as WaConversation) ?? null;
}

export async function getWaAccountByInstance(evolutionInstanceId: string): Promise<WaAccount | null> {
  const { data } = await salesDb
    .from("wa_accounts")
    .select("id, analyst_name, evolution_instance_id, phone_e164, status")
    .eq("evolution_instance_id", evolutionInstanceId)
    .maybeSingle();
  return (data as WaAccount) ?? null;
}

export async function setWaAccountStatus(
  evolutionInstanceId: string,
  status: WaAccount["status"],
  phoneE164?: string | null
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (status === "connected") patch.connected_at = new Date().toISOString();
  if (phoneE164) patch.phone_e164 = phoneE164;
  await salesDb.from("wa_accounts").update(patch).eq("evolution_instance_id", evolutionInstanceId);
}

export async function listWaAccounts(): Promise<WaAccount[]> {
  const { data } = await salesDb
    .from("wa_accounts")
    .select("id, analyst_name, evolution_instance_id, phone_e164, status")
    .order("analyst_name");
  return (data as WaAccount[]) ?? [];
}

// Acha (ou cria) a conversa pelo par (conta, telefone), ligando ao lead se existir.
export async function getOrCreateWaConversation(
  waAccountId: string,
  contactPhone: string,
  contactName: string | null,
  leadId: string | null
): Promise<WaConversation> {
  const { data: existing } = await salesDb
    .from("wa_conversations")
    .select("id, wa_account_id, lead_id, contact_phone, contact_name, last_message_at, ai_suggestion, needs_director_review")
    .eq("wa_account_id", waAccountId)
    .eq("contact_phone", contactPhone)
    .maybeSingle();
  if (existing) {
    // Enriquece lead_id/contact_name se descobrimos agora e a conversa nao tinha.
    if ((!existing.lead_id && leadId) || (!existing.contact_name && contactName)) {
      await salesDb
        .from("wa_conversations")
        .update({ ...(leadId ? { lead_id: leadId } : {}), ...(contactName ? { contact_name: contactName } : {}) })
        .eq("id", existing.id);
    }
    return existing as WaConversation;
  }

  const { data: created, error } = await salesDb
    .from("wa_conversations")
    .insert({ wa_account_id: waAccountId, contact_phone: contactPhone, contact_name: contactName, lead_id: leadId })
    .select("id, wa_account_id, lead_id, contact_phone, contact_name, last_message_at, ai_suggestion, needs_director_review")
    .single();
  if (error) throw error;
  return created as WaConversation;
}

export async function insertWaMessage(params: {
  conversationId: string;
  direction: "in" | "out";
  body: string;
  rawPayload?: unknown;
}): Promise<void> {
  const now = new Date().toISOString();
  await salesDb.from("wa_messages").insert({
    conversation_id: params.conversationId,
    direction: params.direction,
    body: params.body,
    sent_at: now,
    raw_payload: params.rawPayload ?? null,
  });
  await salesDb.from("wa_conversations").update({ last_message_at: now }).eq("id", params.conversationId);
}

export async function listWaConversations(waAccountId?: string): Promise<Array<WaConversation & { analyst_name: string }>> {
  let query = salesDb
    .from("wa_conversations")
    .select(
      "id, wa_account_id, lead_id, contact_phone, contact_name, last_message_at, ai_suggestion, needs_director_review, wa_accounts(analyst_name)"
    )
    .order("last_message_at", { ascending: false, nullsFirst: false });
  if (waAccountId) query = query.eq("wa_account_id", waAccountId);
  const { data } = await query;
  type Row = WaConversation & { wa_accounts: { analyst_name: string } | { analyst_name: string }[] | null };
  return ((data ?? []) as unknown as Row[]).map((row) => {
    const joined = Array.isArray(row.wa_accounts) ? row.wa_accounts[0] : row.wa_accounts;
    return { ...row, analyst_name: joined?.analyst_name ?? "" };
  });
}

export async function listWaMessages(conversationId: string): Promise<Array<{ id: string; direction: "in" | "out"; body: string; sent_at: string }>> {
  const { data } = await salesDb
    .from("wa_messages")
    .select("id, direction, body, sent_at")
    .eq("conversation_id", conversationId)
    .order("sent_at", { ascending: true });
  return (data as Array<{ id: string; direction: "in" | "out"; body: string; sent_at: string }>) ?? [];
}

export async function setConversationReview(conversationId: string, needsReview: boolean, suggestion?: string | null): Promise<void> {
  await salesDb
    .from("wa_conversations")
    .update({ needs_director_review: needsReview, ...(suggestion !== undefined ? { ai_suggestion: suggestion } : {}) })
    .eq("id", conversationId);
}
