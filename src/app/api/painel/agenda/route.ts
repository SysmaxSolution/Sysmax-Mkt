import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedViewer } from "@/lib/viewer-auth";
import { salesDb } from "@/lib/supabase";
import { cleanText } from "@/crm/lead-intake";
import { diaDeTrabalho } from "@/lib/agenda-br";

// ===========================================================================
// POST /api/painel/agenda — marca (ou desmarca) retorno e reunião de um lead.
//
// Pedido da captação em 16/10: ela combina "ligo de volta terça às 10h" e isso
// só existia na cabeça dela. Agora fica no cartão e o painel consegue destacar
// o que está vencendo.
//
//   { leadId, tipo: "retorno" | "reuniao", quando: "2026-10-17T14:00" | null }
//
// `quando` chega como datetime-local (horário de quem digitou, sem fuso) e é
// convertido aqui usando o deslocamento de Brasília — guardar o texto cru
// faria o "venceu?" comparar coisas diferentes.
// ===========================================================================

export const runtime = "nodejs";

const TIPOS = { retorno: "retorno_em", reuniao: "reuniao_em" } as const;
type Tipo = keyof typeof TIPOS;

// -03:00 o ano todo (não há mais horário de verão no Brasil desde 2019).
const FUSO = "-03:00";

export async function POST(req: NextRequest) {
  if (!isAuthorizedViewer(req)) return new NextResponse("unauthorized", { status: 401 });

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const leadId = cleanText(b?.leadId, 60);
  const tipo = cleanText(b?.tipo, 20) as Tipo;
  const quandoBruto = typeof b?.quando === "string" ? b.quando.trim() : "";

  if (!leadId) return NextResponse.json({ ok: false, error: "Clínica não informada." }, { status: 400 });
  if (!(tipo in TIPOS)) return NextResponse.json({ ok: false, error: "Tipo inválido." }, { status: 400 });

  let quando: string | null = null;
  let aviso: string | null = null;
  if (quandoBruto) {
    // datetime-local vem "2026-10-17T14:00" (às vezes com segundos).
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(quandoBruto)) {
      return NextResponse.json({ ok: false, error: "Data e hora inválidas." }, { status: 400 });
    }
    const iso = new Date(`${quandoBruto.length === 16 ? quandoBruto + ":00" : quandoBruto}${FUSO}`);
    if (Number.isNaN(iso.getTime())) {
      return NextResponse.json({ ok: false, error: "Data e hora inválidas." }, { status: 400 });
    }
    quando = iso.toISOString();

    // Regra geral dela (16/10): nada de compromisso em fim de semana ou
    // feriado, "de jeito nenhum". Fora do horario e so aviso -- reuniao as 18h
    // com o dono continua valendo.
    const v = diaDeTrabalho(quando);
    if (!v.ok) return NextResponse.json({ ok: false, error: v.erro }, { status: 400 });
    aviso = v.aviso ?? null;
  }

  const { error } = await salesDb.from("leads").update({ [TIPOS[tipo]]: quando }).eq("id", leadId);
  if (error) return NextResponse.json({ ok: false, error: "Não consegui salvar." }, { status: 500 });

  return NextResponse.json({ ok: true, quando, aviso });
}
