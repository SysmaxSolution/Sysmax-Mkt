import { sendText } from "@/lib/evolution";

// ===========================================================================
// Alerta ao DONO no WhatsApp pessoal (ordem do Diretor 29/07): sempre que uma
// conversa precisar de humano — handoff, loop, falha de envio, IA fora — ou
// quando o bot fechar uma reunião (lead quente), o Diretor recebe um ping no
// número pessoal e assume na hora. Nunca pode derrubar o fluxo principal.
// ===========================================================================

const DEFAULT_OWNER = "5516996095475"; // WhatsApp pessoal do Diretor (Djhames)

export async function notifyOwner(text: string): Promise<void> {
  const phone = (
    process.env.OWNER_ALERT_PHONE ??
    (process.env.OWNER_PHONES ?? "").split(",")[0] ??
    DEFAULT_OWNER
  ).replace(/\D/g, "") || DEFAULT_OWNER;
  try {
    await sendText(phone, text);
  } catch (e) {
    console.error("[owner-alert] falha ao notificar o dono:", e);
  }
}

// Traduz o handoffReason técnico para uma linha legível no alerta.
export function reasonLabel(reason?: string): string {
  if (!reason) return "transferência para humano";
  if (reason.startsWith("presentation_failed")) return "falha ao enviar a proposta por e-mail";
  switch (reason) {
    case "empty_reply": return "o bot ficou sem resposta segura";
    case "agent_loop_exhausted": return "o bot não conseguiu formular resposta";
    case "anthropic_error": return "IA instável — lead ficou SEM resposta";
    case "anthropic_no_credits": return "IA sem créditos — lead ficou SEM resposta";
    default: return reason; // motivo livre vindo do request_human_handoff
  }
}
