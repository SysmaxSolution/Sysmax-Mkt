import { NextRequest, NextResponse, after } from "next/server";
import {
  cleanEmail, cleanRef, cleanText, hashIp, intakeSiteForm, normalizePhoneBR, takeRateSlot,
} from "@/crm/lead-intake";
import { buildLeadAlert, notifyLeadTeam } from "@/lib/lead-alert";

export const runtime = "nodejs";

// ===========================================================================
// POST /api/public/lead — formulário "Quero uma demonstração" do site.
// Pública, mas só aceita navegador vindo de sysmaxsolutions.com (CORS), exige
// consentimento explícito, descarta bots pelo honeypot `website` e limita a
// 5 envios/hora por IP (guarda só o hash). O contato com o lead é humano.
// ===========================================================================

const BASE_ORIGINS = ["https://sysmaxsolutions.com", "https://www.sysmaxsolutions.com"];

function allowedOrigins(): string[] {
  const extra = (process.env.PUBLIC_LEAD_EXTRA_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return [...BASE_ORIGINS, ...extra];
}

function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && allowedOrigins().includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function reply(body: Record<string, unknown>, status: number, origin: string | null) {
  return NextResponse.json(body, { status, headers: corsHeaders(origin) });
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && !allowedOrigins().includes(origin)) return new NextResponse(null, { status: 403 });
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  // Navegador de outro site: recusa. Chamadas sem Origin (servidor/curl) passam
  // pelas mesmas validações e pelo rate limit.
  if (origin && !allowedOrigins().includes(origin)) {
    return reply({ ok: false, error: "origem não permitida" }, 403, null);
  }

  const raw = await req.text().catch(() => "");
  if (raw.length > 8_000) return reply({ ok: false, error: "requisição muito grande" }, 413, origin);
  let b: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    b = parsed as Record<string, unknown>;
  } catch {
    return reply({ ok: false, error: "corpo inválido" }, 400, origin);
  }

  // Honeypot: campo invisível ao humano. Preenchido = robô → finge sucesso, não grava.
  if (typeof b.website === "string" && b.website.trim() !== "") return reply({ ok: true }, 200, origin);

  if (b.consent !== true) {
    return reply({ ok: false, error: "É preciso aceitar ser contatado para enviar o pedido." }, 400, origin);
  }
  const name = cleanText(b.name, 120);
  const clinic = cleanText(b.clinic, 160);
  const phone = normalizePhoneBR(typeof b.phone === "string" ? b.phone : "");
  if (name.length < 2) return reply({ ok: false, error: "Informe seu nome." }, 400, origin);
  if (clinic.length < 2) return reply({ ok: false, error: "Informe o nome da clínica." }, 400, origin);
  if (!phone) return reply({ ok: false, error: "Informe um telefone com DDD." }, 400, origin);
  const emailRaw = cleanText(b.email, 160);
  const email = cleanEmail(emailRaw);
  if (emailRaw && !email) return reply({ ok: false, error: "E-mail inválido." }, 400, origin);

  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = fwd || req.headers.get("x-real-ip") || "desconhecido";
  try {
    if (!(await takeRateSlot(hashIp(ip)))) {
      return reply({ ok: false, error: "Muitos envios seguidos. Tente de novo mais tarde ou chame no WhatsApp." }, 429, origin);
    }
    const res = await intakeSiteForm({
      name,
      clinic,
      phone,
      email,
      city: cleanText(b.city, 80) || null,
      message: cleanText(b.message, 1000) || null,
      ref: cleanRef(b.ref),
      page: cleanText(b.page, 120) || null,
    });
    if (res.alert) {
      const text = buildLeadAlert(res.alert);
      after(() => notifyLeadTeam(text));
    }
    return reply({ ok: true }, 200, origin);
  } catch (e) {
    console.error("[public-lead] erro:", e instanceof Error ? e.message : e);
    return reply({ ok: false, error: "Não foi possível enviar agora. Chame no WhatsApp que a gente atende." }, 500, origin);
  }
}
