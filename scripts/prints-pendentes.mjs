// ===========================================================================
// prints-pendentes.mjs — prints de relatório de rede social que a equipe
// anexou pelo painel e que ainda estão sem número digitado.
// ---------------------------------------------------------------------------
// A captação tira print do relatório do Facebook e não precisa transcrever:
// baixa-se o print aqui, lê-se o número e grava-se de volta.
//
// Listar e baixar:   node scripts/prints-pendentes.mjs
// Preencher:         node scripts/prints-pendentes.mjs <canal> <dia> <pub> [alcance]
//   ex.: node scripts/prints-pendentes.mjs facebook_pagina 2026-10-16 7 412
// ===========================================================================
import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESTINO = join(__dirname, "..", ".tmp-prints");
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

function db() {
  const url = process.env.SALES_SUPABASE_URL;
  const key = process.env.SALES_SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("ERRO: SALES_SUPABASE_URL e SALES_SUPABASE_SERVICE_KEY sao obrigatorios.");
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function listar(d) {
  const { data, error } = await d
    .from("social_metrics")
    .select("canal,dia,publicacoes,alcance,obs,fotos,conferir")
    .not("fotos", "is", null)
    .order("dia", { ascending: false });
  if (error) { console.error("ERRO:", error.message); process.exit(1); }

  const linhas = data ?? [];
  if (!linhas.length) { console.log("Nenhum print anexado ainda."); return; }

  await mkdir(DESTINO, { recursive: true });
  for (const l of linhas) {
    const estado = l.conferir ? "A CONFERIR" : `${l.publicacoes ?? 0} pub${l.alcance ? ` / ${l.alcance} views` : ""}`;
    console.log(`\n${l.dia}  ${l.canal.padEnd(16)} ${estado}${l.obs ? `  (${l.obs})` : ""}`);
    for (const caminho of l.fotos ?? []) {
      const { data: arq, error: e2 } = await d.storage.from(BUCKET).download(caminho);
      if (e2 || !arq) { console.log(`   ! falhou baixar ${caminho}: ${e2?.message ?? "sem dados"}`); continue; }
      const nome = `${l.dia}_${l.canal}_${caminho.split("/").pop()}`;
      const destino = join(DESTINO, nome);
      await writeFile(destino, Buffer.from(await arq.arrayBuffer()));
      console.log(`   ${destino}`);
    }
  }
  console.log(`\n${linhas.filter((l) => l.conferir).length} dia(s) a conferir.`);
}

async function preencher(d, canal, dia, pub, alc) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) { console.error("ERRO: dia no formato AAAA-MM-DD."); process.exit(1); }
  const publicacoes = Number(pub);
  if (!Number.isInteger(publicacoes) || publicacoes < 0) { console.error("ERRO: publicacoes invalido."); process.exit(1); }
  const alcance = alc === undefined ? undefined : Number(alc);
  if (alcance !== undefined && (!Number.isInteger(alcance) || alcance < 0)) { console.error("ERRO: alcance invalido."); process.exit(1); }

  const { data, error } = await d
    .from("social_metrics")
    .update({ publicacoes, ...(alcance === undefined ? {} : { alcance }), conferir: false })
    .eq("canal", canal)
    .eq("dia", dia)
    .select("canal,dia,publicacoes,alcance");
  if (error) { console.error("ERRO:", error.message); process.exit(1); }
  if (!data?.length) { console.error(`Nao achei linha para ${canal} em ${dia}.`); process.exit(1); }
  console.log("OK:", JSON.stringify(data[0]));
}

async function main() {
  const root = join(__dirname, "..");
  await loadEnvFile(join(root, ".env"), false);
  await loadEnvFile(join(root, ".env.local"), true);
  const d = db();

  const [canal, dia, pub, alc] = process.argv.slice(2);
  if (canal) await preencher(d, canal, dia, pub, alc);
  else await listar(d);
}

main();
