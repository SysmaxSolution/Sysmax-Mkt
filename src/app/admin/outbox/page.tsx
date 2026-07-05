"use client";

import { useCallback, useEffect, useState } from "react";

// ===========================================================================
// Painel de aprovação do outbound (fundador no gatilho). Nada é enviado sem
// passar por aqui. O token admin fica só no localStorage do navegador e vai
// em cada request no header x-admin-token.
// ===========================================================================

type Lead = { company_name?: string; name?: string; city?: string; uf?: string; email?: string; phone?: string };
type Item = {
  id: string;
  channel: "email" | "whatsapp";
  subject?: string;
  body: string;
  status: "draft" | "approved";
  created_at: string;
  lead: Lead | null;
};

const teal = "#0d9488";
const amber = "#f59e0b";

export default function OutboxPage() {
  const [token, setToken] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [edits, setEdits] = useState<Record<string, { subject: string; body: string }>>({});

  useEffect(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem("sysmax_admin_token") ?? "" : "";
    setToken(t);
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch("/api/admin/outbox/list", { headers: { "x-admin-token": token } });
      if (res.status === 401) { setMsg("Token inválido."); setItems([]); return; }
      const data = await res.json();
      setItems(data.items ?? []);
    } catch {
      setMsg("Falha ao carregar.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { if (token) load(); }, [token, load]);

  function saveToken() {
    localStorage.setItem("sysmax_admin_token", token);
    load();
  }

  async function act(action: "approve" | "reject", ids: string[], one?: Item) {
    const payload: Record<string, unknown> = { action, ids };
    if (action === "approve" && ids.length === 1 && one) {
      const e = edits[one.id];
      if (e) { payload.subject = e.subject; payload.body = e.body; }
    }
    const res = await fetch("/api/admin/outbox/action", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setMsg(res.ok ? `OK — ${action} em ${data.updated} item(ns).` : `Erro: ${data.error}`);
    load();
  }

  const drafts = items.filter((i) => i.status === "draft");

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 820, margin: "0 auto", padding: "32px 20px", color: "#0f172a" }}>
      <h1 style={{ color: teal, marginBottom: 4 }}>Outbox — aprovação de disparos</h1>
      <p style={{ color: "#64748b", marginTop: 0 }}>Nada é enviado sem sua aprovação. Aprovados entram no envio aquecido.</p>

      <div style={{ display: "flex", gap: 8, margin: "16px 0" }}>
        <input
          type="password"
          placeholder="ADMIN_TOKEN"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          style={{ flex: 1, padding: 8, border: "1px solid #cbd5e1", borderRadius: 8 }}
        />
        <button onClick={saveToken} style={btn(teal)}>Entrar</button>
        <button onClick={load} style={btn("#475569")}>Recarregar</button>
      </div>

      {msg && <div style={{ padding: 10, background: "#f1f5f9", borderRadius: 8, marginBottom: 12 }}>{msg}</div>}

      {loading ? <p>Carregando…</p> : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>{drafts.length} rascunho(s) · {items.length - drafts.length} aprovado(s) na fila</strong>
            {drafts.length > 0 && (
              <button onClick={() => act("approve", drafts.map((d) => d.id))} style={btn(amber)}>
                Aprovar todos os rascunhos
              </button>
            )}
          </div>

          {items.map((it) => {
            const ed = edits[it.id] ?? { subject: it.subject ?? "", body: it.body };
            const lead = it.lead;
            return (
              <div key={it.id} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, margin: "14px 0", background: it.status === "approved" ? "#f0fdfa" : "#fff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#64748b" }}>
                  <span>
                    <b style={{ color: teal }}>{it.channel.toUpperCase()}</b> · {lead?.company_name ?? lead?.name ?? "?"} · {lead?.city ?? "?"}/{lead?.uf ?? "?"}
                  </span>
                  <span>{it.status}{it.channel === "email" ? ` · ${lead?.email ?? ""}` : ` · ${lead?.phone ?? ""}`}</span>
                </div>

                {it.channel === "email" && (
                  <input
                    value={ed.subject}
                    onChange={(e) => setEdits({ ...edits, [it.id]: { ...ed, subject: e.target.value } })}
                    disabled={it.status !== "draft"}
                    style={{ width: "100%", padding: 8, margin: "10px 0", border: "1px solid #cbd5e1", borderRadius: 8, fontWeight: 600 }}
                  />
                )}
                <textarea
                  value={ed.body}
                  onChange={(e) => setEdits({ ...edits, [it.id]: { ...ed, body: e.target.value } })}
                  disabled={it.status !== "draft"}
                  rows={7}
                  style={{ width: "100%", padding: 10, border: "1px solid #cbd5e1", borderRadius: 8, fontFamily: "inherit", fontSize: 14 }}
                />

                {it.status === "draft" && (
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button onClick={() => act("approve", [it.id], it)} style={btn(teal)}>Aprovar</button>
                    <button onClick={() => act("reject", [it.id])} style={btn("#dc2626")}>Rejeitar</button>
                  </div>
                )}
              </div>
            );
          })}
          {!loading && items.length === 0 && token && <p style={{ color: "#64748b" }}>Nada na fila.</p>}
        </>
      )}
    </main>
  );
}

function btn(bg: string): React.CSSProperties {
  return { background: bg, color: "#fff", border: "none", padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 600 };
}
