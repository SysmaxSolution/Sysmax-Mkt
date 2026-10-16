"use client";

import { useState } from "react";

// ===========================================================================
// Seletor de fotos do painel: escolher, reduzir no navegador, ver e remover.
// Usado pelo "Enviar material" (post, recado, print do relatório) e pelo
// "Relatório do mês". Usa as classes CSS injetadas por /painel.
// ===========================================================================

export const MAX_FOTOS = 4;
const MAX_LADO = 1600; // px no lado maior — suficiente para feed, story e print

// Reduz NO NAVEGADOR antes de subir. Foto de celular tem 4–8 MB e o limite de
// corpo da requisição é 4,5 MB: sem reduzir, ela clicaria em enviar e veria um
// erro de rede sem explicação. "from-image" respeita a orientação do EXIF —
// sem isso, foto de celular sobe deitada.
async function reduzirFoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const escala = Math.min(1, MAX_LADO / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * escala));
  const h = Math.max(1, Math.round(bitmap.height * escala));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas indisponível");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.85);
}

export default function FotoPicker({
  fotos, setFotos, label, ajuda, rotulo, disabled, onErro,
}: {
  fotos: string[];
  setFotos: (f: string[]) => void;
  label: string;
  ajuda: string;
  rotulo?: string;
  disabled?: boolean;
  onErro: (texto: string | null) => void;
}) {
  const [lendo, setLendo] = useState(false);
  const nome = rotulo ?? "foto";

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // permite reescolher o mesmo arquivo depois de remover
    if (!files.length) return;

    const espaco = MAX_FOTOS - fotos.length;
    if (espaco <= 0) {
      onErro(`Já são ${MAX_FOTOS}. Remova uma para colocar outra.`);
      return;
    }

    setLendo(true);
    const novas: string[] = [];
    let erro = "";
    for (const f of files.slice(0, espaco)) {
      try {
        novas.push(await reduzirFoto(f));
      } catch {
        // HEIC do iPhone não abre em navegador de PC: avisar com a saída,
        // não só "deu erro".
        erro = `Não consegui abrir "${f.name}". Se for imagem de iPhone (HEIC), salve/exporte como JPG e tente de novo.`;
      }
    }
    if (!erro && files.length > espaco) erro = `Entraram ${espaco}. O limite é ${MAX_FOTOS} por envio.`;
    if (novas.length) setFotos([...fotos, ...novas]);
    onErro(erro || null);
    setLendo(false);
  }

  return (
    <>
      <label className="clabel">{label}</label>
      <p className="chint" style={{ marginTop: 0 }}>{ajuda}</p>
      <div className="crow">
        <label className="fotobtn">
          {lendo ? "Preparando…" : fotos.length ? `Colocar outra ${nome}` : `Escolher ${nome}`}
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple
            disabled={lendo || disabled} onChange={escolher} />
        </label>
      </div>
      {!!fotos.length && (
        <div className="fotogrid">
          {fotos.map((f, i) => (
            <div className="fotoitem" key={i}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f} alt={`${nome} ${i + 1}`} />
              <button type="button" className="fotodel" title="Remover"
                onClick={() => setFotos(fotos.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
