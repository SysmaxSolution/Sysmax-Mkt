// ===========================================================================
// recados.mjs — recados que a equipe mandou pelo painel, com as fotos.
// ---------------------------------------------------------------------------
// O canal do WhatsApp entrega só TEXTO para a rotina: foto, print e documento
// que ela manda por lá não chegam em ninguém do nosso lado. A porta que
// funciona é o painel ("Enviar material" → "Recado para o James"), que guarda
// o texto em team_notes e a imagem no bucket "material".
//
// Este script traz os dois para o disco, para a foto poder ser lida.
//
// Uso:  node scripts/recados.mjs [quantidade]
// As imagens vão para .tmp-recados/
// ===========================================================================
import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESTINO = join(__dirname, "..", ".tmp-recados");
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
  } catch { /* opcional */ }
}

async function main() {
  const root = join(__dirname, "..");
  await loadEnvFile(join(root, ".env"), false);
  await loadEnvFile(join(root, ".env.local"), true);

  const db = createClient(process.env.SALES_SUPABASE_URL, process.env.SALES_SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const limite = Number(process.argv[2] ?? 10);
  const { data, error } = await db
    .from("team_notes")
    .select("id,autor,titulo,texto,obs,fotos,entregue,created_at")
    .order("created_at", { ascending: false })
    .limit(limite);
  if (error) { console.error("ERRO:", error.message); process.exit(1); }
  if (!data?.length) { console.log("Nenhum recado ainda."); return; }

  await mkdir(DESTINO, { recursive: true });
  for (const r of data) {
    const quando = new Date(r.created_at).toLocaleString("pt-BR");
    console.log(`\n[${quando}] ${r.autor}${r.titulo ? ` — ${r.titulo}` : ""}${r.entregue ? "" : "  (WhatsApp falhou)"}`);
    if (r.texto) console.log(r.texto);
    if (r.obs) console.log(`Obs: ${r.obs}`);
    for (const [i, caminho] of (r.fotos ?? []).entries()) {
      const { data: arq, error: e2 } = await db.storage.from(BUCKET).download(caminho);
      if (e2 || !arq) { console.log(`   ! falhou baixar ${caminho}`); continue; }
      const destino = join(DESTINO, `${r.created_at.slice(0, 10)}_${r.id.slice(0, 8)}_${i + 1}.${caminho.split(".").pop()}`);
      await writeFile(destino, Buffer.from(await arq.arrayBuffer()));
      console.log(`   foto: ${destino}`);
    }
  }
}

main();
