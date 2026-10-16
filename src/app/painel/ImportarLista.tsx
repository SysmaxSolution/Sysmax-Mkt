"use client";

import { useState } from "react";
import CampoPais from "./CampoPais";

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
  // Ficha do Keep da captacao: quem pedir para falar, registro, CNPJ, sistema
  // atual e o historico dela. Mostrar isso na previa e a unica prova de que a
  // pesquisa dela chegou inteira -- antes o cartao so exibia nome e contato.
  uf?: string | null; nota?: string | null;
  responsavel?: string | null; crmv?: string | null; cnpj?: string | null; sistema?: string | null;
};

// Quando a chamada de importacao falha de verdade (tempo estourado, resposta
// que nao e JSON, erro do gateway), o servidor nao registra nada -- so o
// navegador sabe. Ele conta, para a proxima pergunta "deu certo?" ter resposta.
async function contarFalha(token: string, etapa: string, status: number, chars: number, detalhe: string) {
  try {
    await fetch("/api/painel/importar/falha", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: JSON.stringify({ etapa, status, chars, detalhe }),
    });
  } catch {
    /* se nem isso passa, e rede mesmo */
  }
}

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
      const bruto = await res.text();
      let d: { ok?: boolean; error?: string; itens?: Item[]; cortados?: number };
      try {
        d = JSON.parse(bruto);
      } catch {
        // Resposta que nao e JSON = a rota nem chegou a responder (tempo
        // estourado, pagina de erro do gateway). Antes isso virava um
        // "falha de rede" generico e o motivo se perdia.
        await contarFalha(token, "previa", res.status, texto.length, bruto.slice(0, 200));
        setMsg({ kind: "err", text: `O servidor respondeu erro ${res.status} e a lista não foi lida. Já registrei aqui — se o texto for muito grande, cole em partes menores.` });
        return;
      }
      if (!d.ok) {
        await contarFalha(token, "previa", res.status, texto.length, d.error ?? "");
        setMsg({ kind: "err", text: d.error ?? "Não consegui ler a lista." });
        return;
      }
      setItens(d.itens ?? []);
      setCortados(d.cortados ?? 0);
      // Já cadastradas e sem contato vêm desmarcadas: importar não faria nada.
      const desmarcar = new Set<number>();
      (d.itens as Item[]).forEach((i, idx) => { if (i.existing || (!i.email && !i.phone)) desmarcar.add(idx); });
      setFora(desmarcar);
    } catch (e) {
      await contarFalha(token, "previa", 0, texto.length, String(e).slice(0, 200));
      setMsg({ kind: "err", text: "A conexão caiu no meio do envio. Se a lista for muito grande, cole em partes menores — já registrei aqui para eu conferir." });
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
      const bruto = await res.text();
      let d: { ok?: boolean; error?: string; criados?: number; pulados?: number; rascunhos?: number };
      try {
        d = JSON.parse(bruto);
      } catch {
        await contarFalha(token, "gravacao", res.status, 0, bruto.slice(0, 200));
        setMsg({ kind: "err", text: `O servidor respondeu erro ${res.status} e nada foi gravado. Já registrei aqui.` });
        return;
      }
      if (!d.ok) {
        await contarFalha(token, "gravacao", res.status, 0, d.error ?? "");
        setMsg({ kind: "err", text: d.error ?? "Não consegui importar." });
        return;
      }
      const extra = d.pulados ? ` ${d.pulados} já estavam cadastradas e foram puladas.` : "";
      const prontos = d.rascunhos ? ` ${d.rascunhos} já vieram com o e-mail escrito, é só conferir e enviar.` : "";
      setMsg({ kind: "ok", text: `${d.criados} clínica(s) importada(s).${extra}${prontos} Já aparecem na aba Prospectos.` });
      setItens(null); setTexto(""); onImportou();
    } catch (e) {
      await contarFalha(token, "gravacao", 0, 0, String(e).slice(0, 200));
      setMsg({ kind: "err", text: "A conexão caiu no meio da gravação. Já registrei aqui para eu conferir." });
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
          <div className="nvf" style={{ maxWidth: 320 }}>
            <CampoPais valor={paisPadrao} onChange={setPaisPadrao} id="imp-pais"
              label="Se a lista não disser o país, considerar" />
          </div>
          {texto.length > 60_000 && (
            <p className="impfalta">
              Esse texto tem <b>{texto.length.toLocaleString("pt-BR")}</b> caracteres. Lista muito
              grande costuma travar no caminho — <b>cole em partes</b> (umas 30 clínicas por vez) que entra inteiro.
            </p>
          )}
          <div className="crow">
            <button className="csend" disabled={busy || !texto.trim()} onClick={analisar}>
              {busy ? "Lendo..." : "Analisar a lista"}
            </button>
            {texto.trim() && <span className="chint">{texto.length.toLocaleString("pt-BR")} caracteres colados</span>}
          </div>
        </>
      )}

      {itens && (
        <>
          {/* Dois passos enganam: a previa parece conclusao. Ela colou a
              carteira, viu a lista na tela e perguntou "deu certo?" -- nada
              havia sido salvo. O aviso tem que ser impossivel de nao ver. */}
          <p className="impfalta">
            Ainda <b>não salvei nada</b>. Isto é só a conferência — clique em
            <b> &quot;Importar {marcados} clínica(s)&quot;</b> no final da lista para gravar de verdade.
          </p>
          <p className="chint">
            Entendi <b>{itens.length}</b> clínica(s). {marcados} marcada(s) para importar.
            Desmarque o que não quiser. {cortados > 0 && <b>{cortados} ficaram de fora do limite de 200 — cole o resto depois.</b>}
          </p>
          <div className="crow">
            <button className="csend" disabled={busy || !marcados} onClick={importar}>
              {busy ? "Importando..." : `Importar ${marcados} clínica(s) agora`}
            </button>
          </div>
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
                  {i.responsavel && <span className="impok">falar com: {i.responsavel}{i.crmv ? ` · ${i.crmv}` : ""}</span>}
                  {i.cnpj && <span className="impsub">CNPJ {i.cnpj}</span>}
                  {i.sistema && <span className="impsub">raio-X: {i.sistema.slice(0, 90)}</span>}
                  {i.nota && <span className="impsub">anotação: {i.nota.slice(0, 110)}</span>}
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
