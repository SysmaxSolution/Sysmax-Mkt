// ===========================================================================
// video-tiktok.mjs — monta vídeo vertical (1080x1920) para TikTok a partir de
// uma GRAVAÇÃO REAL do sistema, não de slide de texto.
// ---------------------------------------------------------------------------
// Pedido da captação (16/10/2026): "copy + persuasão + material e informações
// do site", até 1 minuto, ela publica. O material forte que a empresa já tem
// são as 67 gravações de tela da Academia — o sistema funcionando de verdade.
// Slide verde com frase rende pouco; ver a tela acontecendo é a prova.
//
// A gravação é 1280x1000 (paisagem). Em vez de cortar para vertical e perder
// metade da tela, ela entra inteira, centralizada, sobre um fundo da marca:
// chamada em cima, chamada para ação embaixo. O áudio da narração vai junto.
//
// Uso:
//   node scripts/video-tiktok.mjs --aula aula-22-consultorio-voz \
//     --inicio 40 --duracao 45 \
//     --gancho "O prontuário já está pronto quando o tutor sai da sala." \
//     --cta "Comece grátis em sysmaxsolutions.com" \
//     [--saida nome.mp4] [--subir]
//
// --subir publica no bucket 'content' do Supabase e imprime a URL pública.
// Requer Playwright (chromium) + FFmpeg no PATH.
// ===========================================================================
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, "..");
const AULAS = "C:/SysMax/Marketing/screencast/out";
const LIMITE_SEG = 60; // regra dela: nada acima de 1 minuto

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

function arg(nome, padrao = null) {
  const i = process.argv.indexOf(`--${nome}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : padrao;
}

function ffmpeg(args) {
  return new Promise((res, rej) => {
    const p = spawn("ffmpeg", ["-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}: ${err.slice(-500)}`))));
  });
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Fundo da marca com a chamada em cima e o CTA embaixo. O miolo fica livre:
// é onde a gravação entra por cima, via overlay do ffmpeg.
function fundoHtml({ gancho, cta, selo }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;box-sizing:border-box;font-family:'Segoe UI',system-ui,sans-serif}
  body{width:1080px;height:1920px;overflow:hidden;color:#F3FBF7;
       background:linear-gradient(160deg,#0E7C66 0%,#0A5A4A 55%,#083E34 100%)}
  .topo{position:absolute;top:70px;left:70px;right:70px;display:flex;justify-content:space-between;align-items:center}
  .marca{font-size:40px;font-weight:800;letter-spacing:3px}
  .arroba{font-size:28px;opacity:.85;border:2px solid rgba(255,255,255,.38);border-radius:999px;padding:9px 24px}
  .gancho{position:absolute;top:190px;left:70px;right:70px;font-size:66px;font-weight:800;line-height:1.1}
  .selo{position:absolute;top:1430px;left:70px;background:rgba(255,255,255,.14);border:2px solid rgba(255,255,255,.3);
        border-radius:16px;padding:14px 26px;font-size:30px;font-weight:700;letter-spacing:1px}
  .cta{position:absolute;bottom:150px;left:70px;right:70px;font-size:52px;font-weight:800;line-height:1.2}
  .barra{position:absolute;bottom:110px;left:70px;width:120px;height:10px;background:#F3FBF7;border-radius:8px}
  </style></head><body>
    <div class="topo"><div class="marca">SYSVETMAX</div><div class="arroba">@sysvetmax</div></div>
    <div class="gancho">${esc(gancho)}</div>
    ${selo ? `<div class="selo">${esc(selo)}</div>` : ""}
    <div class="cta">${esc(cta)}</div><div class="barra"></div>
  </body></html>`;
}

async function main() {
  await loadEnv();
  const aula = arg("aula");
  if (!aula) throw new Error("informe --aula (nome do arquivo em screencast/out, sem .mp4)");
  const inicio = Number(arg("inicio", "0"));
  const duracao = Math.min(Number(arg("duracao", "45")), LIMITE_SEG);
  const gancho = arg("gancho", "O sistema que cuida da clínica inteira.");
  const cta = arg("cta", "Comece grátis em sysmaxsolutions.com");
  const selo = arg("selo", null);
  const saida = arg("saida", `${aula}-tiktok.mp4`);

  const entrada = join(AULAS, `${aula}.mp4`);
  await stat(entrada); // falha cedo se a aula nao existe


  const tmp = await mkdtemp(join(tmpdir(), "tk-"));
  try {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    await page.setContent(fundoHtml({ gancho, cta, selo }), { waitUntil: "load" });
    const fundo = join(tmp, "fundo.png");
    await page.screenshot({ path: fundo });
    await browser.close();

    // A gravacao entra inteira (sem corte lateral), 1080 de largura, apoiada
    // no miolo livre do fundo. Corte vertical perderia metade da tela.
    const destino = join(RAIZ, "..", "output", saida);
    await ffmpeg([
      "-loop", "1", "-i", fundo,
      "-ss", String(inicio), "-t", String(duracao), "-i", entrada,
      "-filter_complex",
      "[1:v]scale=1020:-2,pad=1040:ih+20:10:10:color=0x0A5A4A[v];" +
      "[0:v][v]overlay=(W-w)/2:560:shortest=1,format=yuv420p[out]",
      "-map", "[out]", "-map", "1:a?",
      "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-r", "30",
      "-c:a", "aac", "-b:a", "128k", "-shortest",
      "-t", String(duracao), destino,
    ]);
    console.log("video:", destino, `(${duracao}s)`);

    if (process.argv.includes("--subir")) {
      const db = createClient(process.env.SALES_SUPABASE_URL, process.env.SALES_SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
      const buf = await readFile(destino);
      const caminho = `videos/tiktok/${saida}`;
      const { error } = await db.storage.from("content").upload(caminho, buf, { contentType: "video/mp4", upsert: true });
      if (error) throw error;
      const { data } = db.storage.from("content").getPublicUrl(caminho);
      console.log("url:", data.publicUrl);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
