import { NextRequest, NextResponse, after } from "next/server";
import { cleanEmail, cleanText, intakeFreeSignup, normalizePhoneBR, safeEqual } from "@/crm/lead-intake";
import { buildLeadAlert, notifyLeadTeam } from "@/lib/lead-alert";

export const runtime = "nodejs";

// ===========================================================================
// POST /api/webhooks/signup — o app (SYSVETMAX) avisa quando uma clínica cria
// conta Free. Autenticado por segredo compartilhado no header x-sysmax-secret
// (SALES_SIGNUP_WEBHOOK_SECRET). Grava o lead com origem 'cadastro_free' e
// avisa Diretor + Jéssica. Não cria opt-in: a abordagem é humana.
// ===========================================================================

export async function POST(req: NextRequest) {
  const secret = process.env.SALES_SIGNUP_WEBHOOK_SECRET;
  const got = req.headers.get("x-sysmax-secret") ?? "";
  if (!secret || !got || !safeEqual(got, secret)) return new NextResponse("unauthorized", { status: 401 });

  const raw = await req.text().catch(() => "");
  if (raw.length > 8_000) return NextResponse.json({ ok: false, error: "requisição muito grande" }, { status: 413 });
  let b: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    b = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "corpo inválido" }, { status: 400 });
  }

  const clinicName = cleanText(b.clinicName, 160);
  const email = cleanEmail(b.email);
  const phoneRaw = cleanText(b.phone, 40);
  const phone = phoneRaw ? normalizePhoneBR(phoneRaw) : null;
  if (!clinicName) return NextResponse.json({ ok: false, error: "clinicName é obrigatório" }, { status: 400 });
  if (!email && !phone) return NextResponse.json({ ok: false, error: "informe e-mail ou telefone válido" }, { status: 400 });

  try {
    const res = await intakeFreeSignup({
      clinicName,
      adminName: cleanText(b.adminName, 120) || null,
      email,
      phone,
      cnpj: cleanText(b.cnpj, 24) || null,
      createdAt: typeof b.createdAt === "string" ? b.createdAt : null,
    });
    if (res.alert) {
      const text = buildLeadAlert(res.alert);
      after(() => notifyLeadTeam(text));
    }
    return NextResponse.json({ ok: true, created: res.created, duplicate: res.duplicate });
  } catch (e) {
    console.error("[signup-webhook] erro:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "falha ao gravar" }, { status: 500 });
  }
}
