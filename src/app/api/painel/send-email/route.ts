import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedViewer } from "@/lib/viewer-auth";
import { salesDb } from "@/lib/supabase";
import { sendEmail } from "@/lib/mailer";
import { isSuppressed } from "@/lib/suppression";
import { emailQuotaToday } from "@/lib/send-quota";
import { diaDeTrabalho } from "@/lib/agenda-br";

// ===========================================================================
// POST /api/painel/send-email — a equipe comercial dispara o e-mail direto do
// painel (decisão do Diretor 2026-10-15: a aprovação prévia dele deixa de ser
// exigida para este caminho). O que NÃO cai junto com a aprovação:
//   - suppression list e opted_out  (LGPD, não é política interna)
//   - opt-out + List-Unsubscribe no corpo (aplicados dentro de sendEmail)
//   - cota diária de aquecimento, compartilhada com o worker (send-quota)
//   - registro na outbox, para o Diretor auditar o que foi enviado e por quem
// ===========================================================================

export const runtime = "nodejs";
export const maxDuration = 30;

type Body = { leadId?: string; subject?: string; body?: string; sender?: string; teste?: boolean };

export async function POST(req: NextRequest) {
  if (!isAuthorizedViewer(req)) return new NextResponse("unauthorized", { status: 401 });

  const p = (await req.json().catch(() => null)) as Body | null;
  let leadId = p?.leadId?.trim();

  // No teste a clínica não importa: o destino é a própria equipe. Se vier sem
  // leadId (teste solto, fora de qualquer cartão), escolhemos um lead com
  // e-mail só para o link de descadastro sair igual ao real.
  if (p?.teste === true && !leadId) {
    const { data: qualquer } = await salesDb
      .from("leads").select("id").not("email", "is", null).limit(1).maybeSingle();
    leadId = qualquer?.id;
  }
  const subject = p?.subject?.trim();
  const body = p?.body?.trim();
  if (!leadId || !subject || !body) {
    return NextResponse.json({ ok: false, error: "Preencha o assunto e o texto do e-mail." }, { status: 400 });
  }
  if (subject.length > 200) {
    return NextResponse.json({ ok: false, error: "O assunto ficou longo demais (máximo 200 caracteres)." }, { status: 400 });
  }
  // Regra geral dela (16/10): "clinicas + e-mail SOMENTE 2a a 6a feira. NAO
  // enviar nada (...) em feriado, de jeito nenhum." Vale para o disparo manual
  // do painel; rede social nao passa por aqui.
  const dia = diaDeTrabalho(new Date());
  if (!dia.ok) return NextResponse.json({ ok: false, error: dia.erro }, { status: 400 });

  if (body.length > 20_000) {
    return NextResponse.json({ ok: false, error: "O texto ficou longo demais." }, { status: 400 });
  }

  // ENVIO DE TESTE: manda a mesma mensagem para o e-mail da equipe, nunca para
  // a clinica. Pedido dela em 16/10 -- ela queria ver como a mensagem CHEGA
  // (formatacao, tamanho, se ficou pesada) e nao tinha como, porque todo envio
  // ia direto para o prospecto. Ninguem nunca tinha visto o e-mail frio do
  // lado de quem recebe.
  //
  // Nao mexe no lead, nao gera registro em outbox e nao consome a cota do
  // dominio: nao e prospeccao, e conferencia. O destino e fixo no ambiente,
  // para o teste nunca virar porta de envio para endereco arbitrario.
  if (p?.teste === true) {
    const destino = (process.env.TEAM_TEST_EMAIL ?? "sysvetmax@gmail.com").trim();
    try {
      const r = await sendEmail({ to: destino, subject: `[TESTE] ${subject}`, text: body, leadId });
      // leadId vai junto de proposito: assim o link de descadastro sai igual
      // ao real e ela ve a mensagem exatamente como a clinica veria.
      if (r.skipped) {
        return NextResponse.json({ ok: false, error: "O e-mail de teste esta na lista de opt-out." }, { status: 422 });
      }
      return NextResponse.json({ ok: true, teste: true, to: destino });
    } catch {
      return NextResponse.json({ ok: false, error: "Nao consegui enviar o teste." }, { status: 502 });
    }
  }

  const { data: lead, error: leadErr } = await salesDb
    .from("leads")
    .select("id,email,opted_out,stage,company_name")
    .eq("id", leadId)
    .maybeSingle();
  if (leadErr) return NextResponse.json({ ok: false, error: "Não consegui ler o cadastro da clínica." }, { status: 500 });
  if (!lead) return NextResponse.json({ ok: false, error: "Clínica não encontrada." }, { status: 404 });
  if (!lead.email) return NextResponse.json({ ok: false, error: "Essa clínica não tem e-mail cadastrado. Use o WhatsApp." }, { status: 422 });
  if (lead.opted_out) {
    return NextResponse.json({ ok: false, error: "Essa clínica pediu para não receber mais contato. Não podemos enviar." }, { status: 422 });
  }
  if (await isSuppressed("email", lead.email)) {
    return NextResponse.json({ ok: false, error: "Esse e-mail está na lista de quem pediu para sair. Não podemos enviar." }, { status: 422 });
  }

  const quota = await emailQuotaToday();
  if (quota.remaining <= 0) {
    return NextResponse.json({
      ok: false,
      error: `O limite de ${quota.cap} e-mails de hoje já foi usado. Isso protege nosso domínio de cair em spam — amanhã o limite volta. Use o WhatsApp no resto do dia.`,
      quota,
    }, { status: 429 });
  }

  // Grava ANTES de enviar: se o provedor falhar, fica o registro da tentativa.
  const { data: item, error: insErr } = await salesDb
    .from("outbox")
    .insert({
      lead_id: leadId,
      channel: "email",
      subject,
      body,
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: p?.sender?.trim() || "painel",
      scheduled_for: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (insErr || !item) {
    return NextResponse.json({ ok: false, error: "Não consegui registrar o envio. Tente de novo." }, { status: 500 });
  }

  try {
    const r = await sendEmail({ to: lead.email, subject, text: body, leadId });
    if (r.skipped) {
      await salesDb.from("outbox").update({ status: "rejected", error: r.reason }).eq("id", item.id);
      return NextResponse.json({ ok: false, error: "Envio bloqueado pela lista de opt-out." }, { status: 422 });
    }
    await salesDb
      .from("outbox")
      .update({ status: "sent", sent_at: new Date().toISOString(), provider_msg_id: r.id })
      .eq("id", item.id);

    const patch: Record<string, unknown> = { last_contact_at: new Date().toISOString() };
    if (lead.stage === "new") patch.stage = "engaged";
    await salesDb.from("leads").update(patch).eq("id", leadId);

    const after = await emailQuotaToday();
    return NextResponse.json({ ok: true, to: lead.email, clinic: lead.company_name, quota: after });
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    await salesDb.from("outbox").update({ status: "failed", error: raw }).eq("id", item.id);
    // Traduz as falhas de infraestrutura que a equipe não tem como resolver.
    const friendly = /API key is invalid|401/.test(raw)
      ? "O serviço de envio recusou nossa chave de acesso. Avise o James: a chave do Resend precisa ser renovada."
      : /opt-out|APP_BASE_URL/.test(raw)
        ? "Falta uma configuração do link de descadastro. Avise o James."
        : "O envio falhou agora. Tente de novo; se persistir, avise o James.";
    return NextResponse.json({ ok: false, error: friendly, detail: raw }, { status: 502 });
  }
}

// GET — quanto ainda pode ser enviado hoje (o painel mostra na tela).
export async function GET(req: NextRequest) {
  if (!isAuthorizedViewer(req)) return new NextResponse("unauthorized", { status: 401 });
  return NextResponse.json({ ok: true, quota: await emailQuotaToday() });
}
