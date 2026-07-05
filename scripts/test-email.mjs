// ===========================================================================
// test-email.mjs — teste de entregabilidade do subdomínio de envio.
// Envia 1 e-mail via Resend usando MAIL_FROM (subdomínio aquecido) e imprime o
// id da resposta. Use para confirmar DKIM/SPF e inspecionar o "show original".
//
// Uso:
//   node scripts/test-email.mjs                      -> envia p/ MAIL_REPLY_TO
//   node scripts/test-email.mjs voce@dominio.com     -> destinatário explícito
//   node scripts/test-email.mjs test-xxxx@srv1.mail-tester.com  -> pontuar no mail-tester
//
// Requer no .env / .env.local: RESEND_API_KEY, MAIL_FROM (e idealmente MAIL_REPLY_TO).
// ===========================================================================
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadEnvFile(filePath, overwrite = false) {
  try {
    const env = await readFile(filePath, "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && (overwrite || !process.env[m[1]])) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  } catch { /* opcional */ }
}
async function loadEnv() {
  const root = join(__dirname, "..");
  await loadEnvFile(join(root, ".env"), false);
  await loadEnvFile(join(root, ".env.local"), true);
}

async function main() {
  await loadEnv();
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  const to = process.argv[2] || process.env.MAIL_REPLY_TO;
  if (!apiKey || !from) { console.error("ERRO: RESEND_API_KEY e MAIL_FROM são obrigatórios."); process.exit(1); }
  if (!to) { console.error("ERRO: passe o destinatário como argumento ou defina MAIL_REPLY_TO."); process.exit(1); }

  const unsubUrl = `${(process.env.APP_BASE_URL ?? "").replace(/\/$/, "")}/api/unsubscribe?test=1`;
  const payload = {
    from,
    to: [to],
    subject: "Teste de entregabilidade — SYSVETMAX",
    text: `Este é um e-mail de teste do subdomínio de envio da esteira comercial.

Se você está lendo isso na caixa de entrada (não no spam) e o "Mostrar original" indica SPF=pass e DKIM=pass, o subdomínio está pronto.

Equipe Sysmax Software
—
Cancelar: ${unsubUrl}`,
    headers: {
      "List-Unsubscribe": `<${unsubUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
  if (process.env.MAIL_REPLY_TO) payload.reply_to = process.env.MAIL_REPLY_TO;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { console.error(`FALHA Resend ${res.status}:`, data); process.exit(1); }
  console.log(`OK — enviado de ${from} para ${to}. Resend id: ${data.id}`);
  console.log(`Abra o e-mail e confira "Mostrar original": SPF=pass, DKIM=pass, DMARC=pass.`);
}

main().catch((e) => { console.error("Erro:", e); process.exit(1); });
