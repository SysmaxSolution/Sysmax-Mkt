import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { discoverCity } from "@/lib/discovery";

// ===========================================================================
// Descoberta AUTOMÁTICA de topo de funil. Roda 1 cidade por dia (rotação),
// deduplicando por place_id. As mensagens dessas novas clínicas são geradas
// pelos builders que rodam logo em seguida no mesmo daily-am (lead-followups +
// worklist-build). Assim a base cresce sozinha, sem repetir clínicas.
// Guardrail: só descobre e prepara; nada é enviado sem aprovação.
// ===========================================================================
export const runtime = "nodejs";
export const maxDuration = 60;

// Praças-alvo (cidade, UF). A rotação por dia percorre a lista e, ao completar,
// recomeça — o que revalida/atualiza clínicas antigas e captura novas.
const TARGETS: [string, string][] = [
  ["São Paulo", "SP"], ["Campinas", "SP"], ["Ribeirão Preto", "SP"], ["Sorocaba", "SP"], ["São José do Rio Preto", "SP"],
  ["Santos", "SP"], ["São José dos Campos", "SP"], ["Bauru", "SP"], ["Piracicaba", "SP"], ["Jundiaí", "SP"],
  ["Rio de Janeiro", "RJ"], ["Niterói", "RJ"], ["Nova Iguaçu", "RJ"], ["Campos dos Goytacazes", "RJ"], ["Petrópolis", "RJ"],
  ["Belo Horizonte", "MG"], ["Uberlândia", "MG"], ["Juiz de Fora", "MG"], ["Contagem", "MG"], ["Betim", "MG"], ["Uberaba", "MG"],
  ["Curitiba", "PR"], ["Londrina", "PR"], ["Maringá", "PR"], ["Ponta Grossa", "PR"], ["Cascavel", "PR"], ["Foz do Iguaçu", "PR"],
  ["Porto Alegre", "RS"], ["Caxias do Sul", "RS"], ["Pelotas", "RS"], ["Canoas", "RS"], ["Santa Maria", "RS"],
  ["Florianópolis", "SC"], ["Joinville", "SC"], ["Blumenau", "SC"], ["Itajaí", "SC"],
  ["Salvador", "BA"], ["Feira de Santana", "BA"], ["Recife", "PE"], ["Fortaleza", "CE"], ["Goiânia", "GO"],
  ["Brasília", "DF"], ["Vitória", "ES"], ["Vila Velha", "ES"], ["Cuiabá", "MT"], ["Campo Grande", "MS"],
  ["Belém", "PA"], ["Manaus", "AM"], ["Natal", "RN"], ["João Pessoa", "PB"], ["Maceió", "AL"],
];

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) return new NextResponse("unauthorized", { status: 401 });
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    return NextResponse.json({ ok: false, skipped: "GOOGLE_PLACES_API_KEY ausente" });
  }

  // rotação determinística por dia (sem estado em banco)
  const dayIndex = Math.floor(Date.now() / 86_400_000);
  const [city, uf] = TARGETS[dayIndex % TARGETS.length];

  try {
    const result = await discoverCity(city, uf, 12, true);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, city, uf, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
