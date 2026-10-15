"use client";

import { useState } from "react";

// ===========================================================================
// A equipe cola a lista que extraiu com a IA dela e o portal vira CRM. Sempre
// em dois passos: mostra o que entendeu, ela confere e só então importa —
// interpretar texto livre erra, e errar aqui é mandar e-mail para o endereço
// errado. Usa as classes CSS injetadas por /painel.
// ===========================================================================

type Item = {
  clinic: string; contact: string | null; city: string | null; country: string;
  email: string | null; phone: string | null; warnings: string[]; existing: boolean;
  subject?: string | null; emailBody?: string | null;
};

const PAISES = [
  { sigla: "US", nome: "Estados Unidos" },
  { sigla: "PT", nome: "Portugal" },
  { sigla: "AE", nome: "Emirados Árabes" },
  { sigla: "GB", nome: "Reino Unido" },
  { sigla: "ES", nome: "Espanha" },
  { sigla: "MX", nome: "México" },
  { sigla: "AR", nome: "Argentina" },
  { sigla: "BR", nome: "Brasil" },
];

export default function ImportarLista({ token, onImportou }: { token: string; onImportou: () => void }) {
  const [texto, setTexto] = useState("");
  const [paisPadrao, setPaisPadrao] = useState("US");
  const [itens, setItens] = useState<Item[] | null>(null);
  const [fora, setFora] = useState<Set<number>>(new Set());
  const [cortados, setCortados] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function analisar() {
    setBusy(true); setMsg(null); setItens(null);
    try {
      const res = await fetch("/api/painel/importar", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ texto, paisPadrao, confirmar: false }),
      });
      const d = await res.json();
      if (!d.ok) { setMsg({ kind: "err", text: d.error ?? "Não consegui ler a lista." }); return; }
      setItens(d.itens);
      setCortados(d.cortados ?? 0);
      // Já cadastradas e sem contato vêm desmarcadas: importar não faria nada.
      const desmarcar = new Set<number>();
      (d.itens as Item[]).forEach((i, idx) => { if (i.existing || (!i.email && !i.phone)) desmarcar.add(idx); });
      setFora(desmarcar);
    } catch {
      setMsg({ kind: "err", text: "Falha de rede ao analisar." });
    } finally { setBusy(false); }
  }

  function alternar(idx: number) {
    setFora((p) => { const n = new Set(p); if (n.has(idx)) n.delete(idx); else n.add(idx); return n; });
  }

  async function importar() {
    if (!itens) return;
    const escolhidos = itens.filter((_, i) => !fora.has(i));
    if (!escolhidos.length) { setMsg({ kind: "err", text: "Nenhuma clínica marcada." }); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/painel/importar", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ confirmar: true, paisPadrao, itens: escolhidos }),
      });
      const d = await res.json();
      if (!d.ok) { setMsg({ kind: "err", text: d.error ?? "Não consegui importar." }); return; }
      const extra = d.pulados ? ` ${d.pulados} já estavam cadastradas e foram puladas.` : "";
      const prontos = d.rascunhos ? ` ${d.rascunhos} já vieram com o e-mail escrito, é só conferir e enviar.` : "";
      setMsg({ kind: "ok", text: `${d.criados} clínica(s) importada(s).${extra}${prontos} Já aparecem na aba Prospectos.` });
      setItens(null); setTexto(""); onImportou();
    } catch {
      setMsg({ kind: "err", text: "Falha de rede ao importar." });
    } finally { setBusy(false); }
  }

  const marcados = itens ? itens.length - fora.size : 0;

  return (
    <section className="novo">
      <p className="nvhint">
        Cole aqui a lista que você montou com a sua IA. Eu leio, mostro o que entendi para você conferir,
        e só importo depois que você aprovar. Funciona com o formato que a sua IA entrega — <b>Nome da clínica</b>,
        <b> Local</b>, <b>Responsável</b>, <b>E-mail</b>, e também <b>Assunto e-mail</b> e <b>Texto e-mail</b>.
        Quando o texto vier junto, a clínica já entra com a mensagem escrita: você confere e envia, sem copiar e colar.
      </p>

      {!itens && (
        <>
          <label className="clabel" htmlFor="imp-txt">Lista extraída pela IA</label>
          <textarea id="imp-txt" className="ctext" rows={16} value={texto} onChange={(e) => setTexto(e.target.value)}
            placeholder={"Nome da clínica: Star Veterinary Clinic\nLocal: Dubai, Emirados Árabes Unidos\nResponsável: Dr. Vito\nE-mail: info@starvetclinic.com\n=\nNome da clínica: ..."} />
          <div className="nvf" style={{ maxWidth: 280 }}>
            <label className="clabel" htmlFor="imp-pais">Se não disser o país, considerar</label>
            <select id="imp-pais" className="cinput" value={paisPadrao} onChange={(e) => setPaisPadrao(e.target.value)}>
              {PAISES.map((p) => <option key={p.sigla} value={p.sigla}>{p.nome}</option>)}
            </select>
          </div>
          <div className="crow">
            <button className="csend" disabled={busy || !texto.trim()} onClick={analisar}>
              {busy ? "Lendo..." : "Analisar a lista"}
            </button>
          </div>
        </>
      )}

      {itens && (
        <>
          <p className="chint">
            Entendi <b>{itens.length}</b> clínica(s). {marcados} marcada(s) para importar.
            Desmarque o que não quiser. {cortados > 0 && <b>{cortados} ficaram de fora do limite de 200 — cole o resto depois.</b>}
          </p>
          <div className="dialist">
            {itens.map((i, idx) => (
              <label className={`improw${fora.has(idx) ? " off" : ""}`} key={idx}>
                <input type="checkbox" checked={!fora.has(idx)} onChange={() => alternar(idx)} />
                <span className="impmain">
                  <b>{i.clinic}</b>
                  <span className="impsub">
                    {[i.city, i.country].filter(Boolean).join(" · ")}
                    {i.contact ? ` · ${i.contact}` : ""}
                  </span>
                  <span className="impsub">{i.email ?? "sem e-mail"}{i.phone ? ` · ${i.phone}` : ""}</span>
                  {i.emailBody && <span className="impok">e-mail já redigido: &quot;{(i.subject ?? "").slice(0, 60)}&quot;</span>}
                  {i.existing && <span className="impwarn">já cadastrada no painel</span>}
                  {i.warnings.map((w) => <span className="impwarn" key={w}>{w}</span>)}
                </span>
              </label>
            ))}
          </div>
          <div className="crow">
            <button className="csend" disabled={busy || !marcados} onClick={importar}>
              {busy ? "Importando..." : `Importar ${marcados} clínica(s)`}
            </button>
            <button className="ccancel" disabled={busy} onClick={() => { setItens(null); setMsg(null); }}>
              Voltar e corrigir a lista
            </button>
          </div>
        </>
      )}

      {msg && <p className={`nvmsg nv-${msg.kind}`}>{msg.text}</p>}
    </section>
  );
}
