"use client";

import { useState } from "react";

// ===========================================================================
// Porta de entrada única para o material que a equipe produz fora do painel
// (posts gerados por IA, recados, observações). Proposta da própria captação:
// ela cola num lugar só e diz o que é; o painel se encarrega do destino.
// Usa as classes CSS injetadas por /painel.
// ===========================================================================

const TIPOS = [
  { id: "post", nome: "Post para publicar", ajuda: "Vai para a aba Posts do dia, pronto para você copiar e publicar." },
  { id: "recado", nome: "Recado para o James", ajuda: "Chega no WhatsApp dele na hora e fica registrado aqui." },
  { id: "numeros", nome: "Números do dia", ajuda: "Publicações e visualizações das redes. Entram no Relatório do mês." },
] as const;

const CANAIS_REDE = [
  { id: "facebook_pagina", nome: "Facebook — página" },
  { id: "facebook_grupos", nome: "Facebook — grupos" },
  { id: "instagram", nome: "Instagram" },
  { id: "outro", nome: "Outro" },
];

function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const MAX_FOTOS = 4;
const MAX_LADO = 1600; // px no lado maior — suficiente para feed e story

// Reduz a foto NO NAVEGADOR antes de subir. Foto de celular tem 4–8 MB e o
// limite de corpo da requisição é 4,5 MB: sem reduzir, ela clicaria em enviar
// e veria um erro de rede sem explicação. "from-image" respeita a orientação
// do EXIF — sem isso, foto de celular sobe deitada.
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

export default function EnviarMaterial({ token }: { token: string }) {
  const [tipo, setTipo] = useState<"post" | "recado" | "numeros">("post");
  const [rede, setRede] = useState({ canal: "facebook_pagina", dia: hojeISO(), publicacoes: "", alcance: "" });
  const [titulo, setTitulo] = useState("");
  const [texto, setTexto] = useState("");
  const [obs, setObs] = useState("");
  const [fotos, setFotos] = useState<string[]>([]);
  const [lendoFoto, setLendoFoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function escolherFotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // permite escolher a mesma foto de novo depois de remover
    if (!files.length) return;

    const espaco = MAX_FOTOS - fotos.length;
    if (espaco <= 0) {
      setMsg({ kind: "err", text: `Já são ${MAX_FOTOS} fotos. Remova uma para colocar outra.` });
      return;
    }

    setLendoFoto(true);
    const novas: string[] = [];
    let erro = "";
    for (const f of files.slice(0, espaco)) {
      try {
        novas.push(await reduzirFoto(f));
      } catch {
        // HEIC do iPhone não abre em navegador de PC: avisar com o caminho da
        // saída, não só "deu erro".
        erro = `Não consegui abrir "${f.name}". Se for foto de iPhone (HEIC), salve/exporte como JPG e tente de novo.`;
      }
    }
    if (!erro && files.length > espaco) {
      erro = `Entraram ${espaco}. O limite é ${MAX_FOTOS} fotos por material.`;
    }
    if (novas.length) setFotos((p) => [...p, ...novas]);
    setMsg(erro ? { kind: "err", text: erro } : null);
    setLendoFoto(false);
  }

  async function enviar() {
    if (tipo === "numeros") {
      if (!rede.publicacoes.trim()) { setMsg({ kind: "err", text: "Informe quantas publicações você fez." }); return; }
    } else if (!texto.trim() && !fotos.length) {
      setMsg({ kind: "err", text: "Cole o material no campo ou anexe uma foto." }); return;
    }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/painel/material", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({
          tipo, titulo, texto, obs, autor: "Jéssica",
          ...(tipo === "numeros" ? rede : { fotos }),
        }),
      });
      const d = await res.json();
      if (!d.ok) { setMsg({ kind: "err", text: d.error ?? "Não consegui enviar." }); return; }
      setMsg({ kind: "ok", text: `Guardado. Destino: ${d.destino}.` });
      setTitulo(""); setTexto(""); setObs(""); setFotos([]);
      setRede((p) => ({ ...p, publicacoes: "", alcance: "" }));
    } catch {
      setMsg({ kind: "err", text: "Falha de rede ao enviar. Se a foto for muito grande, tente uma por vez." });
    } finally { setBusy(false); }
  }

  const atual = TIPOS.find((t) => t.id === tipo)!;

  return (
    <section className="novo">
      <p className="nvhint">
        Para tudo que você produz fora do painel — texto e foto. Cole aqui, diga o que é, e eu levo para o lugar certo.
        Se algum dia o destino não existir ainda, me avise no WhatsApp que eu crio.
      </p>

      <label className="clabel">O que é este material?</label>
      <div className="tiporow">
        {TIPOS.map((t) => (
          <button key={t.id} type="button"
            className={`tipobtn${tipo === t.id ? " on" : ""}`}
            onClick={() => setTipo(t.id)}>
            {t.nome}
          </button>
        ))}
      </div>
      <p className="chint">{atual.ajuda}</p>

      {tipo === "numeros" ? (
        <div className="nvgrid">
          <div className="nvf">
            <label className="clabel" htmlFor="mat-canal">Canal</label>
            <select id="mat-canal" className="cinput" value={rede.canal}
              onChange={(e) => setRede((p) => ({ ...p, canal: e.target.value }))}>
              {CANAIS_REDE.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div className="nvf">
            <label className="clabel" htmlFor="mat-dia">Dia</label>
            <input id="mat-dia" className="cinput" type="date" value={rede.dia}
              onChange={(e) => setRede((p) => ({ ...p, dia: e.target.value }))} />
          </div>
          <div className="nvf">
            <label className="clabel" htmlFor="mat-pub">Quantas publicações</label>
            <input id="mat-pub" className="cinput" inputMode="numeric" value={rede.publicacoes} placeholder="5"
              onChange={(e) => setRede((p) => ({ ...p, publicacoes: e.target.value.replace(/\D/g, "") }))} />
          </div>
          <div className="nvf">
            <label className="clabel" htmlFor="mat-alc">Visualizações (se souber)</label>
            <input id="mat-alc" className="cinput" inputMode="numeric" value={rede.alcance} placeholder="200"
              onChange={(e) => setRede((p) => ({ ...p, alcance: e.target.value.replace(/\D/g, "") }))} />
          </div>
          <div className="nvf nvf-wide">
            <label className="clabel" htmlFor="mat-obs2">Observação (opcional)</label>
            <input id="mat-obs2" className="cinput" value={obs} onChange={(e) => setObs(e.target.value)} />
          </div>
        </div>
      ) : (
      <>
      <label className="clabel" htmlFor="mat-tit">Título (opcional)</label>
      <input id="mat-tit" className="cinput" value={titulo} maxLength={160}
        onChange={(e) => setTitulo(e.target.value)}
        placeholder={tipo === "post" ? "Prontuário por voz" : "Sobre a extensão do Facebook"} />

      <label className="clabel" htmlFor="mat-txt">Material</label>
      <textarea id="mat-txt" className="ctext" rows={14} value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={tipo === "post" ? "Cole aqui o texto do post, com o link do site se houver." : "Escreva o recado."} />

      <label className="clabel">Foto (opcional — até {MAX_FOTOS})</label>
      <p className="chint" style={{ marginTop: 0 }}>
        {tipo === "post"
          ? "A sua foto entra no lugar da arte automática em “Posts do dia”, pronta para baixar e publicar."
          : "A foto vai no WhatsApp do James junto com o recado."}
        {" "}Pode ser do celular: eu reduzo o tamanho aqui mesmo antes de subir.
      </p>
      <div className="crow">
        <label className="fotobtn">
          {lendoFoto ? "Preparando…" : fotos.length ? "Colocar outra foto" : "Escolher foto"}
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple
            disabled={lendoFoto || busy} onChange={escolherFotos} />
        </label>
      </div>
      {!!fotos.length && (
        <div className="fotogrid">
          {fotos.map((f, i) => (
            <div className="fotoitem" key={i}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f} alt={`foto ${i + 1}`} />
              <button type="button" className="fotodel" title="Remover esta foto"
                onClick={() => setFotos((p) => p.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
        </div>
      )}

      <label className="clabel" htmlFor="mat-obs">Observação (opcional)</label>
      <input id="mat-obs" className="cinput" value={obs} maxLength={2000}
        onChange={(e) => setObs(e.target.value)}
        placeholder="Algo que eu precise saber sobre este material" />
      </>
      )}

      <div className="crow">
        <button
          className="csend"
          disabled={busy || lendoFoto || (tipo === "numeros" ? !rede.publicacoes.trim() : !texto.trim() && !fotos.length)}
          onClick={enviar}
        >
          {busy ? "Enviando..." : "Enviar"}
        </button>
      </div>
      {msg && <p className={`nvmsg nv-${msg.kind}`}>{msg.text}</p>}
    </section>
  );
}
