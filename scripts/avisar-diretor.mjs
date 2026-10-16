// ===========================================================================
// avisar-diretor.mjs — ping no WhatsApp pessoal do Diretor.
// ---------------------------------------------------------------------------
// Ordem dele em 16/10/2026: avisar SEMPRE que houver decisao impactante no
// projeto -- exclusao de dados, mexida no site institucional, qualquer coisa
// que tire ou reduza funcionalidade. A Jessica pode mexer na estrutura do
// painel comercial e melhorar processo; o que NAO pode e decair ou retirar
// nada sem o aval dele.
//
// Uso:  node scripts/avisar-diretor.mjs "texto da mensagem"
//       node scripts/avisar-diretor.mjs --arquivo caminho.txt
// ===========================================================================
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONE_PADRAO = "5516996095475"; // WhatsApp pessoal do Diretor

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

const limpa = (v) => (v ?? "").replace(/^﻿/, "").trim();

// Markdown do WhatsApp: **negrito** vira *negrito*.
const paraWhats = (t) => t.replace(/\*\*([^*\n]+?)\*\*/g, "*$1*");

async function main() {
  const root = join(__dirname, "..");
  await loadEnvFile(join(root, ".env"), false);
  await loadEnvFile(join(root, ".env.local"), true);

  const args = process.argv.slice(2);
  let texto = "";
  if (args[0] === "--arquivo") {
    if (!args[1]) { console.error("ERRO: informe o caminho do arquivo."); process.exit(1); }
    texto = await readFile(args[1], "utf8");
  } else {
    texto = args.join(" ");
  }
  texto = texto.trim();
  if (!texto) { console.error("ERRO: mensagem vazia."); process.exit(1); }

  const apiUrl = limpa(process.env.EVOLUTION_API_URL);
  const apiKey = limpa(process.env.EVOLUTION_API_KEY);
  const inst = limpa(process.env.EVOLUTION_COMMERCIAL_INSTANCE) || "sysmax-comercial";
  const fone = (limpa(process.env.OWNER_ALERT_PHONE) || limpa(process.env.FOUNDER_WHATSAPP_PHONE) || FONE_PADRAO)
    .replace(/\D/g, "") || FONE_PADRAO;
  if (!apiUrl || !apiKey) { console.error("ERRO: EVOLUTION_API_URL/KEY ausentes."); process.exit(1); }

  const r = await fetch(`${apiUrl}/message/sendText/${inst}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: apiKey },
    body: JSON.stringify({ number: fone, text: paraWhats(texto).slice(0, 3800) }),
  });
  if (!r.ok) {
    console.error(`ERRO ${r.status}:`, (await r.text().catch(() => "")).slice(0, 300));
    process.exit(1);
  }
  console.log(`OK: avisado ${fone} (${texto.length} caracteres).`);
}

main();
