import { NextRequest } from "next/server";
import { ImageResponse } from "next/og";
import { salesDb } from "@/lib/supabase";

// ===========================================================================
// Gera a arte (PNG) de um post/anúncio a partir do conteúdo em content_calendar,
// para a equipe de marketing baixar e publicar. Card com a headline + marca +
// selo de promoção. Autenticado por token na query (?t=), pois <img> não manda
// header. Tamanho por ?size=feed|story|ad.
// ===========================================================================
export const runtime = "nodejs";

const BRAND_GREEN = "#0E7C66";
const BRAND_GREEN_D = "#0A5A4A";
const INK = "#F3FBF7";

function authed(t: string | null): boolean {
  if (!t) return false;
  return t === process.env.VIEWER_TOKEN || t === process.env.ADMIN_TOKEN;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (!authed(url.searchParams.get("t"))) return new Response("unauthorized", { status: 401 });

  const id = url.searchParams.get("id");
  const size = url.searchParams.get("size") ?? "feed";
  if (!id) return new Response("id obrigatório", { status: 400 });

  const { data } = await salesDb.from("content_calendar").select("brief,pillar").eq("id", id).maybeSingle();
  let content: Record<string, unknown> = {};
  try { content = JSON.parse((data?.brief as string) ?? "{}"); } catch { /* */ }
  const isAd = data?.pillar === "ad";
  const headline = (content.headline as string) || (content.hook as string) || "SYSVETMAX";

  const [w, h] = size === "story" ? [1080, 1920] : [1080, 1350];

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 96, background: `linear-gradient(150deg, ${BRAND_GREEN} 0%, ${BRAND_GREEN_D} 100%)`, color: INK, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", fontSize: 40, fontWeight: 800, letterSpacing: 2 }}>SYSVETMAX</div>
          <div style={{ display: "flex", alignItems: "center", fontSize: 26, opacity: 0.85, border: "2px solid rgba(255,255,255,.4)", borderRadius: 999, padding: "8px 22px" }}>
            {isAd ? "PATROCINADO" : "@sysvetmax"}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ display: "flex", width: 96, height: 8, background: INK, borderRadius: 8 }} />
          <div style={{ display: "flex", fontSize: 84, fontWeight: 800, lineHeight: 1.05, maxWidth: 820 }}>{headline}</div>
          <div style={{ display: "flex", fontSize: 34, opacity: 0.9, maxWidth: 760 }}>
            O primeiro sistema veterinário com IA de verdade do Brasil. Você atende; o SYSVETMAX escreve.
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", alignItems: "center", alignSelf: "flex-start", background: INK, color: BRAND_GREEN_D, fontSize: 34, fontWeight: 800, borderRadius: 16, padding: "18px 30px" }}>
            Starter R$ 149,90/mês · de R$ 189
          </div>
          <div style={{ display: "flex", fontSize: 30, opacity: 0.9 }}>Teste grátis 30 dias · sem cartão · migração assistida</div>
        </div>
      </div>
    ),
    { width: w, height: h },
  );
}
