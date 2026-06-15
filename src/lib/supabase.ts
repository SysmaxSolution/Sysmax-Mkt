import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ===========================================================================
// Cliente admin do projeto Supabase EXCLUSIVO da Sysmax (funil comercial B2B).
//
// ISOLAMENTO TOTAL: este modulo NUNCA aponta para o banco do produto VetMax.
// Usa service_role (server-only) — nunca exponha esta chave no client.
//
// Inicializacao LAZY (via Proxy): o client so e criado no primeiro uso real,
// para nao quebrar o `next build` ao importar as rotas sem env em build-time.
// ===========================================================================

let _client: SupabaseClient | null = null;

function client(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SALES_SUPABASE_URL;
  const serviceKey = process.env.SALES_SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey) {
    throw new Error("SALES_SUPABASE_URL e SALES_SUPABASE_SERVICE_KEY sao obrigatorios (projeto Supabase da Sysmax).");
  }
  _client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

export const salesDb: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const c = client();
    const value = c[prop as keyof SupabaseClient];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(c) : value;
  },
});
