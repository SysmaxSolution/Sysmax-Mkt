import { salesDb } from "@/lib/supabase";

// ===========================================================================
// Cota diária de envio, compartilhada entre o worker (outbox-send) e os envios
// manuais do painel. A contagem sai da própria outbox, então os dois caminhos
// consomem o MESMO teto — é o que protege a reputação do subdomínio de envio.
// ===========================================================================

const WARMUP_MIN = parseInt(process.env.WARMUP_MIN ?? "20", 10);
const WARMUP_MAX = parseInt(process.env.WARMUP_MAX ?? "40", 10);
const WARMUP_STEP = parseInt(process.env.WARMUP_STEP ?? "5", 10);

export function startOfTodayUTC(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

// Teto de e-mail do dia conforme a rampa de aquecimento do domínio.
export function emailCapToday(): number {
  const startEnv = process.env.WARMUP_START_DATE;
  if (!startEnv) return WARMUP_MIN;
  const start = new Date(startEnv).getTime();
  if (Number.isNaN(start)) return WARMUP_MIN;
  const days = Math.floor((Date.now() - start) / 86_400_000);
  return Math.min(WARMUP_MAX, WARMUP_MIN + Math.max(0, days) * WARMUP_STEP);
}

export async function sentTodayCount(channel: "email" | "whatsapp"): Promise<number> {
  const { count } = await salesDb
    .from("outbox")
    .select("id", { count: "exact", head: true })
    .eq("channel", channel)
    .eq("status", "sent")
    .gte("sent_at", startOfTodayUTC());
  return count ?? 0;
}

export async function emailQuotaToday(): Promise<{ cap: number; sent: number; remaining: number }> {
  const cap = emailCapToday();
  const sent = await sentTodayCount("email");
  return { cap, sent, remaining: Math.max(0, cap - sent) };
}
