import Anthropic from "@anthropic-ai/sdk";

// ===========================================================================
// Wrapper resiliente do cliente Anthropic (portado do VetMax), com init LAZY.
//   ANTHROPIC_API_KEY          -> chave primaria (obrigatoria)
//   ANTHROPIC_API_KEY_FALLBACK -> usada se a primaria ficar sem creditos
// Lazy: os clients so sao criados no primeiro uso (nao quebra `next build`).
// ===========================================================================

export const SALES_MODEL = process.env.SALES_MODEL ?? "claude-haiku-4-5-20251001";

let _primary: Anthropic | null = null;
let _fallback: Anthropic | null = null;
let _fallbackResolved = false;

function primary(): Anthropic {
  if (!_primary) _primary = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _primary;
}

function fallback(): Anthropic | null {
  if (!_fallbackResolved) {
    const key = process.env.ANTHROPIC_API_KEY_FALLBACK;
    _fallback = key ? new Anthropic({ apiKey: key }) : null;
    _fallbackResolved = true;
  }
  return _fallback;
}

function isCreditError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("credit balance") || msg.includes("insufficient_quota");
}

export async function createMessageWithFallback(
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Message> {
  try {
    return await primary().messages.create(params);
  } catch (err) {
    const fb = fallback();
    if (!isCreditError(err) || !fb) throw err;
    console.warn("[anthropic] chave primaria sem creditos — tentando fallback");
    return await fb.messages.create(params);
  }
}

export function hasFallbackKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY_FALLBACK;
}
