// ===========================================================================
// fetch-meta-ids.mjs — descobre e grava no .env os IDs/tokens da Meta
// ---------------------------------------------------------------------------
// Dado META_APP_ID, META_APP_SECRET e um META_USER_TOKEN (gerado no Graph API
// Explorer), este script:
//   1. troca o token de usuario por um de LONGA duracao;
//   2. lista as Paginas do usuario e seus Page Access Tokens (long-lived);
//   3. resolve a conta profissional do Instagram vinculada a Pagina;
//   4. grava META_PAGE_ID, META_PAGE_ACCESS_TOKEN e IG_BUSINESS_ACCOUNT_ID no .env.
//
// Uso:  node scripts/fetch-meta-ids.mjs
// Depois de rodar, APAGUE o META_USER_TOKEN do .env (ja cumpriu o papel).
// ===========================================================================
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, "..", ".env");
const GRAPH = `https://graph.facebook.com/${process.env.GRAPH_API_VERSION ?? "v23.0"}`;

function parseEnv(text) {
  const map = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) map[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  return map;
}

// Atualiza/insere uma chave preservando o resto do arquivo.
function upsertEnv(text, key, value) {
  const re = new RegExp(`(?m)^${key}=.*$`);
  if (re.test(text)) return text.replace(re, `${key}=${value}`);
  return text.trimEnd() + `\n${key}=${value}\n`;
}

async function gget(path, params) {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Graph ${path}: ${data.error?.message ?? res.status}`);
  }
  return data;
}

const mask = (s) => (s ? `${s.slice(0, 6)}…${s.slice(-4)} (${s.length} chars)` : "(vazio)");

async function main() {
  const raw = await readFile(ENV_PATH, "utf8");
  const env = parseEnv(raw);
  const appId = env.META_APP_ID;
  const appSecret = env.META_APP_SECRET;
  const userToken = env.META_USER_TOKEN;

  if (!appId || !appSecret || !userToken) {
    console.error("Faltam META_APP_ID, META_APP_SECRET ou META_USER_TOKEN no .env.");
    process.exit(1);
  }

  // 1) long-lived user token
  console.log("→ trocando por token de longa duracao…");
  const ll = await gget("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: userToken,
  });
  const longUser = ll.access_token;

  // 2) paginas + page tokens
  console.log("→ listando Paginas…");
  const pages = await gget("me/accounts", {
    fields: "id,name,access_token,instagram_business_account{id,username}",
    access_token: longUser,
  });
  const list = pages.data ?? [];
  if (list.length === 0) {
    console.error("Nenhuma Pagina retornada. Garanta as permissoes pages_show_list/pages_manage_metadata.");
    process.exit(1);
  }

  console.log("\nPaginas encontradas:");
  list.forEach((p, i) =>
    console.log(`  [${i}] ${p.name} (id ${p.id})` + (p.instagram_business_account ? ` · IG @${p.instagram_business_account.username}` : " · sem IG vinculado")),
  );

  // Escolhe a primeira (ou a indicada por PAGE_INDEX).
  const idx = Number(process.env.PAGE_INDEX ?? 0);
  const page = list[idx] ?? list[0];

  let text = raw;
  text = upsertEnv(text, "META_PAGE_ID", page.id);
  text = upsertEnv(text, "META_PAGE_ACCESS_TOKEN", page.access_token);
  if (page.instagram_business_account?.id) {
    text = upsertEnv(text, "IG_BUSINESS_ACCOUNT_ID", page.instagram_business_account.id);
  }
  await writeFile(ENV_PATH, text, "utf8");

  console.log(`\n✓ Gravado no .env para a Pagina "${page.name}":`);
  console.log("  META_PAGE_ID          =", page.id);
  console.log("  META_PAGE_ACCESS_TOKEN=", mask(page.access_token));
  console.log("  IG_BUSINESS_ACCOUNT_ID=", page.instagram_business_account?.id ?? "(nenhum — vincule o IG a esta Pagina)");
  console.log("\nFeito. Agora APAGUE a linha META_USER_TOKEN do .env.");
}

main().catch((err) => {
  console.error("Falha:", err.message);
  process.exit(1);
});
