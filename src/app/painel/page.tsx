"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// ===========================================================================
// /painel — Painel comercial ao vivo para a equipe. Lê a fila consolidada do
// CRM (/api/admin/worklist/full) com o canal recomendado por clínica. A equipe
// entra com o VIEWER_TOKEN, filtra por canal, busca, copia a mensagem, abre o
// contato (WhatsApp/e-mail/Instagram) e marca feito/pular. Não aprova disparos.
// ===========================================================================

type Msg = { id: string; channel: string; channelLabel: string; subject: string | null; body: string; status: string };
type Row = {
  clinic: string; city: string | null; uf: string | null;
  phone: string | null; email: string | null; instagram: string | null; website: string | null;
  recommended: string; recommendedReason: string; messages: Msg[];
};

const REC: Record<string, { label: string; key: string }> = {
  email: { label: "E-mail", key: "email" },
  ig_dm: { label: "Instagram DM", key: "ig" },
  whatsapp_manual: { label: "WhatsApp", key: "wa" },
  call: { label: "Ligação", key: "call" },
};

function phoneDisplay(p: string | null): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, "").replace(/^55/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return p;
}
function primaryOf(r: Row): Msg {
  const pref = r.recommended === "whatsapp_manual" ? "email" : r.recommended === "ig_dm" ? "ig_dm" : r.recommended === "call" ? "call" : "email";
  return r.messages.find((m) => m.channel === pref) ?? r.messages[0];
}

export default function PainelPage() {
  const [token, setToken] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({ email: 0, ig: 0, wa: 0, call: 0 });
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "authed" | "error">("idle");
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem("sysmax_viewer_token") ?? "" : "";
    setToken(t);
  }, []);

  const load = useCallback(async (tk: string) => {
    if (!tk) return;
    setState("loading"); setNote("");
    try {
      const res = await fetch("/api/admin/worklist/full", { headers: { "x-admin-token": tk } });
      if (res.status === 401) { setState("error"); setNote("Token inválido. Peça o link/senha de acesso à equipe da Sysmax."); setRows([]); return; }
      const data = await res.json();
      if (!data.ok) { setState("error"); setNote(data.error ?? "Falha ao carregar."); return; }
      setRows(data.rows ?? []); setCounts(data.counts ?? {}); setState("authed");
    } catch { setState("error"); setNote("Falha de rede ao carregar."); }
  }, []);

  useEffect(() => { if (token) load(token); }, [token, load]);

  function entrar() { localStorage.setItem("sysmax_viewer_token", token); load(token); }

  async function copy(id: string, text: string) {
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
    setCopied(id); setTimeout(() => setCopied((c) => (c === id ? null : c)), 1400);
  }

  async function act(action: "done" | "reject", id: string, clinic: string) {
    try {
      const res = await fetch("/api/admin/outbox/action", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ action, ids: [id] }),
      });
      if (!res.ok) { setNote("Não foi possível registrar a ação."); return; }
      setRows((prev) => prev.map((r) => ({ ...r, messages: r.messages.filter((m) => m.id !== id) })).filter((r) => r.messages.length));
      setNote(action === "done" ? `Marcado como feito: ${clinic}` : `Pulado: ${clinic}`);
    } catch { setNote("Falha de rede."); }
  }

  const total = rows.length;
  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      const rk = REC[r.recommended]?.key ?? "call";
      const okF = filter === "all" || rk === filter;
      const okQ = !term || `${r.clinic} ${r.city ?? ""}`.toLowerCase().includes(term);
      return okF && okQ;
    });
  }, [rows, filter, q]);

  if (state !== "authed") {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <div className="wrap gate">
          <div className="eyebrow">Sysmax Software · Esteira Comercial</div>
          <h1>Painel comercial</h1>
          <p className="sub">Acesso da equipe comercial. Cole a senha de leitura para ver a lista de clínicas com a mensagem e o canal de cada uma.</p>
          <div className="gatebox">
            <input className="search" type="password" placeholder="Senha de acesso" value={token}
              onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === "Enter" && entrar()} aria-label="Senha de acesso" />
            <button className="allbtn active" onClick={entrar}>Entrar</button>
          </div>
          {state === "loading" && <p className="sub">Carregando…</p>}
          {note && <p className="notemsg">{note}</p>}
        </div>
      </>
    );
  }

  const kpi = (f: string, n: number, label: string, dot?: string) => (
    <div className={`kpi${filter === f && f !== "all" ? " active" : ""}`} onClick={() => setFilter(f)}>
      <div className="n tnum">{n}</div>
      <div className="l">{dot && <span className={`dot ${dot}`} />}{label}</div>
    </div>
  );

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="wrap">
        <header className="top">
          <div className="eyebrow">Sysmax Software · Esteira Comercial</div>
          <h1>Prospectos prontos para abordar</h1>
          <p className="sub">{total} clínicas veterinárias com mensagem já redigida, cada uma no canal com maior chance de resposta. Clique num contato para abrir o canal; use <b>Copiar</b> para levar a mensagem. Ao contatar, marque <b>Feito</b> (ou <b>Pular</b>) para tirar da fila.</p>
        </header>

        <div className="kpis">
          {kpi("all", total, "Todas prontas")}
          {kpi("email", counts.email ?? 0, "E-mail", "email")}
          {kpi("ig", counts.ig ?? 0, "Instagram DM", "ig")}
          {kpi("wa", counts.wa ?? 0, "WhatsApp", "wa")}
          {kpi("call", counts.call ?? 0, "Ligação", "call")}
        </div>

        <div className="toolbar">
          <input className="search" type="search" placeholder="Buscar clínica ou cidade…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
          <button className={`allbtn${filter === "all" ? " active" : ""}`} onClick={() => setFilter("all")}>Ver todas</button>
        </div>

        {note && <p className="notemsg">{note}</p>}

        <div className="grid">
          {visible.map((r, i) => {
            const rk = REC[r.recommended]?.key ?? "call";
            const recLabel = REC[r.recommended]?.label ?? r.recommended;
            const primary = primaryOf(r);
            const ordered = [primary, ...r.messages.filter((m) => m !== primary)];
            const waPhone = r.phone ? r.phone.replace(/\D/g, "") : null;
            return (
              <article className="card" key={i}>
                <header className="card-top">
                  <div className={`rec rec-${rk}`}>{recLabel}</div>
                  <div className="titlewrap">
                    <h3>{r.clinic}</h3>
                    <span className="loc">{r.city}/{r.uf}</span>
                  </div>
                </header>
                <p className="why">{r.recommendedReason}</p>
                <div className="chips">
                  {waPhone && <a className="chip chip-wa" href={`https://wa.me/${waPhone}`} target="_blank" rel="noopener noreferrer">WhatsApp · {phoneDisplay(r.phone)}</a>}
                  {waPhone && <a className="chip" href={`tel:+${waPhone}`}>Ligar</a>}
                  {r.instagram && <a className="chip chip-ig" href={`https://instagram.com/${r.instagram}`} target="_blank" rel="noopener noreferrer">@{r.instagram}</a>}
                  {r.email && <a className="chip chip-em" href={`mailto:${r.email}?subject=${encodeURIComponent(primary?.subject ?? "")}&body=${encodeURIComponent(primary?.body ?? "")}`}>{r.email}</a>}
                  {r.website && <a className="chip chip-web" href={r.website} target="_blank" rel="noopener noreferrer">site</a>}
                </div>
                {r.recommended === "whatsapp_manual" && (
                  <p className="note">O e-mail cadastrado é pessoal/inválido — envie por <b>WhatsApp</b>. O texto abaixo (rascunho de e-mail) serve de base; encurte para o tom de zap.</p>
                )}
                {ordered.map((m, j) => (
                  <div className={`msg${j === 0 ? " msg-primary" : ""}`} key={m.id}>
                    <div className="msg-head">
                      <span className={`msg-ch ch-${m.channel}`}>{m.channelLabel}{j === 0 ? " · recomendado" : ""}</span>
                      <button className={`copy${copied === m.id ? " done" : ""}`} onClick={() => copy(m.id, (m.subject ? "Assunto: " + m.subject + "\n\n" : "") + m.body)}>{copied === m.id ? "Copiado ✓" : "Copiar"}</button>
                    </div>
                    {m.subject && <div className="subj">{m.subject}</div>}
                    <pre className="body">{m.body}</pre>
                    <div className="acts">
                      <button className="act-done" onClick={() => act("done", m.id, r.clinic)}>Feito ✓</button>
                      <button className="act-skip" onClick={() => act("reject", m.id, r.clinic)}>Pular</button>
                    </div>
                  </div>
                ))}
              </article>
            );
          })}
          {!visible.length && <p className="empty">Nenhuma clínica com esse filtro.</p>}
        </div>

        <footer>
          Canal recomendado por heurística de alcance B2B. Nada é enviado automaticamente por esta tela — a equipe contata pelo canal indicado e registra o resultado. Fonte: CRM sysmax-sales-agent.
        </footer>
      </div>
    </>
  );
}

const CSS = `
  :root{
    --bg:#F5F7F6; --surface:#FFFFFF; --surface-2:#F0F3F1; --ink:#141F1B; --muted:#5A6A63;
    --border:#E1E7E3; --accent:#0E7C66; --accent-ink:#0A5A4A;
    --email:#4F46E5; --ig:#D6336C; --wa:#12925A; --call:#B45309;
    --email-bg:#EEF0FE; --ig-bg:#FDECF3; --wa-bg:#E6F5EC; --call-bg:#FBF0E1;
    --shadow:0 1px 2px rgba(20,31,27,.04),0 4px 16px rgba(20,31,27,.05);
  }
  @media (prefers-color-scheme:dark){:root{
    --bg:#0D1512; --surface:#151F1B; --surface-2:#1B2723; --ink:#E7EFEB; --muted:#93A69D;
    --border:#27332E; --accent:#2DD4BF; --accent-ink:#5EEAD4;
    --email:#8B93FF; --ig:#F472A6; --wa:#4FCB86; --call:#E0A45C;
    --email-bg:#1D2140; --ig-bg:#33202B; --wa-bg:#172B22; --call-bg:#2E2416;
    --shadow:0 1px 2px rgba(0,0,0,.3),0 4px 18px rgba(0,0,0,.35);
  }}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:var(--bg)}
  body{color:var(--ink);font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1100px;margin:0 auto;padding:32px 20px 80px}
  .wrap.gate{max-width:560px;padding-top:64px}
  .tnum{font-variant-numeric:tabular-nums}
  .eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);font-weight:700}
  h1{font-size:clamp(24px,4vw,34px);margin:.15em 0 .1em;letter-spacing:-.02em;text-wrap:balance}
  .sub{color:var(--muted);font-size:15px;max-width:70ch}
  .gatebox{display:flex;gap:8px;margin:20px 0 8px}
  .notemsg{color:var(--accent-ink);font-size:14px;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-top:12px}
  .kpis{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0 8px}
  .kpi{flex:1 1 130px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 14px;box-shadow:var(--shadow);cursor:pointer;transition:transform .12s,border-color .12s}
  .kpi:hover{transform:translateY(-1px)}
  .kpi.active{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
  .kpi .n{font-size:26px;font-weight:750;line-height:1}
  .kpi .l{font-size:12.5px;color:var(--muted);margin-top:4px;display:flex;align-items:center;gap:6px}
  .dot{width:9px;height:9px;border-radius:50%;display:inline-block}
  .dot.email{background:var(--email)} .dot.ig{background:var(--ig)} .dot.wa{background:var(--wa)} .dot.call{background:var(--call)}
  .toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:14px 0 8px}
  .search{flex:1 1 240px;min-width:180px;padding:10px 14px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--ink);font-size:14px}
  .search:focus{outline:2px solid var(--accent);outline-offset:1px}
  .allbtn{padding:9px 14px;border:1px solid var(--border);background:var(--surface);color:var(--ink);border-radius:10px;font-size:13px;font-weight:600;cursor:pointer}
  .allbtn.active{border-color:var(--accent);color:var(--accent-ink)}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px;margin-top:16px}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:18px 18px 16px;box-shadow:var(--shadow);display:flex;flex-direction:column;gap:11px}
  .card-top{display:flex;flex-direction:column;gap:8px}
  .rec{align-self:flex-start;font-size:11.5px;font-weight:750;letter-spacing:.03em;text-transform:uppercase;padding:4px 10px;border-radius:999px}
  .rec-email{background:var(--email-bg);color:var(--email)}
  .rec-ig{background:var(--ig-bg);color:var(--ig)}
  .rec-wa{background:var(--wa-bg);color:var(--wa)}
  .rec-call{background:var(--call-bg);color:var(--call)}
  .titlewrap{display:flex;flex-direction:column;gap:2px}
  h3{margin:0;font-size:16.5px;line-height:1.25;letter-spacing:-.01em;text-wrap:balance}
  .loc{font-size:12.5px;color:var(--muted);font-weight:600}
  .why{margin:0;font-size:13px;color:var(--muted)}
  .chips{display:flex;flex-wrap:wrap;gap:7px}
  .chip{font-size:12.5px;text-decoration:none;color:var(--ink);background:var(--surface-2);border:1px solid var(--border);padding:5px 10px;border-radius:8px;font-weight:600;white-space:nowrap}
  .chip:hover{border-color:var(--accent)}
  .chip-wa{color:var(--wa)} .chip-ig{color:var(--ig)} .chip-em{color:var(--email)} .chip-web{color:var(--muted);font-weight:500}
  .note{margin:0;font-size:12.5px;background:var(--call-bg);color:var(--call);border-radius:8px;padding:8px 10px}
  .note b{font-weight:750}
  .msg{border:1px solid var(--border);border-radius:11px;overflow:hidden;background:var(--surface)}
  .msg-primary{border-color:color-mix(in srgb,var(--accent) 45%,var(--border))}
  .msg-head{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--surface-2)}
  .msg-ch{font-size:11.5px;font-weight:700;letter-spacing:.02em}
  .ch-email{color:var(--email)} .ch-ig_dm{color:var(--ig)} .ch-call{color:var(--call)} .ch-whatsapp{color:var(--wa)}
  .copy{font-size:12px;font-weight:650;border:1px solid var(--border);background:var(--surface);color:var(--ink);padding:4px 12px;border-radius:7px;cursor:pointer}
  .copy:hover{border-color:var(--accent);color:var(--accent-ink)}
  .copy.done{background:var(--accent);color:#fff;border-color:var(--accent)}
  .subj{font-size:13px;font-weight:700;padding:9px 12px 0}
  .body{margin:0;padding:10px 12px 13px;white-space:pre-wrap;font-family:inherit;font-size:13px;color:var(--ink);line-height:1.5}
  .acts{display:flex;gap:8px;padding:0 12px 12px}
  .act-done,.act-skip{font-size:12.5px;font-weight:650;border-radius:7px;padding:5px 12px;cursor:pointer;border:1px solid var(--border)}
  .act-done{background:var(--accent);color:#fff;border-color:var(--accent)}
  .act-skip{background:var(--surface);color:var(--muted)}
  .act-skip:hover{border-color:var(--call);color:var(--call)}
  .empty{grid-column:1/-1;text-align:center;color:var(--muted);padding:40px}
  footer{margin-top:34px;color:var(--muted);font-size:12.5px;border-top:1px solid var(--border);padding-top:16px}
  @media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;
