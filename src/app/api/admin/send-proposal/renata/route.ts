import { NextRequest, NextResponse } from "next/server";
import { sendText, fetchContactByLid } from "@/lib/evolution";

export const runtime = "nodejs";

// Proposta aprovada pelo conselho LLM em 2026-06-22.
const PROPOSAL_MESSAGE = `Renata, boa tarde!

Tenho sua proposta pronta.

O SYSVETMAX Starter sai por R$ 189/mês: prontuário por voz com IA (você fala, o sistema preenche), recepção, triagem, farmácia, WhatsApp IA para seus tutores e todos os módulos clínicos. Nada disso existe no SimplesVet.

Para NFS-e: mais R$ 49/mês e você nunca mais precisa entrar no site da prefeitura — a nota sai automática após cada consulta.

Total: R$ 238/mês versus os R$ 400 que você paga hoje. 40% mais barato, com IA integrada.

Primeiro mês gratuito, sem compromisso. Seus dados são sempre seus.

Uma pergunta antes de fechar: como você emite NFS-e hoje — é pelo site da prefeitura ou tem algum sistema?`;

// @lid capturado via Evolution API em 2026-06-22 na conversa com Renata Perufo.
const RENATA_LID = "116204836507873@lid";

export async function POST(request: NextRequest) {
  const token = request.headers.get("x-admin-token");
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  // Aceita override via body { phone: "5519..." }
  let phone: string | null = null;
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.phone) phone = String(body.phone);
  } catch { /* noop */ }

  // Tenta resolver via @lid se não veio override
  if (!phone) {
    phone = await fetchContactByLid(RENATA_LID);
  }

  // Fallback: variável de ambiente configurável manualmente
  if (!phone) {
    phone = process.env.RENATA_WHATSAPP_PHONE ?? null;
  }

  if (!phone) {
    return NextResponse.json(
      { error: "Não foi possível resolver o número da Renata. Configure RENATA_WHATSAPP_PHONE ou passe { phone } no body." },
      { status: 422 }
    );
  }

  try {
    await sendText(phone, PROPOSAL_MESSAGE);
    return NextResponse.json({ ok: true, sentTo: phone });
  } catch (err) {
    console.error("[send-renata] erro ao enviar:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
