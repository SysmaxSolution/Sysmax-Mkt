// ===========================================================================
// carrossel-tiktok.mjs — gera as FOTOS de um carrossel para o TikTok.
// ---------------------------------------------------------------------------
// A captação avisou (16/10): o TikTok passou a aceitar foto além de vídeo, e
// a foto fica parada como slide — "se quiser caprichar nas fotos trazendo
// bastante informação vai ser ótimo". Foto parada aguenta texto que vídeo de
// 45 segundos não aguenta: é o formato para ensinar, não só para mostrar.
//
// Entrada: um JSON com { nome, slides: [{ kicker, titulo, texto, ribbon }] }.
// Saída: PNG 1080x1920 por slide, numerados na ordem de publicação, e as URLs
// públicas quando passar --subir.
//
// Uso:  node scripts/carrossel-tiktok.mjs caminho/do/carrossel.json [--subir]
// Requer Playwright (chromium).
// ===========================================================================
import { chromium } from "playwright";
import { readFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, "..");
const SAIDA = join(RAIZ, "..", "output", "carrossel");

async function loadEnv() {
  for (const [f, ow] of [[".env", false], [".env.local", true]]) {
    try {
      const env = await readFile(join(RAIZ, f), "utf8");
      for (const line of env.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && (ow || !process.env[m[1]])) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "").trim();
      }
    } catch { /* opcional */ }
  }
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Capa tem o título grande e centralizado; os slides de conteúdo têm o número
// da vez no alto, porque em carrossel o leitor precisa saber onde está.
function html({ kicker, titulo, texto, ribbon, n, total, capa }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;box-sizing:border-box;font-family:'Segoe UI',system-ui,sans-serif}
  body{width:1080px;height:1920px;overflow:hidden;color:#F3FBF7;
       background:linear-gradient(160deg,#0E7C66 0%,#0A5A4A 55%,#083E34 100%)}
  .topo{position:absolute;top:70px;left:70px;right:70px;display:flex;justify-content:space-between;align-items:center}
  .marca{font-size:38px;font-weight:800;letter-spacing:3px}
  .passo{font-size:30px;opacity:.85;border:2px solid rgba(255,255,255,.38);border-radius:999px;padding:9px 24px}
  /* Centralizado na vertical: texto curto encostado no alto deixava meia
     tela vazia, e em carrossel o olho vai para o meio da foto. */
  .corpo{position:absolute;left:80px;right:80px;top:200px;bottom:220px;display:flex;flex-direction:column;justify-content:center;gap:34px}
  .kicker{font-size:36px;font-weight:700;opacity:.9;letter-spacing:1px}
  .barra{width:120px;height:10px;background:#F3FBF7;border-radius:8px}
  .titulo{font-size:${capa ? 104 : 80}px;font-weight:800;line-height:1.08}
  .texto{font-size:44px;line-height:1.42;opacity:.94}
  .ribbon{align-self:flex-start;background:#F3FBF7;color:#0A5A4A;font-size:42px;font-weight:800;border-radius:18px;padding:22px 34px}
  .rodape{position:absolute;bottom:110px;left:80px;right:80px;font-size:34px;opacity:.9}
  </style></head><body>
    <div class="topo"><div class="marca">SYSVETMAX</div>
      <div class="passo">${capa ? "@sysvetmax" : `${n} de ${total}`}</div></div>
    <div class="corpo">
      ${kicker ? `<div class="kicker">${esc(kicker)}</div>` : ""}
      <div class="barra"></div>
      <div class="titulo">${esc(titulo)}</div>
      ${texto ? `<div class="texto">${esc(texto)}</div>` : ""}
      ${ribbon ? `<div class="ribbon">${esc(ribbon)}</div>` : ""}
    </div>
    <div class="rodape">sysmaxsolutions.com</div>
  </body></html>`;
}

async function main() {
  await loadEnv();
  const arquivo = process.argv[2];
  if (!arquivo) throw new Error("informe o caminho do JSON do carrossel");
  const def = JSON.parse(await readFile(arquivo, "utf8"));
  const slides = def.slides ?? [];
  if (!slides.length) throw new Error("o JSON não tem slides");

  const pasta = join(SAIDA, def.nome);
  await mkdir(pasta, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  const caminhos = [];
  for (const [i, s] of slides.entries()) {
    await page.setContent(html({ ...s, n: i + 1, total: slides.length, capa: i === 0 }), { waitUntil: "load" });
    // Numeração com zero à esquerda: a ordem dos arquivos É a ordem em que ela
    // vai subir no TikTok. "slide-10" antes de "slide-2" estragaria a sequência.
    const p = join(pasta, `${String(i + 1).padStart(2, "0")}.png`);
    await page.screenshot({ path: p });
    caminhos.push(p);
  }
  await browser.close();
  console.log(`${caminhos.length} slide(s) em ${pasta}`);

  if (process.argv.includes("--subir")) {
    const db = createClient(process.env.SALES_SUPABASE_URL, process.env.SALES_SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
    for (const [i, p] of caminhos.entries()) {
      const buf = await readFile(p);
      const destino = `carrossel/${def.nome}/${String(i + 1).padStart(2, "0")}.png`;
      const { error } = await db.storage.from("content").upload(destino, buf, { contentType: "image/png", upsert: true });
      if (error) { console.error(destino, error.message); continue; }
      console.log(db.storage.from("content").getPublicUrl(destino).data.publicUrl);
    }
  }
}

main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
