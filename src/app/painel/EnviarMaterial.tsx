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
] as const;

export default function EnviarMaterial({ token }: { token: string }) {
  const [tipo, setTipo] = useState<"post" | "recado">("post");
  const [titulo, setTitulo] = useState("");
  const [texto, setTexto] = useState("");
  const [obs, setObs] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function enviar() {
    if (!texto.trim()) { setMsg({ kind: "err", text: "Cole o material no campo." }); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/painel/material", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ tipo, titulo, texto, obs, autor: "Jéssica" }),
      });
      const d = await res.json();
      if (!d.ok) { setMsg({ kind: "err", text: d.error ?? "Não consegui enviar." }); return; }
      setMsg({ kind: "ok", text: `Guardado. Destino: ${d.destino}.` });
      setTitulo(""); setTexto(""); setObs("");
    } catch {
      setMsg({ kind: "err", text: "Falha de rede ao enviar." });
    } finally { setBusy(false); }
  }

  const atual = TIPOS.find((t) => t.id === tipo)!;

  return (
    <section className="novo">
      <p className="nvhint">
        Para tudo que você produz fora do painel. Cole aqui, diga o que é, e eu levo para o lugar certo.
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

      <label className="clabel" htmlFor="mat-tit">Título (opcional)</label>
      <input id="mat-tit" className="cinput" value={titulo} maxLength={160}
        onChange={(e) => setTitulo(e.target.value)}
        placeholder={tipo === "post" ? "Prontuário por voz" : "Sobre a extensão do Facebook"} />

      <label className="clabel" htmlFor="mat-txt">Material</label>
      <textarea id="mat-txt" className="ctext" rows={14} value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={tipo === "post" ? "Cole aqui o texto do post, com o link do site se houver." : "Escreva o recado."} />

      <label className="clabel" htmlFor="mat-obs">Observação (opcional)</label>
      <input id="mat-obs" className="cinput" value={obs} maxLength={2000}
        onChange={(e) => setObs(e.target.value)}
        placeholder="Algo que eu precise saber sobre este material" />

      <div className="crow">
        <button className="csend" disabled={busy || !texto.trim()} onClick={enviar}>
          {busy ? "Enviando..." : "Enviar"}
        </button>
      </div>
      {msg && <p className={`nvmsg nv-${msg.kind}`}>{msg.text}</p>}
    </section>
  );
}
