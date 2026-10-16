// ===========================================================================
// ensure-material-bucket.mjs — cria o bucket de fotos do painel.
// ---------------------------------------------------------------------------
// A captação produz os posts fora do painel e precisa anexar a foto junto do
// texto (pedido de 2026-10-16: "lá no painel dá pra colocar foto?"). O bucket
// é PRIVADO: a foto só sai por /api/painel/material-foto, autenticado pelo
// token do painel — nada de URL pública adivinhável.
//
// Uso:  node scripts/ensure-material-bucket.mjs
// Idempotente: se o bucket já existe, só confirma e sai.
// ===========================================================================
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUCKET = "material";

async function loadEnvFile(filePath, overwrite = false) {
  try {
    const env = await readFile(filePath, "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && (overwrite || !process.env[m[1]])) {
        process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "").trim();
      }
    }
  } catch { /* arquivo opcional */ }
}

async function main() {
  const root = join(__dirname, "..");
  await loadEnvFile(join(root, ".env"), false);
  await loadEnvFile(join(root, ".env.local"), true);

  const url = process.env.SALES_SUPABASE_URL;
  const key = process.env.SALES_SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("ERRO: SALES_SUPABASE_URL e SALES_SUPABASE_SERVICE_KEY sao obrigatorios.");
    process.exit(1);
  }

  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: existentes, error: listErr } = await db.storage.listBuckets();
  if (listErr) { console.error("ERRO ao listar buckets:", listErr.message); process.exit(1); }
  if ((existentes ?? []).some((b) => b.name === BUCKET)) {
    console.log(`OK: bucket "${BUCKET}" ja existe.`);
    return;
  }

  const { error } = await db.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: "8MB",
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  });
  if (error) { console.error("ERRO ao criar bucket:", error.message); process.exit(1); }
  console.log(`OK: bucket "${BUCKET}" criado (privado, 8MB, jpeg/png/webp).`);
}

main();
