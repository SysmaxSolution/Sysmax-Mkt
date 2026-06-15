// Diagnostico da conta/permissoes Meta a partir do META_USER_TOKEN do .env.
//   node scripts/diag-meta.mjs
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GRAPH = `https://graph.facebook.com/${process.env.GRAPH_API_VERSION ?? "v23.0"}`;

const env = {};
for (const line of (await readFile(join(__dirname, "..", ".env"), "utf8")).split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const token = env.META_USER_TOKEN;
const businessId = env.META_BUSINESS_ID ?? "1346527144057460";

async function g(path, params = {}) {
  const url = new URL(`${GRAPH}/${path}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  const data = await res.json();
  return { ok: res.ok && !data.error, data };
}

const me = await g("me", { fields: "id,name" });
console.log("Usuario:", me.data.name ?? "(erro)", "| id", me.data.id ?? me.data.error?.message);

const perms = await g("me/permissions");
console.log("\nPermissoes concedidas:");
for (const p of perms.data.data ?? []) console.log(`  ${p.status === "granted" ? "✓" : "✗"} ${p.permission} (${p.status})`);

const accts = await g("me/accounts", { fields: "id,name,instagram_business_account{id,username}" });
console.log(`\n/me/accounts -> ${accts.data.data?.length ?? 0} pagina(s)`);
for (const p of accts.data.data ?? []) console.log(`  - ${p.name} (${p.id})`);
if (accts.data.error) console.log("  erro:", accts.data.error.message);

const biz = await g("me/businesses", { fields: "id,name" });
console.log(`\n/me/businesses -> ${biz.data.data?.length ?? 0} negocio(s)`);
for (const b of biz.data.data ?? []) console.log(`  - ${b.name} (${b.id})`);
if (biz.data.error) console.log("  erro:", biz.data.error.message);

for (const edge of ["owned_pages", "client_pages"]) {
  const r = await g(`${businessId}/${edge}`, { fields: "id,name,instagram_business_account{id,username}" });
  console.log(`\nbusiness ${businessId}/${edge} -> ${r.data.data?.length ?? 0}`);
  for (const p of r.data.data ?? [])
    console.log(`  - ${p.name} (${p.id})` + (p.instagram_business_account ? ` · IG @${p.instagram_business_account.username}` : ""));
  if (r.data.error) console.log("  erro:", r.data.error.message);
}
