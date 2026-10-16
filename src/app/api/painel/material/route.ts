import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedViewer } from "@/lib/viewer-auth";
import { salesDb } from "@/lib/supabase";
import { cleanText } from "@/crm/lead-intake";
import { sendText } from "@/lib/evolution";

// ===========================================================================
// POST /api/painel/material — porta de entrada única para o material que a
// equipe produz fora do painel.
//
// Proposta da própria captação (2026-10-15): "se já existe a função no painel
// você distribui; se não existe você cria e me avisa". Em vez de ela decidir
// onde cada coisa mora, ela cola num lugar só e diz o que é; o destino é
// responsabilidade daqui.
//
//   post    → content_calendar do dia, e aparece em "Posts do dia"
//   recado  → WhatsApp do Diretor, e fica registrado em team_notes
//   numeros → social_metrics, e entra no relatório do mês
//
// O terceiro tipo existe porque eu tinha quebrado o combinado: criei uma aba
// separada só para lançar números de rede, quando o acordo era ela colar tudo
// AQUI e o destino ser problema meu.
// ===========================================================================

export const runtime = "nodejs";
export const maxDuration = 30;

const TIPOS = ["post", "recado", "numeros"] as const;
type Tipo = (typeof TIPOS)[number];

function hojeISO(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedViewer(req)) return new NextResponse("unauthorized", { status: 401 });

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const tipo = cleanText(b?.tipo, 20) as Tipo;
  const texto = typeof b?.texto === "string" ? b.texto.trim() : "";
  const titulo = cleanText(b?.titulo, 160) || null;
  const obs = cleanText(b?.obs, 2000) || null;
  const autor = cleanText(b?.autor, 60) || "equipe";

  if (!TIPOS.includes(tipo)) return NextResponse.json({ ok: false, error: "Escolha o que é esse material." }, { status: 400 });

  if (tipo === "numeros") {
    const canal = cleanText(b?.canal, 20) || "facebook_pagina";
    const dia = cleanText(b?.dia, 10);
    const publicacoes = Number(b?.publicacoes ?? 0);
    const alcanceBruto = b?.alcance;
    const alcance = alcanceBruto === "" || alcanceBruto === null || alcanceBruto === undefined ? null : Number(alcanceBruto);
    if (!/^(facebook_pagina|facebook_grupos|instagram|outro)$/.test(canal)) {
      return NextResponse.json({ ok: false, error: "Escolha o canal." }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return NextResponse.json({ ok: false, error: "Informe o dia." }, { status: 400 });
    if (!Number.isFinite(publicacoes) || publicacoes < 0 || publicacoes > 10_000) {
      return NextResponse.json({ ok: false, error: "Número de publicações inválido." }, { status: 400 });
    }
    if (alcance !== null && (!Number.isFinite(alcance) || alcance < 0)) {
      return NextResponse.json({ ok: false, error: "Alcance inválido." }, { status: 400 });
    }
    const { error } = await salesDb.from("social_metrics").upsert(
      {
        canal, dia,
        publicacoes: Math.trunc(publicacoes),
        alcance: alcance === null ? null : Math.trunc(alcance),
        obs: obs ?? (texto || null),
        autor,
      },
      { onConflict: "canal,dia" },
    );
    if (error) return NextResponse.json({ ok: false, error: "Não consegui salvar os números." }, { status: 500 });
    return NextResponse.json({ ok: true, destino: "Relatório do mês" });
  }

  if (!texto) return NextResponse.json({ ok: false, error: "Cole o material no campo." }, { status: 400 });
  if (texto.length > 40_000) return NextResponse.json({ ok: false, error: "Material grande demais. Divida em partes." }, { status: 413 });

  if (tipo === "post") {
    // Entra no lote de HOJE para aparecer no topo de "Posts do dia" — o lote
    // gerado automaticamente está parado desde ago/2026.
    const { error } = await salesDb.from("content_calendar").insert({
      pillar: "post",
      format: "feed",
      // platform é obrigatório e restrito; o Facebook é onde a equipe publica.
      platform: "facebook",
      brief: JSON.stringify({
        headline: titulo ?? "Post da equipe",
        caption: texto,
        origem: `enviado por ${autor} pelo painel`,
        ...(obs ? { observacao: obs } : {}),
      }),
      scheduled_for: hojeISO(),
      status: "approved",
    });
    if (error) return NextResponse.json({ ok: false, error: "Não consegui guardar o post." }, { status: 500 });
    return NextResponse.json({ ok: true, destino: "Posts do dia" });
  }

  // recado — chega no WhatsApp do Diretor e fica registrado em team_notes.
  // Não cabe em content_calendar: lá platform é obrigatório e só aceita rede
  // social, e recado não é conteúdo de publicação.
  const fone = process.env.FOUNDER_WHATSAPP_PHONE;
  let entregue = false;
  if (fone) {
    const corpo = `*Recado do painel — ${autor}*${titulo ? `\n_${titulo}_` : ""}\n\n${texto}${obs ? `\n\nObs: ${obs}` : ""}`;
    try {
      await sendText(fone, corpo.slice(0, 3500));
      entregue = true;
    } catch (err) {
      // O recado é gravado de qualquer forma, mas a falha não pode sumir:
      // sem log, "o WhatsApp falhou" vira um mistério na próxima vez.
      console.error("[material] WhatsApp ao Diretor falhou:", err instanceof Error ? err.message : err);
    }
  }

  const { error } = await salesDb.from("team_notes").insert({ autor, titulo, texto, obs, entregue });
  if (error) return NextResponse.json({ ok: false, error: "Não consegui registrar o recado." }, { status: 500 });
  return NextResponse.json({
    ok: true,
    destino: entregue ? "WhatsApp do James" : "registrado no painel (o WhatsApp falhou, o James vê aqui)",
  });
}
