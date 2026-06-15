import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { salesDb } from "@/lib/supabase";

export const runtime = "nodejs";

// ===========================================================================
// Webhook do Meta Graph (Instagram + Facebook) — comentarios, mencoes e DMs.
//
// GET  -> handshake de verificacao exigido pela Meta ao assinar o webhook.
// POST -> recebe os eventos: valida a assinatura HMAC (X-Hub-Signature-256),
//         normaliza e grava em social_events (dedup por platform+external_id).
//         O processamento pelo social-agent fica para a Fase 2.
// ===========================================================================

// --- GET: verificacao do webhook -------------------------------------------
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && token && token === process.env.META_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

// --- Validacao da assinatura (App Secret) ----------------------------------
function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !signature) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- Normalizacao dos eventos da Meta --------------------------------------
type SocialEvent = {
  platform: "instagram" | "facebook";
  type: "comment" | "dm" | "mention";
  external_id: string;
  author: string | null;
  content: string | null;
  post_ref: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseEntries(payload: any): SocialEvent[] {
  const out: SocialEvent[] = [];
  const platform: "instagram" | "facebook" = payload?.object === "instagram" ? "instagram" : "facebook";
  const entries: any[] = Array.isArray(payload?.entry) ? payload.entry : []; // eslint-disable-line @typescript-eslint/no-explicit-any

  for (const entry of entries) {
    // Comentarios e mencoes chegam em "changes".
    for (const change of entry?.changes ?? []) {
      const field = change?.field as string | undefined;
      const v = change?.value ?? {};
      if (field === "comments" || field === "feed") {
        const id = v.id ?? v.comment_id;
        if (id) {
          out.push({
            platform,
            type: "comment",
            external_id: String(id),
            author: v.from?.username ?? v.from?.id ?? v.from?.name ?? null,
            content: v.text ?? v.message ?? null,
            post_ref: v.media?.id ?? v.post_id ?? v.parent_id ?? null,
          });
        }
      } else if (field === "mentions") {
        const id = v.comment_id ?? v.media_id;
        if (id) {
          out.push({
            platform,
            type: "mention",
            external_id: String(id),
            author: v.from?.username ?? null,
            content: v.text ?? null,
            post_ref: v.media_id ?? null,
          });
        }
      }
    }

    // DMs chegam em "messaging" (Messenger / Instagram Direct).
    for (const m of entry?.messaging ?? []) {
      const mid = m?.message?.mid;
      if (mid && !m?.message?.is_echo) {
        out.push({
          platform,
          type: "dm",
          external_id: String(mid),
          author: m.sender?.id ?? null,
          content: m.message?.text ?? null,
          post_ref: null,
        });
      }
    }
  }
  return out;
}

// --- POST: recebimento de eventos ------------------------------------------
export async function POST(req: NextRequest) {
  const raw = await req.text();

  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
    return new NextResponse("invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true }); // ignora corpo invalido sem re-tentativa
  }

  const events = parseEntries(payload);
  if (events.length > 0) {
    const { error } = await salesDb
      .from("social_events")
      .upsert(
        events.map((e) => ({ ...e, handled: false })),
        { onConflict: "platform,external_id", ignoreDuplicates: true },
      );
    if (error) console.error("[meta-webhook] falha ao gravar social_events:", error.message);
  }

  // TODO(Fase 2): acionar social-agent para os eventos com intencao comercial.
  // Responder 200 rapido evita re-tentativas da Meta.
  return NextResponse.json({ ok: true, received: events.length });
}
