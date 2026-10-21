"use client";

import { useCallback, useEffect, useState } from "react";

// ===========================================================================
// Aba WhatsApp — pareamento da instância do analista (QR code) + conversas
// com histórico cronológico. Enviar por aqui é o próprio registro: não existe
// "copiar e colar no WhatsApp do celular" mais, nem botão de marcar que fez.
// ===========================================================================

type Account = { id: string; analyst_name: string; evolution_instance_id: string; phone_e164: string | null; status: string };
type Conversation = {
  id: string;
  wa_account_id: string;
  analyst_name: string;
  contact_phone: string;
  contact_name: string | null;
  last_message_at: string | null;
  needs_director_review: boolean;
  ai_suggestion: string | null;
};
type Message = { id: string; direction: "in" | "out"; body: string; sent_at: string };

export default function WhatsAppView({ token }: { token: string }) {
  const [analystName, setAnalystName] = useState("");
  const [account, setAccount] = useState<Account | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [state, setState] = useState<string>("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const h = { "Content-Type": "application/json", "x-admin-token": token };

  const loadConversations = useCallback(async () => {
    const res = await fetch("/api/painel/whatsapp/conversations", { headers: { "x-admin-token": token } });
    const data = await res.json().catch(() => null);
    if (data?.ok) setConversations(data.conversations);
  }, [token]);

  useEffect(() => {
    loadConversations();
    const t = setInterval(loadConversations, 15_000);
    return () => clearInterval(t);
  }, [loadConversations]);

  async function loadMessages(conversationId: string) {
    setActiveId(conversationId);
    const res = await fetch(`/api/painel/whatsapp/messages?conversationId=${conversationId}`, {
      headers: { "x-admin-token": token },
    });
    const data = await res.json().catch(() => null);
    if (data?.ok) setMessages(data.messages);
  }

  async function pareiarInstancia() {
    if (!analystName.trim()) return;
    setBusy(true);
    setErro(null);
    try {
      const res = await fetch("/api/painel/whatsapp/account", {
        method: "POST",
        headers: h,
        body: JSON.stringify({ analystName: analystName.trim() }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setAccount(data.account);
      setQr(data.qr);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verificarConexao() {
    if (!account) return;
    const res = await fetch(`/api/painel/whatsapp/account?analystName=${encodeURIComponent(account.analyst_name)}`, {
      headers: { "x-admin-token": token },
    });
    const data = await res.json().catch(() => null);
    if (data?.ok) {
      setState(data.state);
      setAccount(data.account);
      setQr(data.qr);
    }
  }

  async function enviar() {
    if (!activeId || !draft.trim()) return;
    setBusy(true);
    setErro(null);
    try {
      const res = await fetch("/api/painel/whatsapp/send", {
        method: "POST",
        headers: h,
        body: JSON.stringify({ conversationId: activeId, body: draft.trim() }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setDraft("");
      await loadMessages(activeId);
      await loadConversations();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const active = conversations.find((c) => c.id === activeId) ?? null;

  return (
    <div className="whatsapp-view">
      <div className="wa-pareamento">
        <h3>Vincular meu WhatsApp</h3>
        <p className="note">
          Cada analista usa o próprio número. Escaneie o QR code uma vez — depois disso, toda mensagem enviada e
          recebida pelo painel fica registrada automaticamente, sem precisar marcar nada.
        </p>
        <input
          placeholder="Seu nome (ex.: Jéssica)"
          value={analystName}
          onChange={(e) => setAnalystName(e.target.value)}
        />
        <button onClick={pareiarInstancia} disabled={busy}>Gerar QR code</button>
        {account && <button onClick={verificarConexao} disabled={busy}>Verificar conexão</button>}
        {state && <p className="note">Estado: {state === "open" ? "conectado ✅" : state === "connecting" ? "aguardando leitura do QR…" : state}</p>}
        {qr && <img src={qr} alt="QR code WhatsApp" style={{ width: 220, height: 220 }} />}
        {erro && <p className="erro">{erro}</p>}
      </div>

      <div className="wa-conversas">
        <h3>Conversas</h3>
        <ul className="wa-lista">
          {conversations.map((c) => (
            <li
              key={c.id}
              className={c.id === activeId ? "on" : ""}
              onClick={() => loadMessages(c.id)}
              style={c.needs_director_review ? { borderLeft: "3px solid #d97757" } : undefined}
            >
              <b>{c.contact_name ?? c.contact_phone}</b> · {c.analyst_name}
              {c.needs_director_review && <span className="badge"> precisa de revisão</span>}
            </li>
          ))}
          {conversations.length === 0 && <li className="note">Nenhuma conversa ainda.</li>}
        </ul>
      </div>

      {active && (
        <div className="wa-chat">
          <h3>{active.contact_name ?? active.contact_phone}</h3>
          {active.ai_suggestion && <p className="note">⚠ {active.ai_suggestion}</p>}
          <div className="wa-mensagens">
            {messages.map((m) => (
              <p key={m.id} className={m.direction === "out" ? "wa-out" : "wa-in"}>
                {m.body}
              </p>
            ))}
          </div>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Escreva a mensagem…" />
          <button onClick={enviar} disabled={busy || !draft.trim()}>Enviar</button>
        </div>
      )}
    </div>
  );
}
