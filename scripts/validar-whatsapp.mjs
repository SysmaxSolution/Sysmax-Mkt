// ===========================================================================
// validar-whatsapp.mjs — marca quais telefones da fila existem no WhatsApp.
// ---------------------------------------------------------------------------
// Regra da captacao (16/10): no Brasil quase nenhuma clinica atende ligacao,
// entao telefone sem WhatsApp nao serve para nada e so polui o cartao. Aqui a
// gente pergunta ao WhatsApp quais numeros existem e grava em leads.wa_valido.
//
// E uma CONSULTA, nao envio: nenhuma mensagem sai daqui. Ainda assim roda
// devagar de proposito -- lote pequeno e pausa entre lotes -- porque rajada de
// consulta na instancia e vetor conhecido de bloqueio. O guard-rail do council
// vale aqui tambem: WhatsApp so warm, nunca em rajada.
//
// Retomavel: so checa quem ainda nao foi checado (wa_checado_em null).
//
// Uso:  node scripts/validar-whatsapp.mjs [quantidade]
//       node scripts/validar-whatsapp.mjs --recheck   (refaz tudo do zero)
// ===========================================================================
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOTE = 25;
const PAUSA_MS = 6000;

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mesmo formato do envio: 55 + DDD + numero.
function normaliza(raw) {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return d.startsWith("55") && d.length >= 12 ? d : "55" + d;
}

async function main() {
  const root = join(__dirname, "..");
  await loadEnvFile(join(root, ".env"), false);
  await loadEnvFile(join(root, ".env.local"), true);

  const db = createClient(process.env.SALES_SUPABASE_URL, process.env.SALES_SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
  const apiUrl = limpa(process.env.EVOLUTION_API_URL);
  const apiKey = limpa(process.env.EVOLUTION_API_KEY);
  const inst = limpa(process.env.EVOLUTION_COMMERCIAL_INSTANCE) || "sysmax-comercial";
  if (!apiUrl || !apiKey) { console.error("ERRO: EVOLUTION_API_URL/KEY ausentes."); process.exit(1); }

  const recheck = process.argv.includes("--recheck");
  const limite = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 0) || 100000;

  let q = db.from("leads").select("id,phone").not("phone", "is", null).in("source", ["places", "manual"]);
  if (!recheck) q = q.is("wa_checado_em", null);
  const { data: leads, error } = await q.limit(limite);
  if (error) { console.error("ERRO ao ler leads:", error.message); process.exit(1); }

  const alvos = (leads ?? [])
    .map((l) => ({ id: l.id, num: normaliza(l.phone) }))
    .filter((l) => l.num);
  const semNumero = (leads ?? []).length - alvos.length;

  console.log(`${alvos.length} numero(s) para checar${semNumero ? ` (${semNumero} descartado(s) por formato)` : ""}.`);
  if (!alvos.length) return;

  let validos = 0, invalidos = 0, falhas = 0;

  for (let i = 0; i < alvos.length; i += LOTE) {
    const bloco = alvos.slice(i, i + LOTE);
    let resposta = null;
    try {
      const r = await fetch(`${apiUrl}/chat/whatsappNumbers/${inst}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: apiKey },
        body: JSON.stringify({ numbers: bloco.map((b) => b.num) }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      resposta = await r.json();
    } catch (e) {
      falhas += bloco.length;
      console.log(`  lote ${i / LOTE + 1}: FALHOU (${e.message}) — fica para a proxima rodada`);
      await sleep(PAUSA_MS);
      continue;
    }

    // A resposta vem na ordem dos numeros enviados, mas melhor casar por numero.
    const porNumero = new Map((resposta ?? []).map((x) => [String(x.number), !!x.exists]));
    const agora = new Date().toISOString();
    for (const b of bloco) {
      const existe = porNumero.get(b.num) ?? false;
      existe ? validos++ : invalidos++;
      await db.from("leads").update({ wa_valido: existe, wa_checado_em: agora }).eq("id", b.id);
    }
    console.log(`  lote ${Math.floor(i / LOTE) + 1}/${Math.ceil(alvos.length / LOTE)} — ${validos} com WhatsApp, ${invalidos} sem`);
    if (i + LOTE < alvos.length) await sleep(PAUSA_MS);
  }

  console.log(`\nFim: ${validos} com WhatsApp, ${invalidos} sem, ${falhas} nao checado(s).`);
}

main();
