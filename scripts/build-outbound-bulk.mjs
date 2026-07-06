// ===========================================================================
// build-outbound-bulk.mjs — gera EM LOTE (sem os caps dos crons) as mensagens
// de abordagem para todas as clínicas descobertas que ainda não têm item na
// fila. Reaproveita os prompts dos crons lead-followups (e-mail) e worklist-
// build (ligação + DM). NÃO ENVIA nada — só grava outbox status='draft'.
//   node scripts/build-outbound-bulk.mjs [--limit=N] [--dry]
// ===========================================================================
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
async function loadEnvFile(fp, ow) {
  try {
    const env = await readFile(fp, "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && (ow || !process.env[m[1]])) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  } catch {}
}
await loadEnvFile(join(__dirname, "..", ".env"), false);
await loadEnvFile(join(__dirname, "..", ".env.local"), true);

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;
const CONCURRENCY = 5;

const db = createClient(process.env.SALES_SUPABASE_URL, process.env.SALES_SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.SALES_MODEL ?? "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-haiku-4-5-20251001";

const badEmail = /(yahoo|gmail|hotmail|outlook|exemplo|example|seuemail|mysite|gserviceaccount|wixsite|godaddy|no-?reply)/i;
const badIg = /\.php|^(p|reel|reels|explore|accounts|stories)$/i;

const BRAND = { company: "Sysmax Software", product: "SYSVETMAX" };
const PRODUCT_INFO = `SYSVETMAX — sistema de gestão para clínicas e hospitais veterinários (Sysmax Software).
Posicionamento: o primeiro sistema veterinário com IA de verdade do Brasil. "Você atende; o SYSVETMAX escreve, agenda, cobra e concilia."
DIFERENCIAIS (IA de verdade, que nenhum concorrente BR tem):
- Prontuário por voz + IA: o MV dita a consulta e a IA estrutura prontuário, prescrição e documentos.
- WhatsApp inteligente: agente de IA conversa com o tutor, responde e agenda sozinho (com handoff humano).
- Mentor integrado, Omnisearch Ctrl+K (Zero-Click).
FLUXO CLÍNICO COMPLETO: recepção, triagem, MV, exames, internação + centro cirúrgico, farmácia. Conformidade CFMV. Multi-espécie.
FINANCEIRO: Caixa/PDV, recebíveis de cartão, NFS-e integrada, orçamento, conciliação Petlove, importação de NF-e.
PLANOS: Free R$0; Starter R$189/mês (NFS-e add-on +R$49); Premium R$359,90/mês (internação, cirurgia, NFS-e ilimitada); Enterprise R$1.299.
OFERTA: teste grátis 30 dias, sem cartão e sem fidelidade, migração assistida.`;

const EMAIL_SYSTEM = `Você escreve o PRIMEIRO e-mail de prospecção B2B da ${BRAND.company} para uma clínica veterinária que ainda não nos conhece. Objetivo: conseguir uma conversa e oferecer uma apresentação remota gratuita do ${BRAND.product}, sem compromisso.
REGRAS (o e-mail frio que um MV dono de clínica NÃO deletaria):
- Curto: 90-130 palavras. Tom humano, direto, respeitoso. Sem jargão de TI, sem "revolucione/solução completa/próximo nível".
- Abra reconhecendo a clínica pelo nome e cidade. Nada de "prezados senhores".
- Fisgue com o diferencial real: prontuário por voz + IA (o MV fala, a IA escreve) — nenhum concorrente brasileiro tem.
- UM único pedido claro: quem é o responsável / se topa uma demonstração remota de 15 min, sem compromisso. Não empurre preço no primeiro e-mail.
- Terminologia CFMV: Tutor, Pet, Médico Veterinário/MV. Assine como equipe comercial da ${BRAND.company}.
- Não invente dados da clínica. Não prometa nada fora da base.
Base de conhecimento:
${PRODUCT_INFO}
Responda SOMENTE com JSON válido, sem markdown: {"subject":"...","body":"..."}
O subject deve ter no máximo 60 caracteres, específico, sem CAPS/"!!!"/"grátis".`;

const WORKLIST_SYSTEM = `Você prepara material para o FUNDADOR da ${BRAND.company} abordar PESSOALMENTE (ligação e DM) uma clínica veterinária que ainda não nos conhece, para oferecer uma apresentação remota gratuita do ${BRAND.product}, sem compromisso.
Gere DOIS textos curtos:
1. "call_script": roteiro de ligação de 20-30s que o fundador vai FALAR. Estrutura: cumprimento + quem somos em 1 frase + gancho do prontuário por voz (o MV fala, a IA escreve) + pedir para falar com o responsável e propor uma demo de 15 min sem compromisso. Tom humano, natural de fala. Uma pergunta só ao final.
2. "dm_text": mensagem curta de Instagram DM (3-4 linhas), mesma proposta, tom leve, terminando com uma pergunta.
Terminologia CFMV: Tutor, Pet, Médico Veterinário/MV. Sem jargão de TI. Não invente dados da clínica.
Base de conhecimento:
${PRODUCT_INFO}
Responda SOMENTE com JSON válido, sem markdown: {"call_script":"...","dm_text":"..."}`;

function extractText(msg) {
  return (msg.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
}
function parseJson(raw) {
  const s = raw.startsWith("{") ? raw : (raw.match(/\{[\s\S]*\}/)?.[0] ?? "");
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}
async function callModel(system, user) {
  const params = { max_tokens: 800, temperature: 0.7, system, messages: [{ role: "user", content: user }] };
  try { return extractText(await anthropic.messages.create({ model: MODEL, ...params })); }
  catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/model/i.test(m) && MODEL !== FALLBACK_MODEL) {
      return extractText(await anthropic.messages.create({ model: FALLBACK_MODEL, ...params }));
    }
    throw e;
  }
}

// -- carrega leads + outbox existente --------------------------------------
const { data: leads } = await db.from("leads").select("id,name,company_name,email,city,uf,phone,instagram_handle,website,enrichment_status,current_software,opted_out,stage").eq("source", "places");
const { data: outbox } = await db.from("outbox").select("lead_id,channel");
const hasEmail = new Set(), hasWorklist = new Set();
for (const o of outbox ?? []) {
  if (o.channel === "email") hasEmail.add(o.lead_id);
  if (o.channel === "call" || o.channel === "ig_dm") hasWorklist.add(o.lead_id);
}

// -- segmenta em tarefas ----------------------------------------------------
const emailTasks = [], worklistTasks = [];
for (const l of leads ?? []) {
  if (l.opted_out) continue;
  const goodEmail = l.email && !badEmail.test(l.email);
  if (goodEmail) {
    if (!hasEmail.has(l.id)) emailTasks.push(l);
  } else if (l.phone) {
    if (!hasWorklist.has(l.id)) worklistTasks.push(l);
  }
}
let tasks = [...emailTasks.map((l) => ({ kind: "email", l })), ...worklistTasks.map((l) => ({ kind: "worklist", l }))];
if (LIMIT !== Infinity) tasks = tasks.slice(0, LIMIT);

console.log(`Leads Places: ${leads?.length ?? 0} | já com e-mail: ${hasEmail.size} | já com worklist: ${hasWorklist.size}`);
console.log(`A gerar → e-mails: ${emailTasks.length} | worklist(ligação+DM): ${worklistTasks.length} | total tarefas: ${tasks.length}${DRY ? "  [DRY-RUN]" : ""}`);
if (DRY || !tasks.length) process.exit(0);

// -- executa com concorrência limitada --------------------------------------
let done = 0, built = 0, failed = 0;
const errors = [];
async function worker(task) {
  const l = task.l;
  const context = `Clínica: ${l.company_name ?? l.name ?? "(sem nome)"}
Cidade/UF: ${l.city ?? "?"}/${l.uf ?? "?"}
Site: ${l.website ?? "(desconhecido)"}
Telefone: ${l.phone ?? "?"}
Instagram: ${l.instagram_handle && !badIg.test(l.instagram_handle) ? "@" + l.instagram_handle : "(não confiável)"}
Sistema atual conhecido: ${l.current_software ?? "(desconhecido)"}`;
  try {
    if (task.kind === "email") {
      const d = parseJson(await callModel(EMAIL_SYSTEM, `Escreva o e-mail para esta clínica:\n${context}`));
      if (!d?.subject || !d?.body) { failed++; errors.push(`${l.id}: parse e-mail`); return; }
      await db.from("outbox").insert({ lead_id: l.id, channel: "email", subject: String(d.subject).slice(0, 120), body: d.body, status: "draft" });
      built++;
    } else {
      const d = parseJson(await callModel(WORKLIST_SYSTEM, `Prepare a abordagem para esta clínica:\n${context}`));
      if (!d?.call_script) { failed++; errors.push(`${l.id}: parse worklist`); return; }
      const rows = [{ lead_id: l.id, channel: "call", body: d.call_script, status: "draft" }];
      let ig = l.instagram_handle && !badIg.test(l.instagram_handle) ? l.instagram_handle : null;
      if (!ig && l.website) { const m = l.website.match(/instagram\.com\/([a-z0-9._]{2,30})/i); if (m && !badIg.test(m[1])) ig = m[1]; }
      if (ig && d.dm_text) rows.push({ lead_id: l.id, channel: "ig_dm", body: d.dm_text, status: "draft" });
      await db.from("outbox").insert(rows);
      built++;
    }
  } catch (e) {
    failed++; errors.push(`${l.id}: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    done++;
    if (done % 20 === 0 || done === tasks.length) console.log(`  … ${done}/${tasks.length} (ok ${built}, falha ${failed})`);
  }
}

const queue = [...tasks];
async function runner() { while (queue.length) await worker(queue.shift()); }
await Promise.all(Array.from({ length: CONCURRENCY }, runner));

console.log(`\nOK — ${built} clínicas com mensagem nova, ${failed} falhas.`);
if (errors.length) console.log("Primeiras falhas:\n" + errors.slice(0, 8).map((e) => "  - " + e).join("\n"));
