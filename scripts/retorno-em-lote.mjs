// ===========================================================================
// retorno-em-lote.mjs — marca retorno para um conjunto de clinicas de uma vez.
// ---------------------------------------------------------------------------
// Existe porque a captacao trouxe a propria carteira (16/10/2026): clinicas
// com WhatsApp validado, com quem ela JA conversou, e que ela quer reabordar a
// partir de janeiro/2027. Marcar uma a uma no cartao seria trabalho repetido.
//
// So mexe em quem ainda NAO tem retorno marcado, para nunca atropelar um
// compromisso ja combinado.
//
// Uso:
//   node scripts/retorno-em-lote.mjs --desde 2026-10-16 --data 2027-01-04T09:00
//   node scripts/retorno-em-lote.mjs --desde 2026-10-16 --data ... --aplicar
//
// Sem --aplicar e simulacao: mostra quantas seriam afetadas e nao grava nada.
// ===========================================================================
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

function arg(nome) {
  const i = process.argv.indexOf(nome);
  return i > -1 ? process.argv[i + 1] : null;
}

async function main() {
  const root = join(__dirname, "..");
  await loadEnvFile(join(root, ".env"), false);
  await loadEnvFile(join(root, ".env.local"), true);

  const desde = arg("--desde");
  const data = arg("--data");
  const aplicar = process.argv.includes("--aplicar");

  if (!desde || !data) {
    console.error("Uso: node scripts/retorno-em-lote.mjs --desde AAAA-MM-DD --data AAAA-MM-DDTHH:MM [--aplicar]");
    process.exit(1);
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(data)) {
    console.error("ERRO: --data precisa ser AAAA-MM-DDTHH:MM");
    process.exit(1);
  }

  // Horario de Brasilia, o mesmo criterio da rota /api/painel/agenda.
  const quando = new Date(`${data}:00-03:00`);
  if (Number.isNaN(quando.getTime())) { console.error("ERRO: data invalida."); process.exit(1); }
  const diaSemana = new Date(quando.getTime() - 3 * 3_600_000).getUTCDay();
  if (diaSemana === 0 || diaSemana === 6) {
    console.error("ERRO: a data cai em fim de semana. Clinica so de segunda a sexta.");
    process.exit(1);
  }

  const db = createClient(process.env.SALES_SUPABASE_URL, process.env.SALES_SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const { data: alvos, error } = await db
    .from("leads")
    .select("id,company_name,name,phone")
    .eq("source", "manual")
    .gte("created_at", `${desde}T00:00:00Z`)
    .is("retorno_em", null);
  if (error) { console.error("ERRO:", error.message); process.exit(1); }

  console.log(`${(alvos ?? []).length} clinica(s) importada(s) desde ${desde} e ainda sem retorno marcado.`);
  for (const a of (alvos ?? []).slice(0, 10)) {
    console.log("  -", a.company_name ?? a.name ?? "(sem nome)", a.phone ?? "");
  }
  if ((alvos ?? []).length > 10) console.log(`  ... e mais ${alvos.length - 10}.`);

  if (!aplicar) {
    console.log(`\nSIMULACAO. Para gravar retorno em ${data}, repita com --aplicar.`);
    return;
  }

  let ok = 0;
  for (const a of alvos ?? []) {
    const { error: e2 } = await db.from("leads").update({ retorno_em: quando.toISOString() }).eq("id", a.id);
    if (e2) console.log("  ! falhou:", a.company_name ?? a.id, e2.message);
    else ok++;
  }
  console.log(`\nOK: retorno marcado em ${ok} clinica(s) para ${quando.toLocaleString("pt-BR")}.`);
}

main();
