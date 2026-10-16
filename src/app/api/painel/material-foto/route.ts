import { NextRequest } from "next/server";
import { salesDb } from "@/lib/supabase";

// ===========================================================================
// GET /api/painel/material-foto?f=<caminho>&t=<token>
//
// Serve uma foto que a equipe anexou pelo painel. O bucket "material" é
// privado; esta rota é a única porta. O token vem na QUERY e não no header
// porque <img src> e <a download> não mandam header — mesmo arranjo que
// /api/painel/post-image já usa.
//
// O caminho é validado contra o formato que nós mesmos geramos. Sem isso, um
// "f=../outra-coisa" viraria leitura de qualquer objeto do bucket.
// ===========================================================================

export const runtime = "nodejs";

const BUCKET = "material";
const CAMINHO_OK = /^fotos\/\d{4}-\d{2}-\d{2}\/[a-f0-9-]{36}\.(jpg|png|webp)$/;

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function authed(t: string | null): boolean {
  if (!t) return false;
  return t === process.env.VIEWER_TOKEN || t === process.env.ADMIN_TOKEN;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (!authed(url.searchParams.get("t"))) return new Response("unauthorized", { status: 401 });

  const f = url.searchParams.get("f") ?? "";
  if (!CAMINHO_OK.test(f)) return new Response("caminho inválido", { status: 400 });

  const { data, error } = await salesDb.storage.from(BUCKET).download(f);
  if (error || !data) return new Response("não encontrada", { status: 404 });

  const ext = f.split(".").pop()!;
  return new Response(await data.arrayBuffer(), {
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      // Foto não muda depois de enviada: cache longo no navegador dela.
      "Cache-Control": "private, max-age=86400",
    },
  });
}
