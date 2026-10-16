import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedViewer } from "@/lib/viewer-auth";
import { salesDb } from "@/lib/supabase";
import { cleanText } from "@/crm/lead-intake";
import { salvarNumeros } from "@/lib/social-metrics";

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

  const [enviosRes, novasRes, socialRes, funilRes, cliquesRes] = await Promise.all([
    salesDb.from("outbox").select("channel,approved_by").eq("status", "sent").gte("sent_at", j.de).lt("sent_at", j.ate),
    salesDb.from("leads").select("id,country").eq("source", "manual").gte("discovered_at", j.de).lt("discovered_at", j.ate),
    salesDb.from("social_metrics").select("canal,publicacoes,alcance,dia,fotos,conferir,investimento_centavos").gte("dia", j.de.slice(0, 10)).lt("dia", j.ate.slice(0, 10)).order("dia", { ascending: false }),
    salesDb.from("leads").select("stage").gte("qualified_at", j.de).lt("qualified_at", j.ate),
    salesDb.from("link_clicks").select("campanha").gte("dia", j.de.slice(0, 10)).lt("dia", j.ate.slice(0, 10)),
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

  type Social = { canal: string; publicacoes: number | null; alcance: number | null; dia: string; fotos: string[] | null; conferir: boolean | null; investimento_centavos: number | null };
  const social = (socialRes.data ?? []) as Social[];
  const redes: Record<string, { publicacoes: number; alcance: number; investido: number }> = {};
  for (const s of social) {
    const r = (redes[s.canal] ??= { publicacoes: 0, alcance: 0, investido: 0 });
    r.publicacoes += s.publicacoes ?? 0;
    r.alcance += s.alcance ?? 0;
    r.investido += s.investimento_centavos ?? 0;
  }

  // Trafego pago: so faz sentido olhar o gasto ao lado do que ele trouxe.
  // A pergunta da captacao em 16/10 foi exatamente essa — "vale a pena
  // investir?" — e sem as duas pontas juntas a resposta e chute.
  const investidoCentavos = social.reduce((t, s) => t + (s.investimento_centavos ?? 0), 0);
  const alcanceTotal = social.reduce((t, s) => t + (s.alcance ?? 0), 0);

  // Prints anexados: ficam à vista para conferir o número contra a fonte, e os
  // dias ainda sem número aparecem marcados em vez de somar zero calado.
  const prints = social
    .filter((s) => (s.fotos ?? []).length)
    .map((s) => ({
      canal: CANAL_LABEL[s.canal] ?? s.canal,
      dia: s.dia,
      fotos: s.fotos ?? [],
      conferir: !!s.conferir,
      publicacoes: s.publicacoes,
      alcance: s.alcance,
    }));

  // Cliques nos links /ir/<campanha> — a unica medicao que temos do site, que
  // e estatico e nao tem analytics.
  const cliquesPorCampanha: Record<string, number> = {};
  for (const c of (cliquesRes.data ?? []) as { campanha: string }[]) {
    cliquesPorCampanha[c.campanha] = (cliquesPorCampanha[c.campanha] ?? 0) + 1;
  }
  const cliques = Object.entries(cliquesPorCampanha)
    .map(([campanha, total]) => ({ campanha, total }))
    .sort((a, b) => b.total - a.total);
  const totalCliques = cliques.reduce((t, c) => t + c.total, 0);

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
      investido: v.investido / 100,
    })),
    investido: investidoCentavos / 100,
    // Custo por visualizacao do mes inteiro: aproximacao honesta, porque parte
    // do alcance e organica. Serve para comparar meses, nao para auditar.
    custoPorVisualizacao: investidoCentavos > 0 && alcanceTotal > 0
      // 3 casas: a R$ 27 por 2.171 visualizacoes o custo e R$ 0,012 — arredondar
      // para centavo inteiro mostraria R$ 0,01 e perderia a comparacao.
      ? Math.round((investidoCentavos / alcanceTotal) * 10) / 1000
      : null,
    prints,
    aConferir: prints.filter((p) => p.conferir).length,
    cliques,
    totalCliques,
    responderam,
    // Taxa de resposta sobre o que saiu no mês. Comparar canais é o objetivo:
    // é esse número que diz onde o dinheiro rende mais.
    taxaResposta: totalEnvios > 0 ? Math.round((responderam / totalEnvios) * 1000) / 10 : null,
  });
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedViewer(req)) return new NextResponse("unauthorized", { status: 401 });

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  // Um registro por canal/dia: relançar o mesmo dia corrige o número anterior
  // em vez de somar duas vezes — e mergeia, para quem manda só o print não
  // apagar números que já estavam lá. Regras em @/lib/social-metrics.
  const r = await salvarNumeros({
    canal: cleanText(b?.canal, 20),
    dia: cleanText(b?.dia, 10),
    publicacoes: b?.publicacoes,
    alcance: b?.alcance,
    obs: cleanText(b?.obs, 500) || null,
    autor: cleanText(b?.autor, 60) || "equipe",
    fotos: b?.fotos,
    investimento: b?.investimento,
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.erro }, { status: r.status });

  return NextResponse.json({ ok: true, conferir: r.conferir });
}
