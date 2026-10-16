import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedViewer } from "@/lib/viewer-auth";
import { salesDb } from "@/lib/supabase";
import { cleanText } from "@/crm/lead-intake";

// ===========================================================================
// Relatório MENSAL — ideia da captação (2026-10-15): acumular o que foi feito
// mês a mês para, quando houver orçamento, saber ONDE investir em vez de
// apostar. "vamos descobrir onde investir qdo chegar o dinheiro".
//
// GET  → consolidado do mês: envios por canal, clínicas novas, respostas,
//        publicações/alcance de redes e o funil.
// POST → lança publicações e alcance de rede social (o painel não mede isso
//        sozinho; só quem publica tem o número).
// ===========================================================================

export const runtime = "nodejs";

const CANAIS = ["facebook_pagina", "facebook_grupos", "instagram", "outro"] as const;

const LABEL: Record<string, string> = {
  email: "E-mails enviados",
  whatsapp: "WhatsApp",
  call: "Ligações",
  ig_dm: "Instagram DM",
};

const CANAL_LABEL: Record<string, string> = {
  facebook_pagina: "Facebook — página",
  facebook_grupos: "Facebook — grupos",
  instagram: "Instagram",
  outro: "Outro",
};

// Mês no formato AAAA-MM; devolve o primeiro dia e o primeiro dia do mês seguinte.
function janela(mes: string): { de: string; ate: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(mes);
  if (!m) return null;
  const ano = Number(m[1]);
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) return null;
  const de = new Date(Date.UTC(ano, mm - 1, 1));
  const ate = new Date(Date.UTC(mm === 12 ? ano + 1 : ano, mm === 12 ? 0 : mm, 1));
  return { de: de.toISOString(), ate: ate.toISOString() };
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedViewer(req)) return new NextResponse("unauthorized", { status: 401 });

  const hoje = new Date();
  const padrao = `${hoje.getUTCFullYear()}-${String(hoje.getUTCMonth() + 1).padStart(2, "0")}`;
  const mes = req.nextUrl.searchParams.get("mes") ?? padrao;
  const j = janela(mes);
  if (!j) return NextResponse.json({ ok: false, error: "Mês inválido. Use AAAA-MM." }, { status: 400 });

  const [enviosRes, novasRes, socialRes, funilRes] = await Promise.all([
    salesDb.from("outbox").select("channel,approved_by").eq("status", "sent").gte("sent_at", j.de).lt("sent_at", j.ate),
    salesDb.from("leads").select("id,country").eq("source", "manual").gte("discovered_at", j.de).lt("discovered_at", j.ate),
    salesDb.from("social_metrics").select("canal,publicacoes,alcance,dia").gte("dia", j.de.slice(0, 10)).lt("dia", j.ate.slice(0, 10)),
    salesDb.from("leads").select("stage").gte("qualified_at", j.de).lt("qualified_at", j.ate),
  ]);

  const envios = (enviosRes.data ?? []) as { channel: string; approved_by: string | null }[];
  const porCanal: Record<string, number> = {};
  const porPessoa: Record<string, number> = {};
  for (const e of envios) {
    porCanal[e.channel] = (porCanal[e.channel] ?? 0) + 1;
    const quem = e.approved_by ?? "não identificado";
    porPessoa[quem] = (porPessoa[quem] ?? 0) + 1;
  }

  const novas = (novasRes.data ?? []) as { country: string | null }[];
  const porPais: Record<string, number> = {};
  for (const n of novas) porPais[n.country ?? "?"] = (porPais[n.country ?? "?"] ?? 0) + 1;

  const social = (socialRes.data ?? []) as { canal: string; publicacoes: number; alcance: number | null }[];
  const redes: Record<string, { publicacoes: number; alcance: number }> = {};
  for (const s of social) {
    const r = (redes[s.canal] ??= { publicacoes: 0, alcance: 0 });
    r.publicacoes += s.publicacoes;
    r.alcance += s.alcance ?? 0;
  }

  const responderam = (funilRes.data ?? []).length;
  const totalEnvios = envios.length;

  return NextResponse.json({
    ok: true,
    mes,
    envios: Object.entries(porCanal).map(([ch, n]) => ({ canal: LABEL[ch] ?? ch, total: n })),
    totalEnvios,
    porPessoa: Object.entries(porPessoa).map(([quem, n]) => ({ quem, total: n })),
    clinicasNovas: novas.length,
    porPais: Object.entries(porPais).map(([pais, n]) => ({ pais, total: n })),
    redes: Object.entries(redes).map(([canal, v]) => ({
      canal: CANAL_LABEL[canal] ?? canal,
      publicacoes: v.publicacoes,
      alcance: v.alcance,
    })),
    responderam,
    // Taxa de resposta sobre o que saiu no mês. Comparar canais é o objetivo:
    // é esse número que diz onde o dinheiro rende mais.
    taxaResposta: totalEnvios > 0 ? Math.round((responderam / totalEnvios) * 1000) / 10 : null,
  });
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedViewer(req)) return new NextResponse("unauthorized", { status: 401 });

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const canal = cleanText(b?.canal, 20);
  const dia = cleanText(b?.dia, 10);
  const publicacoes = Number(b?.publicacoes ?? 0);
  const alcanceBruto = b?.alcance;
  const alcance = alcanceBruto === "" || alcanceBruto === null || alcanceBruto === undefined ? null : Number(alcanceBruto);

  if (!CANAIS.includes(canal as (typeof CANAIS)[number])) {
    return NextResponse.json({ ok: false, error: "Escolha o canal." }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
    return NextResponse.json({ ok: false, error: "Informe o dia." }, { status: 400 });
  }
  if (!Number.isFinite(publicacoes) || publicacoes < 0 || publicacoes > 10_000) {
    return NextResponse.json({ ok: false, error: "Número de publicações inválido." }, { status: 400 });
  }
  if (alcance !== null && (!Number.isFinite(alcance) || alcance < 0)) {
    return NextResponse.json({ ok: false, error: "Alcance inválido." }, { status: 400 });
  }

  // Um registro por canal/dia: relançar o mesmo dia corrige o número anterior
  // em vez de somar duas vezes.
  const { error } = await salesDb.from("social_metrics").upsert(
    {
      canal, dia,
      publicacoes: Math.trunc(publicacoes),
      alcance: alcance === null ? null : Math.trunc(alcance),
      obs: cleanText(b?.obs, 500) || null,
      autor: cleanText(b?.autor, 60) || "equipe",
    },
    { onConflict: "canal,dia" },
  );
  if (error) return NextResponse.json({ ok: false, error: "Não consegui salvar os números." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
