"use client";

import { useCallback, useEffect, useState } from "react";

// ===========================================================================
// Worklist manual: clínicas sem e-mail que o FUNDADOR aborda à mão (ligação /
// DM). O bot só preparou o roteiro; aqui você executa e marca "Feito" ou "Pular".
// ===========================================================================

type Lead = { company_name?: string; name?: string; city?: string; uf?: string; phone?: string; instagram_handle?: string };
type Item = { id: string; channel: "call" | "ig_dm"; body: string; status: string; lead: Lead | null };

const teal = "#0d9488";

export default function WorklistPage() {
  const [token, setToken] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem("sysmax_admin_token") ?? "" : "";
    setToken(t);
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setMsg("");
    try {
      const res = await fetch("/api/admin/outbox/list?kind=manual", { headers: { "x-admin-token": token } });
      if (res.status === 401) { setMsg("Token inválido."); setItems([]); return; }
      const data = await res.json();
      setItems(data.items ?? []);
    } catch { setMsg("Falha ao carregar."); } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { if (token) load(); }, [token, load]);

  function saveToken() { localStorage.setItem("sysmax_admin_token", token); load(); }

  async function act(action: "done" | "reject", id: string) {
    const res = await fetch("/api/admin/outbox/action", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: JSON.stringify({ action, ids: [id] }),
    });
    const data = await res.json();
    setMsg(res.ok ? `OK — ${action}.` : `Erro: ${data.error}`);
    load();
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 820, margin: "0 auto", padding: "32px 20px", color: "#0f172a" }}>
      <h1 style={{ color: teal, marginBottom: 4 }}>Worklist — ligação / DM</h1>
      <p style={{ color: "#64748b", marginTop: 0 }}>Clínicas sem e-mail. O bot preparou o roteiro; você liga/DM e marca o resultado.</p>

      <div style={{ display: "flex", gap: 8, margin: "16px 0" }}>
        <input type="password" placeholder="ADMIN_TOKEN" value={token} onChange={(e) => setToken(e.target.value)}
          style={{ flex: 1, padding: 8, border: "1px solid #cbd5e1", borderRadius: 8 }} />
        <button onClick={saveToken} style={btn(teal)}>Entrar</button>
        <button onClick={load} style={btn("#475569")}>Recarregar</button>
      </div>

      {msg && <div style={{ padding: 10, background: "#f1f5f9", borderRadius: 8, marginBottom: 12 }}>{msg}</div>}
      {loading ? <p>Carregando…</p> : (
        <>
          <strong>{items.length} tarefa(s) na fila</strong>
          {items.map((it) => {
            const lead = it.lead;
            const isCall = it.channel === "call";
            const igUser = lead?.instagram_handle;
            return (
              <div key={it.id} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, margin: "14px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#64748b" }}>
                  <span><b style={{ color: teal }}>{isCall ? "LIGAÇÃO" : "DM INSTAGRAM"}</b> · {lead?.company_name ?? lead?.name ?? "?"} · {lead?.city ?? "?"}/{lead?.uf ?? "?"}</span>
                  <span>
                    {isCall && lead?.phone && <a href={`tel:+${lead.phone}`} style={{ color: teal }}>+{lead.phone}</a>}
                    {!isCall && igUser && <a href={`https://instagram.com/${igUser}`} target="_blank" rel="noreferrer" style={{ color: teal }}>@{igUser}</a>}
                  </span>
                </div>
                <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 14, background: "#f8fafc", padding: 12, borderRadius: 8, margin: "10px 0" }}>{it.body}</pre>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => act("done", it.id)} style={btn(teal)}>Feito ✓</button>
                  <button onClick={() => act("reject", it.id)} style={btn("#dc2626")}>Pular</button>
                </div>
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
