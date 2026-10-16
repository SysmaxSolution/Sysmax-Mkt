import { salesDb } from "@/lib/supabase";
import { salvarFotos, MAX_FOTOS } from "@/lib/material-fotos";

// ===========================================================================
// Números de rede social — gravação compartilhada pelas duas portas do painel
// ("Enviar material → Números do dia" e "Relatório do mês → Lançar números").
//
// Duas regras que só existem porque a realidade é essa:
//
// 1. O print vale por si. A captação tira print do relatório do Facebook e
//    nem sempre tem paciência de transcrever os dois números — então o print
//    sozinho salva a linha, marcada `conferir`, em vez de registrar zero
//    publicação (que sujaria o relatório do mês).
// 2. Relançar o mesmo canal/dia MERGEIA, não substitui. Antes era upsert puro:
//    quem mandasse só o print em cima de um dia já preenchido apagava os
//    números que já estavam lá.
// ===========================================================================

// TikTok entrou em 16/10: a captacao passou a publicar la e perguntou como
// faria o relatorio. O numero dela vem do proprio app (Perfil > Ferramentas
// de criador > Analises) e e lancado aqui a mao, igual aos outros canais.
export const CANAIS = ["facebook_pagina", "facebook_grupos", "instagram", "tiktok", "outro"] as const;
export type Canal = (typeof CANAIS)[number];

export type EntradaNumeros = {
  canal: string;
  dia: string;
  publicacoes: unknown;
  alcance: unknown;
  obs: string | null;
  autor: string;
  fotos: unknown;
  investimento: unknown;
};

export type SaidaNumeros = { ok: true; conferir: boolean; fotos: number } | { ok: false; erro: string; status: number };

// "" / null / undefined = não informado (≠ zero informado).
function numeroOuNulo(v: unknown): number | null | "invalido" {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return "invalido";
  return Math.trunc(n);
}

export async function salvarNumeros(e: EntradaNumeros): Promise<SaidaNumeros> {
  if (!CANAIS.includes(e.canal as Canal)) return { ok: false, erro: "Escolha o canal.", status: 400 };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.dia)) return { ok: false, erro: "Informe o dia.", status: 400 };

  const pub = numeroOuNulo(e.publicacoes);
  if (pub === "invalido") return { ok: false, erro: "Número de publicações inválido.", status: 400 };
  const alc = numeroOuNulo(e.alcance);
  if (alc === "invalido") return { ok: false, erro: "Alcance inválido.", status: 400 };
  // Dinheiro em centavos: "27", "27,00" e "27.00" valem R$ 27,00.
  const inv = numeroOuNulo(
    typeof e.investimento === "string" && e.investimento.trim()
      ? Math.round(parseFloat(e.investimento.replace(/\./g, "").replace(",", ".")) * 100)
      : e.investimento,
  );
  if (inv === "invalido") return { ok: false, erro: "Valor investido inválido.", status: 400 };

  const { caminhos: novasFotos, erro: erroFoto } = await salvarFotos(e.fotos);
  if (erroFoto) return { ok: false, erro: erroFoto, status: 400 };

  const { data: atual } = await salesDb
    .from("social_metrics")
    .select("publicacoes,alcance,obs,fotos,investimento_centavos")
    .eq("canal", e.canal)
    .eq("dia", e.dia)
    .maybeSingle();

  const anteriores = (atual?.fotos as string[] | null) ?? [];
  const fotos = [...anteriores, ...novasFotos].slice(0, MAX_FOTOS);
  const publicacoes = pub ?? ((atual?.publicacoes as number | null) ?? null);
  const alcance = alc ?? ((atual?.alcance as number | null) ?? null);
  const investimento = inv ?? ((atual?.investimento_centavos as number | null) ?? null);

  // Só recusa quando não sobrou NADA para gravar. A checagem vem depois de ler
  // a linha atual de propósito: voltar a um dia já preenchido só para somar o
  // valor investido era recusado como "informe as publicações".
  if (publicacoes === null && !fotos.length && investimento === null && alcance === null) {
    return { ok: false, erro: "Informe quantas publicações você fez, ou anexe o print do relatório.", status: 400 };
  }

  const { error } = await salesDb.from("social_metrics").upsert(
    {
      canal: e.canal,
      dia: e.dia,
      publicacoes,
      alcance,
      obs: e.obs ?? ((atual?.obs as string | null) ?? null),
      autor: e.autor,
      fotos: fotos.length ? fotos : null,
      investimento_centavos: investimento,
      conferir: publicacoes === null && fotos.length > 0,
    },
    { onConflict: "canal,dia" },
  );
  if (error) return { ok: false, erro: "Não consegui salvar os números.", status: 500 };

  return { ok: true, conferir: publicacoes === null && fotos.length > 0, fotos: fotos.length };
}
