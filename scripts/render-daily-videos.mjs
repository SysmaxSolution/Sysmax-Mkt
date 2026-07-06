// ===========================================================================
// render-daily-videos.mjs — RODA LOCALMENTE (máquina do fundador). Pega os
// roteiros de vídeo do dia (content_calendar, pillar='video'), renderiza cada um
// como um MP4 vertical 1080x1920 (slides do roteiro via Playwright → FFmpeg com
// zoom/fade), sobe pro Supabase Storage e grava a URL em content_calendar.asset_path.
// A aba de Posts do painel passa a mostrar o vídeo pronto para baixar.
//
// Requer: Playwright (chromium) + FFmpeg no PATH. Uso:
//   node scripts/render-daily-videos.mjs            (vídeos de hoje sem asset)
//   node scripts/render-daily-videos.mjs --force    (re-renderiza mesmo com asset)
// ===========================================================================
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
async function loadEnv() {
  for (const [f, ow] of [[".env", false], [".env.local", true]]) {
    try {
      const env = await readFile(join(__dirname, "..", f), "utf8");
      for (const line of env.split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && (ow || !process.env[m[1]])) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
      }
    } catch {}
  }
}
await loadEnv();

const FORCE = process.argv.includes("--force");
const BUCKET = "content";
const db = createClient(process.env.SALES_SUPABASE_URL, process.env.SALES_SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

function ffmpeg(args) {
  return new Promise((res, rej) => {
    const p = spawn("ffmpeg", ["-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => (code === 0 ? res() : rej(new Error("ffmpeg " + code + ": " + err.slice(-400)))));
  });
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Slide vertical 1080x1920, estilo da marca.
function slideHtml({ kicker, title, big, ribbon, footer }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;box-sizing:border-box;font-family:'Segoe UI',system-ui,sans-serif}
  body{width:1080px;height:1920px;overflow:hidden;color:#F3FBF7;
    background:linear-gradient(155deg,#0E7C66 0%,#0A5A4A 60%,#083E34 100%)}
  .wrap{width:100%;height:100%;display:flex;flex-direction:column;justify-content:${big ? "center" : "flex-start"};padding:${big ? "130px" : "230px"} 96px 140px;gap:36px}
  .top{display:flex;justify-content:space-between;align-items:center;position:absolute;top:96px;left:96px;right:96px}
  .brand{font-size:44px;font-weight:800;letter-spacing:3px}
  .handle{font-size:30px;opacity:.85;border:2px solid rgba(255,255,255,.4);border-radius:999px;padding:10px 26px}
  .kicker{font-size:38px;font-weight:700;opacity:.9;text-transform:uppercase;letter-spacing:2px}
  .bar{width:110px;height:10px;background:#F3FBF7;border-radius:8px}
  .title{font-size:${big ? 108 : 76}px;font-weight:800;line-height:1.08}
  .ribbon{align-self:flex-start;background:#F3FBF7;color:#0A5A4A;font-size:46px;font-weight:800;border-radius:20px;padding:26px 40px;margin-top:20px}
  .footer{position:absolute;bottom:110px;left:96px;right:96px;font-size:36px;opacity:.9}
  </style></head><body><div class="wrap">
    <div class="top"><div class="brand">SYSVETMAX</div><div class="handle">@sysvetmax</div></div>
    ${kicker ? `<div class="kicker">${esc(kicker)}</div>` : ""}
    <div class="bar"></div>
    <div class="title">${esc(title)}</div>
    ${ribbon ? `<div class="ribbon">${esc(ribbon)}</div>` : ""}
    ${footer ? `<div class="footer">${esc(footer)}</div>` : ""}
  </div></body></html>`;
}

// Monta a lista de slides a partir do roteiro.
function buildSlides(v) {
  const slides = [];
  slides.push({ kicker: "SYSVETMAX", title: v.hook || v.headline || "O MV fala. A IA escreve.", big: true });
  for (const [i, sc] of (v.scenes ?? []).slice(0, 4).entries()) {
    slides.push({ kicker: `Cena ${i + 1}`, title: sc });
  }
  slides.push({ kicker: v.cta ? "" : "Teste grátis", title: v.cta || "Comece hoje, sem cartão.", ribbon: "Starter R$ 149,90/mês", footer: "Teste grátis 30 dias · migração assistida" });
  return slides;
}

async function renderVideo(browser, item, workDir) {
  let v = {};
  try { v = JSON.parse(item.brief); } catch {}
  const slides = buildSlides(v);
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });

  // 1) screenshot de cada slide
  const pngs = [];
  for (const [i, s] of slides.entries()) {
    await page.setContent(slideHtml(s), { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const png = join(workDir, `slide-${i}.png`);
    await page.screenshot({ path: png, type: "png" });
    pngs.push(png);
  }
  await page.close();

  // 2) cada slide vira um clipe com zoom lento + fade in/out
  const dur = 3.6;
  const clips = [];
  for (const [i, png] of pngs.entries()) {
    const clip = join(workDir, `clip-${i}.mp4`);
    const vf = [
      "scale=1080:1920:force_original_aspect_ratio=increase",
      "crop=1080:1920",
      `fade=t=in:st=0:d=0.4`,
      `fade=t=out:st=${(dur - 0.4).toFixed(2)}:d=0.4`,
      "format=yuv420p",
    ].join(",");
    await ffmpeg(["-loop", "1", "-r", "30", "-i", png, "-t", String(dur), "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", clip]);
    clips.push(clip);
  }

  // 3) concatena os clipes num MP4 final
  const listFile = join(workDir, "list.txt");
  await writeFile(listFile, clips.map((c) => `file '${c.replace(/\\/g, "/")}'`).join("\n"), "utf8");
  const outMp4 = join(workDir, `video-${item.id}.mp4`);
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-movflags", "+faststart", outMp4]);

  // 4) upload + grava a URL
  const buf = await readFile(outMp4);
  const path = `videos/${item.id}.mp4`;
  const up = await db.storage.from(BUCKET).upload(path, buf, { contentType: "video/mp4", upsert: true });
  if (up.error) throw new Error("upload: " + up.error.message);
  const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);
  await db.from("content_calendar").update({ asset_path: pub.publicUrl }).eq("id", item.id);
  return pub.publicUrl;
}

async function main() {
  // garante o bucket público
  const { data: buckets } = await db.storage.listBuckets();
  if (!buckets?.some((b) => b.name === BUCKET)) {
    const { error } = await db.storage.createBucket(BUCKET, { public: true });
    if (error && !/already exists/i.test(error.message)) throw error;
    console.log(`bucket '${BUCKET}' criado (público).`);
  }

  const { data: items } = await db
    .from("content_calendar")
    .select("id,brief,asset_path,scheduled_for,created_at")
    .eq("pillar", "video")
    .order("scheduled_for", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(6);
  const date = items?.[0]?.scheduled_for ?? null;
  const todays = (items ?? []).filter((i) => i.scheduled_for === date && (FORCE || !i.asset_path));
  if (!todays.length) { console.log("Nada a renderizar (sem vídeos do dia ou já renderizados). Use --force para refazer."); return; }
  console.log(`Renderizando ${todays.length} vídeo(s) do lote ${date}…`);

  const browser = await chromium.launch();
  const workRoot = await mkdtemp(join(tmpdir(), "sysmax-vid-"));
  try {
    for (const item of todays) {
      const dir = join(workRoot, item.id);
      await import("node:fs/promises").then((fs) => fs.mkdir(dir, { recursive: true }));
      try {
        const url = await renderVideo(browser, item, dir);
        console.log(`  ✔ ${item.id} → ${url}`);
      } catch (e) {
        console.error(`  ✗ ${item.id}: ${e.message}`);
      }
    }
  } finally {
    await browser.close();
    await rm(workRoot, { recursive: true, force: true }).catch(() => {});
  }
  console.log("Concluído.");
}

main().catch((e) => { console.error("Falha:", e); process.exit(1); });
