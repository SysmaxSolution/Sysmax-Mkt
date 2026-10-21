import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedViewer } from "@/lib/viewer-auth";
import { createInstance, getInstanceQr, getInstanceState } from "@/lib/evolution";
import { getOrCreateWaAccount, setWaAccountStatus } from "@/lib/wa-accounts";
import { cleanText } from "@/crm/lead-intake";

// ===========================================================================
// WhatsApp multi-instancia — pareamento do analista.
// POST: cria (se preciso) a instancia Evolution do analista e devolve o QR.
// GET:  estado atual da conexao (para o painel ficar reconsultando ate conectar).
// ===========================================================================

export const runtime = "nodejs";

function webhookUrl(): string {
  const base = process.env.APP_BASE_URL ?? "https://sysmax-sales-agent.vercel.app";
  return `${base.replace(/\/$/, "")}/api/webhooks/whatsapp-analyst`;
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedViewer(req)) return new NextResponse("unauthorized", { status: 401 });

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const analystName = cleanText(b?.analystName, 60);
  if (!analystName) return NextResponse.json({ ok: false, error: "Nome do analista é obrigatório." }, { status: 400 });

  const account = await getOrCreateWaAccount(analystName);
  try {
    await createInstance(account.evolution_instance_id, webhookUrl());
  } catch (e) {
    return NextResponse.json({ ok: false, error: `Falha ao criar instância: ${(e as Error).message}` }, { status: 500 });
  }
  const qr = await getInstanceQr(account.evolution_instance_id);
  return NextResponse.json({ ok: true, account, qr });
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedViewer(req)) return new NextResponse("unauthorized", { status: 401 });

  const analystName = cleanText(req.nextUrl.searchParams.get("analystName"), 60);
  if (!analystName) return NextResponse.json({ ok: false, error: "Nome do analista é obrigatório." }, { status: 400 });

  const account = await getOrCreateWaAccount(analystName);
  const state = await getInstanceState(account.evolution_instance_id);
  if (state === "open" && account.status !== "connected") {
    await setWaAccountStatus(account.evolution_instance_id, "connected");
  } else if (state === "close" && account.status === "connected") {
    await setWaAccountStatus(account.evolution_instance_id, "disconnected");
  }
  const qr = state !== "open" ? await getInstanceQr(account.evolution_instance_id) : null;
  return NextResponse.json({ ok: true, state, account, qr });
}
