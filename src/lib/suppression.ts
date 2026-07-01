import { salesDb } from "@/lib/supabase";

// ===========================================================================
// Suppression list (opt-out global — LGPD). Qualquer identificador aqui NUNCA
// mais pode ser contatado. É consultada antes de todo disparo (worker) e
// alimentada pelo /api/unsubscribe, por bounces e por opt-out manual.
// ===========================================================================

export type SuppressionChannel = "email" | "whatsapp" | "all";

// Normaliza o identificador para casar com o que gravamos: e-mail em minúsculas
// e telefone só com dígitos (E.164 sem '+').
export function normalizeIdentifier(channel: SuppressionChannel, raw: string): string {
  const v = raw.trim();
  return channel === "email" ? v.toLowerCase() : v.replace(/\D/g, "");
}

// True se o identificador estiver suprimido no canal pedido ou em 'all'.
export async function isSuppressed(channel: Exclude<SuppressionChannel, "all">, raw: string): Promise<boolean> {
  const id = normalizeIdentifier(channel, raw);
  if (!id) return false;
  const { data, error } = await salesDb
    .from("suppression")
    .select("id")
    .eq("identifier", id)
    .in("channel", [channel, "all"])
    .limit(1);
  if (error) throw new Error(`suppression check falhou: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

// Insere (idempotente) um opt-out. reason: unsubscribe | bounce | reclamacao | manual.
export async function addSuppression(
  channel: SuppressionChannel,
  raw: string,
  reason: string,
): Promise<void> {
  const id = normalizeIdentifier(channel, raw);
  if (!id) return;
  const { error } = await salesDb
    .from("suppression")
    .upsert({ identifier: id, channel, reason }, { onConflict: "identifier,channel", ignoreDuplicates: true });
  if (error) throw new Error(`suppression insert falhou: ${error.message}`);
}
