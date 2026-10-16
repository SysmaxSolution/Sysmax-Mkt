"use client";

import { useState } from "react";
import FotoPicker from "./FotoPicker";

// ===========================================================================
// Porta de entrada única para o material que a equipe produz fora do painel
// (posts gerados por IA, recados, print do relatório das redes). Proposta da
// própria captação: ela cola num lugar só e diz o que é; o painel se encarrega
// do destino. Usa as classes CSS injetadas por /painel.
// ===========================================================================

const TIPOS = [
  { id: "post", nome: "Post para publicar", ajuda: "Vai para a aba Posts do dia, pronto para você copiar e publicar." },
  { id: "recado", nome: "Recado para o James", ajuda: "Chega no WhatsApp dele na hora e fica registrado aqui." },
  { id: "numeros", nome: "Relatório das redes", ajuda: "Publicações e visualizações. Pode anexar só o print do relatório do Facebook — os números entram no Relatório do mês." },
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

export default function EnviarMaterial({ token }: { token: string }) {
  const [tipo, setTipo] = useState<"post" | "recado" | "numeros">("post");
  const [rede, setRede] = useState({ canal: "facebook_pagina", dia: hojeISO(), publicacoes: "", alcance: "" });
  const [titulo, setTitulo] = useState("");
  const [texto, setTexto] = useState("");
  const [obs, setObs] = useState("");
  const [fotos, setFotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function enviar() {
    if (tipo === "numeros") {
      if (!rede.publicacoes.trim() && !fotos.length) {
        setMsg({ kind: "err", text: "Informe quantas publicações você fez, ou anexe o print do relatório." }); return;
      }
    } else if (!texto.trim() && !fotos.length) {
      setMsg({ kind: "err", text: "Cole o material no campo ou anexe uma foto." }); return;
    }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/painel/material", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({
          tipo, titulo, texto, obs, fotos, autor: "Jéssica",
          ...(tipo === "numeros" ? rede : {}),
        }),
      });
      const d = await res.json();
      if (!d.ok) { setMsg({ kind: "err", text: d.error ?? "Não consegui enviar." }); return; }
      setMsg({ kind: "ok", text: `Guardado. Destino: ${d.destino}.` });
      setTitulo(""); setTexto(""); setObs(""); setFotos([]);
      setRede((p) => ({ ...p, publicacoes: "", alcance: "" }));
    } catch {
      setMsg({ kind: "err", text: "Falha de rede ao enviar. Se a imagem for muito grande, tente uma por vez." });
    } finally { setBusy(false); }
  }

  const atual = TIPOS.find((t) => t.id === tipo)!;
  const semConteudo = tipo === "numeros"
    ? !rede.publicacoes.trim() && !fotos.length
    : !texto.trim() && !fotos.length;

  return (
    <section className="novo">
      <p className="nvhint">
        Para tudo que você produz fora do painel — texto e imagem. Cole aqui, diga o que é, e eu levo para o lugar certo.
        Se algum dia o destino não existir ainda, me avise no WhatsApp que eu crio.
      </p>

      <label className="clabel">O que é este material?</label>
      <div className="tiporow">
        {TIPOS.map((t) => (
          <button key={t.id} type="button"
            className={`tipobtn${tipo === t.id ? " on" : ""}`}
            onClick={() => { setTipo(t.id); setMsg(null); }}>
            {t.nome}
          </button>
        ))}
      </div>
      <p className="chint">{atual.ajuda}</p>

      {tipo === "numeros" ? (
        <>
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
        <FotoPicker
          fotos={fotos} setFotos={setFotos} rotulo="print" disabled={busy}
          label="Print do relatório (opcional)"
          ajuda="Print do relatório do Facebook, do Instagram ou de onde vier o número. Se anexar o print, pode deixar os campos de cima em branco: a linha fica marcada “a conferir” e nós preenchemos pelo print."
          onErro={(t) => setMsg(t ? { kind: "err", text: t } : null)}
        />
        </>
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

      <FotoPicker
        fotos={fotos} setFotos={setFotos} disabled={busy}
        label="Foto (opcional)"
        ajuda={tipo === "post"
          ? "A sua foto entra no lugar da arte automática em “Posts do dia”, pronta para baixar e publicar. Pode ser do celular: eu reduzo o tamanho aqui mesmo."
          : "A foto vai no WhatsApp do James junto com o recado — bom para print de tela."}
        onErro={(t) => setMsg(t ? { kind: "err", text: t } : null)}
      />

      <label className="clabel" htmlFor="mat-obs">Observação (opcional)</label>
      <input id="mat-obs" className="cinput" value={obs} maxLength={2000}
        onChange={(e) => setObs(e.target.value)}
        placeholder="Algo que eu precise saber sobre este material" />
      </>
      )}

      <div className="crow">
        <button className="csend" disabled={busy || semConteudo} onClick={enviar}>
          {busy ? "Enviando..." : "Enviar"}
        </button>
      </div>
      {msg && <p className={`nvmsg nv-${msg.kind}`}>{msg.text}</p>}
    </section>
  );
}
