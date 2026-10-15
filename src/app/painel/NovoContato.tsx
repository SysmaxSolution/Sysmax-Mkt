"use client";

import { useMemo, useState } from "react";
import { montarTelefone } from "@/lib/phone-intl";
import { paisPorSigla } from "@/lib/paises";
import CampoPais from "./CampoPais";

// ===========================================================================
// Contato que a equipe encontrou por conta própria: cadastra e dispara no mesmo
// lugar, sem depender da fila descoberta pelo Places. Nasceu do pedido da
// captação (2026-10-15) — a prospecção dela é no exterior, por isso o país é
// campo de primeira classe. Usa as classes CSS injetadas por /painel.
// ===========================================================================

export type Quota = { cap: number; sent: number; remaining: number };

export default function NovoContato({ token, onQuota }: { token: string; onQuota: (q: Quota) => void }) {
  const [f, setF] = useState({ clinic: "", contact: "", city: "", country: "US", email: "", phone: "", notes: "" });
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  async function criarLead(): Promise<{ leadId: string; aviso?: string } | null> {
    const res = await fetch("/api/painel/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: JSON.stringify(f),
    });
    const d = await res.json();
    if (!d.ok) { setMsg({ kind: "err", text: d.error ?? "Não consegui salvar a clínica." }); return null; }
    if (d.optedOut) { setMsg({ kind: "err", text: d.message }); return null; }
    return { leadId: d.leadId, aviso: d.existing ? d.message : undefined };
  }

  async function enviarEmail() {
    if (!f.email) { setMsg({ kind: "err", text: "Preencha o e-mail da clínica." }); return; }
    if (!subject.trim() || !body.trim()) { setMsg({ kind: "err", text: "Escreva o assunto e a mensagem." }); return; }
    setBusy(true); setMsg(null);
    try {
      const lead = await criarLead();
      if (!lead) return;
      const res = await fetch("/api/painel/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ leadId: lead.leadId, subject, body }),
      });
      const d = await res.json();
      if (d.quota) onQuota(d.quota);
      if (!d.ok) { setMsg({ kind: "err", text: d.error ?? "Não foi possível enviar." }); return; }
      setMsg({
        kind: "ok",
        text: `${lead.aviso ? lead.aviso + " " : ""}E-mail enviado para ${d.to}. Ainda cabem ${d.quota?.remaining ?? "?"} hoje.`,
      });
      setF((p) => ({ ...p, clinic: "", contact: "", city: "", email: "", phone: "", notes: "" }));
    } catch {
      setMsg({ kind: "err", text: "Falha de rede. Confira se saiu antes de repetir, para não enviar duas vezes." });
    } finally { setBusy(false); }
  }

  async function abrirWhatsapp() {
    if (!f.phone) { setMsg({ kind: "err", text: "Preencha o WhatsApp da clínica." }); return; }
    const num = montarTelefone(f.phone, f.country);
    if (!num.ok) { setMsg({ kind: "err", text: num.erro }); return; }
    setBusy(true); setMsg(null);
    try {
      const lead = await criarLead();
      if (!lead) return;
      const texto = body.trim();
      window.open(`https://wa.me/${num.e164}${texto ? `?text=${encodeURIComponent(texto)}` : ""}`, "_blank", "noopener");
      await fetch("/api/painel/contato-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ leadId: lead.leadId, channel: "whatsapp", body: texto }),
      });
      setMsg({ kind: "ok", text: `${lead.aviso ? lead.aviso + " " : ""}WhatsApp aberto e registrado no seu dia.` });
    } catch {
      setMsg({ kind: "err", text: "Não consegui registrar o contato." });
    } finally { setBusy(false); }
  }

  const ddi = paisPorSigla(f.country)?.ddi;
  // Mostra o número final ANTES de abrir o WhatsApp: em 15/10 um telefone
  // brasileiro foi cadastrado com o país US e o link abriu a conversa errada.
  const fone = useMemo(() => (f.phone.trim() ? montarTelefone(f.phone, f.country) : null), [f.phone, f.country]);

  return (
    <section className="novo">
      <p className="nvhint">
        Para clínicas que <b>você</b> encontrou. Cadastra e dispara aqui mesmo, sem depender da lista do painel.
        Tudo que sair daqui entra no seu relatório em <b>Meu dia</b>.
      </p>

      <div className="nvgrid">
        <div className="nvf nvf-wide">
          <label className="clabel" htmlFor="nv-clinic">Nome da clínica</label>
          <input id="nv-clinic" className="cinput" value={f.clinic} onChange={set("clinic")} placeholder="Star Veterinary Clinic" />
        </div>
        <div className="nvf">
          <label className="clabel" htmlFor="nv-contact">Responsável (opcional)</label>
          <input id="nv-contact" className="cinput" value={f.contact} onChange={set("contact")} placeholder="Dr. Vito" />
        </div>
        <div className="nvf">
          <CampoPais valor={f.country} onChange={(sigla) => setF((p) => ({ ...p, country: sigla }))} id="nv-country" />
        </div>
        <div className="nvf">
          <label className="clabel" htmlFor="nv-city">Cidade</label>
          <input id="nv-city" className="cinput" value={f.city} onChange={set("city")} placeholder="Dubai" />
        </div>
        <div className="nvf">
          <label className="clabel" htmlFor="nv-email">E-mail</label>
          <input id="nv-email" className="cinput" type="email" value={f.email} onChange={set("email")} placeholder="info@starvetclinic.com" />
        </div>
        <div className="nvf">
          <label className="clabel" htmlFor="nv-phone">
            WhatsApp {ddi && <span className="ddi">código do país: {ddi}</span>}
          </label>
          <input id="nv-phone" className="cinput" value={f.phone} onChange={set("phone")} placeholder={ddi ? ddi + " ..." : ""} />
          {fone && (fone.ok
            ? <span className={`fonechk${fone.aviso ? " warn" : ""}`}>
                {fone.aviso ? fone.aviso : `Vai abrir: ${fone.exibicao}`}
              </span>
            : <span className="fonechk err">{fone.erro}</span>)}
        </div>
        <div className="nvf nvf-wide">
          <label className="clabel" htmlFor="nv-notes">Observações (só para nós)</label>
          <input id="nv-notes" className="cinput" value={f.notes} onChange={set("notes")} placeholder="Como encontrei, o que chamou atenção..." />
        </div>
      </div>

      <label className="clabel" htmlFor="nv-subj">Assunto do e-mail</label>
      <input id="nv-subj" className="cinput" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
      <label className="clabel" htmlFor="nv-body">Mensagem</label>
      <textarea id="nv-body" className="ctext" rows={12} value={body} onChange={(e) => setBody(e.target.value)}
        placeholder="Escreva aqui. Serve para o e-mail e, se quiser, para o WhatsApp." />
      <p className="chint">
        O e-mail sai do endereço da empresa. Quem responder cai no seu Gmail. O link de descadastro entra sozinho no final, como a lei exige.
      </p>
      <div className="crow">
        <button className="csend" disabled={busy} onClick={enviarEmail}>
          {busy ? "Aguarde..." : "Cadastrar e enviar e-mail"}
        </button>
        <button className="cwa" disabled={busy} onClick={abrirWhatsapp}>
          {fone?.ok ? `Cadastrar e abrir WhatsApp ${fone.exibicao}` : "Cadastrar e abrir WhatsApp"}
        </button>
      </div>
      {msg && <p className={`nvmsg nv-${msg.kind}`}>{msg.text}</p>}
    </section>
  );
}
