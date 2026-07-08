import { salesDb } from "@/lib/supabase";

// ===========================================================================
// Playbook aprendido: diretrizes destiladas das conversas e mensagens reais
// pelo cron /api/cron/prompt-learning. A versão mais recente é injetada nos
// prompts geradores de mensagens (outbox/worklist) e no sales-agent.
// ===========================================================================

export type PlaybookScope = "global" | "whatsapp" | "email" | "call" | "ig_dm";

export async function getLatestPlaybook(scope: PlaybookScope = "global"): Promise<string | null> {
  const { data } = await salesDb
    .from("sales_playbook")
    .select("insights")
    .eq("scope", scope)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.insights as string | undefined)?.trim() || null;
}

export async function savePlaybook(scope: PlaybookScope, insights: string, sample: Record<string, unknown>): Promise<void> {
  const { error } = await salesDb.from("sales_playbook").insert({ scope, insights, sample });
  if (error) console.error("[playbook] falha ao salvar:", error.message);
}

// Bloco pronto para anexar a um system prompt. Vazio se ainda não há playbook.
export function playbookBlock(insights: string | null): string {
  if (!insights) return "";
  return `\n\nAPRENDIZADOS DE CONVERSAS REAIS (destilados automaticamente do histórico — aplique ao escrever):\n${insights}`;
}
