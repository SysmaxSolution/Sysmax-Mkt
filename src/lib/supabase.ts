import { createClient } from "@supabase/supabase-js";

// ===========================================================================
// Cliente admin do projeto Supabase EXCLUSIVO da Sysmax (funil comercial B2B).
//
// ISOLAMENTO TOTAL: este modulo NUNCA deve importar ou apontar para o banco do
// produto VetMax. As credenciais (SALES_*) sao de um projeto Supabase separado.
// Usa service_role (server-only) — nunca exponha esta chave no client.
// ===========================================================================

const url = process.env.SALES_SUPABASE_URL;
const serviceKey = process.env.SALES_SUPABASE_SERVICE_KEY;

if (!url || !serviceKey) {
  throw new Error(
    "SALES_SUPABASE_URL e SALES_SUPABASE_SERVICE_KEY sao obrigatorios (projeto Supabase da Sysmax).",
  );
}

export const salesDb = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
