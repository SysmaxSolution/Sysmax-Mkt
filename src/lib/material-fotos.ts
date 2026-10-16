import { salesDb } from "@/lib/supabase";

// ===========================================================================
// Fotos anexadas pelo painel (aba "Enviar material").
//
// A arte dos posts era 100% gerada (post-image), mas o gerador parou em
// ago/2026 e a equipe passou a produzir o material fora do painel. Sem lugar
// para a foto, a pessoa mandava no WhatsApp e alguém reanexava à mão — foi
// exatamente a pergunta de 2026-10-16 ("ou é melhor eu colocar aqui e vc
// atualiza lá?"). Agora a foto sobe junto do texto.
//
// Bucket "material", privado (scripts/ensure-material-bucket.mjs). Leitura só
// por /api/painel/material-foto.
// ===========================================================================

export const MAX_FOTOS = 4;
const MAX_BYTES = 6 * 1024 * 1024; // por foto, já redimensionada no navegador
const BUCKET = "material";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type ResultadoFotos = { caminhos: string[]; erro?: string };

function hojePasta(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// Recebe data URLs ("data:image/jpeg;base64,...") vindas do navegador e grava
// cada uma no bucket. Devolve os caminhos para guardar junto do material.
export async function salvarFotos(bruto: unknown): Promise<ResultadoFotos> {
  if (bruto === undefined || bruto === null) return { caminhos: [] };
  if (!Array.isArray(bruto)) return { caminhos: [], erro: "Formato das fotos inválido." };
  if (bruto.length === 0) return { caminhos: [] };
  if (bruto.length > MAX_FOTOS) return { caminhos: [], erro: `No máximo ${MAX_FOTOS} fotos por material.` };

  const pasta = hojePasta();
  const caminhos: string[] = [];

  for (const item of bruto) {
    if (typeof item !== "string") return { caminhos, erro: "Foto inválida." };
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(item.trim());
    if (!m) return { caminhos, erro: "Use fotos JPG, PNG ou WEBP." };

    const bytes = Buffer.from(m[2], "base64");
    if (bytes.byteLength === 0) return { caminhos, erro: "Foto vazia." };
    if (bytes.byteLength > MAX_BYTES) return { caminhos, erro: "Foto grande demais. Tente outra." };

    const caminho = `fotos/${pasta}/${crypto.randomUUID()}.${EXT[m[1]]}`;
    const { error } = await salesDb.storage.from(BUCKET).upload(caminho, bytes, {
      contentType: m[1],
      upsert: false,
    });
    if (error) {
      // Não dá para "metade subir": se uma falha, o material não vai com
      // foto faltando sem a pessoa saber.
      return { caminhos, erro: "Não consegui guardar a foto. Tente de novo." };
    }
    caminhos.push(caminho);
  }

  return { caminhos };
}
