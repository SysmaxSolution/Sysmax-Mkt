import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedViewer } from "@/lib/viewer-auth";
import { salesDb } from "@/lib/supabase";
import { cleanText } from "@/crm/lead-intake";
import { sendText, sendImage } from "@/lib/evolution";
import { salvarFotos } from "@/lib/material-fotos";
import { salvarNumeros } from "@/lib/social-metrics";

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
// Post e recado aceitam FOTO (até 4). Antes a arte era só a gerada pelo
// post-image; desde que o gerador parou, a equipe produz o material fora e a
// foto não tinha porta de entrada — ela mandava no WhatsApp e alguém reanexava
// à mão (pergunta de 2026-10-16). Agora sobe junto do texto.
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
    const r = await salvarNumeros({
      canal: cleanText(b?.canal, 20) || "facebook_pagina",
      dia: cleanText(b?.dia, 10),
      publicacoes: b?.publicacoes,
      alcance: b?.alcance,
      obs: obs ?? (texto || null),
      autor,
      fotos: b?.fotos,
      investimento: b?.investimento,
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.erro }, { status: r.status });
    return NextResponse.json({
      ok: true,
      destino: r.conferir
        ? "Relatório do mês — print guardado, os números saem dele"
        : r.fotos
          ? "Relatório do mês, com o print anexado"
          : "Relatório do mês",
    });
  }

  const fotosEnviadas = Array.isArray(b?.fotos) ? (b.fotos as unknown[]) : [];
  if (!texto && !fotosEnviadas.length) {
    return NextResponse.json({ ok: false, error: "Cole o material no campo ou anexe uma foto." }, { status: 400 });
  }
  if (texto.length > 40_000) return NextResponse.json({ ok: false, error: "Material grande demais. Divida em partes." }, { status: 413 });

  const { caminhos: fotos, erro: erroFoto } = await salvarFotos(fotosEnviadas);
  if (erroFoto) return NextResponse.json({ ok: false, error: erroFoto }, { status: 400 });

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
        // A foto da equipe substitui a arte gerada em "Posts do dia".
        ...(fotos.length ? { fotos } : {}),
      }),
      scheduled_for: hojeISO(),
      status: "approved",
    });
    if (error) return NextResponse.json({ ok: false, error: "Não consegui guardar o post." }, { status: 500 });
    return NextResponse.json({
      ok: true,
      destino: fotos.length
        ? `Posts do dia, com ${fotos.length === 1 ? "a sua foto" : `as suas ${fotos.length} fotos`}`
        : "Posts do dia",
    });
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
    // As fotos vão atrás do texto, uma a uma. Reaproveita o base64 que já
    // chegou na requisição — não precisa baixar de volta do bucket.
    for (const f of fotosEnviadas) {
      if (typeof f !== "string") continue;
      const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(f.trim());
      if (!m) continue;
      try {
        await sendImage(fone, m[2], m[1]);
      } catch (err) {
        console.error("[material] foto do recado não foi ao Diretor:", err instanceof Error ? err.message : err);
      }
    }
  }

  const { error } = await salesDb
    .from("team_notes")
    .insert({ autor, titulo, texto, obs, entregue, fotos: fotos.length ? fotos : null });
  if (error) return NextResponse.json({ ok: false, error: "Não consegui registrar o recado." }, { status: 500 });
  return NextResponse.json({
    ok: true,
    destino: entregue ? "WhatsApp do James" : "registrado no painel (o WhatsApp falhou, o James vê aqui)",
  });
}
