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
  leadId: string; stage: string;
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

// Estágios do funil (leads.stage) na linguagem do analista comercial.
const STAGES: { key: string; label: string; short: string }[] = [
  { key: "new", label: "A contatar", short: "A contatar" },
  { key: "engaged", label: "Contatado", short: "Contatado" },
  { key: "qualified", label: "Respondeu", short: "Respondeu" },
  { key: "demo", label: "Demo agendada", short: "Demo" },
  { key: "won", label: "Virou cliente", short: "Cliente" },
  { key: "lost", label: "Perdido", short: "Perdido" },
];
const STAGE_LABEL: Record<string, string> = Object.fromEntries(STAGES.map((s) => [s.key, s.short]));

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
  const [statusFilter, setStatusFilter] = useState("all");
  const [view, setView] = useState<"leads" | "posts">("leads");
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

  async function setStage(leadId: string, stage: string, clinic: string) {
    const prevStage = rows.find((r) => r.leadId === leadId)?.stage;
    setRows((prev) => prev.map((r) => (r.leadId === leadId ? { ...r, stage } : r))); // otimista
    try {
      const res = await fetch("/api/admin/lead/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ lead_id: leadId, stage }),
      });
      if (!res.ok) throw new Error();
      setNote(`${clinic}: ${STAGE_LABEL[stage] ?? stage}`);
    } catch {
      setRows((prev) => prev.map((r) => (r.leadId === leadId ? { ...r, stage: prevStage ?? "new" } : r)));
      setNote("Não foi possível salvar o status. Tente de novo.");
    }
  }

  const total = rows.length;
  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.stage] = (c[r.stage] ?? 0) + 1;
    return c;
  }, [rows]);
  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      const rk = REC[r.recommended]?.key ?? "call";
      const okF = filter === "all" || rk === filter;
      const okS = statusFilter === "all" || r.stage === statusFilter;
      const okQ = !term || `${r.clinic} ${r.city ?? ""}`.toLowerCase().includes(term);
      return okF && okS && okQ;
    });
  }, [rows, filter, statusFilter, q]);

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
        <nav className="topnav">
          <button className={view === "leads" ? "on" : ""} onClick={() => setView("leads")}>Prospectos</button>
          <button className={view === "posts" ? "on" : ""} onClick={() => setView("posts")}>Posts do dia</button>
        </nav>

        {view === "posts" ? <PostsView token={token} /> : (
        <>
        <header className="top">
          <div className="eyebrow">Sysmax Software · Esteira Comercial</div>
          <h1>Prospectos prontos para abordar</h1>
          <p className="sub">{total} clínicas veterinárias com mensagem já redigida, cada uma no canal com maior chance de resposta. Clique num contato para abrir o canal; use <b>Copiar</b> para levar a mensagem. Ao contatar, marque o status conforme avança.</p>
        </header>

        <div className="kpis">
          {kpi("all", total, "Todas prontas")}
          {kpi("email", counts.email ?? 0, "E-mail", "email")}
          {kpi("ig", counts.ig ?? 0, "Instagram DM", "ig")}
          {kpi("wa", counts.wa ?? 0, "WhatsApp", "wa")}
          {kpi("call", counts.call ?? 0, "Ligação", "call")}
          <div className={`kpi kpi-won${statusFilter === "won" ? " active" : ""}`} onClick={() => setStatusFilter((s) => (s === "won" ? "all" : "won"))}>
            <div className="n tnum">{statusCounts.won ?? 0}</div>
            <div className="l"><span className="dot won" />Clientes fechados</div>
          </div>
        </div>

        <div className="statusbar">
          <span className="statuslbl">Status:</span>
          <button className={`spill${statusFilter === "all" ? " active" : ""}`} onClick={() => setStatusFilter("all")}>Todos</button>
          {STAGES.map((s) => (
            <button key={s.key} className={`spill st-${s.key}${statusFilter === s.key ? " active" : ""}`} onClick={() => setStatusFilter((cur) => (cur === s.key ? "all" : s.key))}>
              {s.label} <span className="spill-n">{statusCounts[s.key] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="toolbar">
          <input className="search" type="search" placeholder="Buscar clínica ou cidade…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
          <button className={`allbtn${filter === "all" ? " active" : ""}`} onClick={() => setFilter("all")}>Ver todos os canais</button>
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
                  <div className="badges">
                    <div className={`rec rec-${rk}`}>{recLabel}</div>
                    <div className={`stbadge st-${r.stage}`}>{STAGE_LABEL[r.stage] ?? r.stage}</div>
                  </div>
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
                <div className="stage-ctl" role="group" aria-label="Status do prospecto">
                  {STAGES.map((s) => (
                    <button key={s.key} className={`stbtn st-${s.key}${r.stage === s.key ? " on" : ""}`}
                      onClick={() => setStage(r.leadId, s.key, r.clinic)} title={s.label}>{s.short}</button>
                  ))}
                </div>
                {ordered.map((m, j) => (
                  <div className={`msg${j === 0 ? " msg-primary" : ""}`} key={m.id}>
                    <div className="msg-head">
                      <span className={`msg-ch ch-${m.channel}`}>{m.channelLabel}{j === 0 ? " · recomendado" : ""}</span>
                      <button className={`copy${copied === m.id ? " done" : ""}`} onClick={() => copy(m.id, (m.subject ? "Assunto: " + m.subject + "\n\n" : "") + m.body)}>{copied === m.id ? "Copiado ✓" : "Copiar"}</button>
                    </div>
                    {m.subject && <div className="subj">{m.subject}</div>}
                    <pre className="body">{m.body}</pre>
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
        </>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Aba de Posts: lote do dia (5 posts + 2 vídeos + 1 anúncio) para a equipe de
// marketing baixar a arte / copiar a legenda e publicar (IG, status, Facebook).
// ---------------------------------------------------------------------------
type PostContent = { headline?: string; caption?: string; hashtags?: string[]; hook?: string; scenes?: string[]; cta?: string; audio?: string; target?: string; budget?: string };
type CItem = { id: string; type: string; format: string; status: string; content: PostContent };

function PostsView({ token }: { token: string }) {
  const [data, setData] = useState<{ date: string | null; posts: CItem[]; videos: CItem[]; ad: CItem | null } | null>(null);
  const [st, setSt] = useState<"loading" | "ok" | "empty" | "error">("loading");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/painel/content/today", { headers: { "x-admin-token": token } });
        if (!res.ok) { setSt("error"); return; }
        const j = await res.json();
        if (!j.ok || (!j.posts?.length && !j.videos?.length && !j.ad)) { setSt("empty"); return; }
        setData(j); setSt("ok");
      } catch { setSt("error"); }
    })();
  }, [token]);

  async function copy(id: string, text: string) {
    try { await navigator.clipboard.writeText(text); } catch { /* */ }
    setCopied(id); setTimeout(() => setCopied((c) => (c === id ? null : c)), 1400);
  }
  const legend = (c: PostContent) => [c.caption, (c.hashtags ?? []).join(" ")].filter(Boolean).join("\n\n");
  const imgUrl = (id: string, size: string) => `/api/painel/post-image?id=${id}&size=${size}&t=${encodeURIComponent(token)}`;

  if (st === "loading") return <p className="sub" style={{ marginTop: 24 }}>Carregando o conteúdo de hoje…</p>;
  if (st === "error") return <p className="notemsg" style={{ marginTop: 24 }}>Não foi possível carregar o conteúdo.</p>;
  if (st === "empty") return (
    <div style={{ marginTop: 24 }}>
      <header className="top"><div className="eyebrow">Sysmax Software · Conteúdo</div><h1>Posts do dia</h1></header>
      <p className="notemsg">O lote de hoje ainda não foi gerado. Ele é criado automaticamente toda manhã — volte mais tarde.</p>
    </div>
  );

  const d = data!;
  return (
    <div>
      <header className="top">
        <div className="eyebrow">Sysmax Software · Conteúdo</div>
        <h1>Posts do dia</h1>
        <p className="sub">5 posts, 2 vídeos e 1 anúncio prontos para {d.date ?? "hoje"}. Baixe a arte, copie a legenda e publique no Instagram, status do WhatsApp e Facebook. Os roteiros de vídeo são para a equipe gravar/editar.</p>
      </header>

      <h2 className="secttl">Posts ({d.posts.length})</h2>
      <div className="grid">
        {d.posts.map((p) => (
          <article className="card pcard" key={p.id}>
            <div className="pill-row"><span className="rec rec-email">{p.format}</span></div>
            <img className="post-art" src={imgUrl(p.id, p.format === "story" ? "story" : "feed")} alt="arte do post" loading="lazy" />
            <div className="phead">{p.content.headline}</div>
            <pre className="body">{p.content.caption}</pre>
            {!!(p.content.hashtags ?? []).length && <div className="tags">{(p.content.hashtags ?? []).join(" ")}</div>}
            <div className="pactions">
              <button className={`copy${copied === p.id ? " done" : ""}`} onClick={() => copy(p.id, legend(p.content))}>{copied === p.id ? "Copiado ✓" : "Copiar legenda"}</button>
              <a className="dl" href={imgUrl(p.id, p.format === "story" ? "story" : "feed")} download={`post-${p.id}.png`} target="_blank" rel="noopener noreferrer">Baixar arte</a>
            </div>
          </article>
        ))}
      </div>

      <h2 className="secttl">Vídeos — roteiros ({d.videos.length})</h2>
      <div className="grid">
        {d.videos.map((v) => (
          <article className="card" key={v.id}>
            <div className="pill-row"><span className="rec rec-ig">Reel / vídeo</span></div>
            <div className="phead">{v.content.headline}</div>
            <div className="roteiro">
              {v.content.hook && <p><b>Gancho:</b> {v.content.hook}</p>}
              {!!(v.content.scenes ?? []).length && <ol>{(v.content.scenes ?? []).map((s, i) => <li key={i}>{s}</li>)}</ol>}
              {v.content.cta && <p><b>CTA:</b> {v.content.cta}</p>}
              {v.content.audio && <p><b>Áudio:</b> {v.content.audio}</p>}
            </div>
            {v.content.caption && <pre className="body">{v.content.caption}</pre>}
            <div className="pactions">
              <button className={`copy${copied === v.id ? " done" : ""}`} onClick={() => copy(v.id, `${v.content.hook ?? ""}\n\n${(v.content.scenes ?? []).join("\n")}\n\n${v.content.cta ?? ""}\n\n${legend(v.content)}`)}>{copied === v.id ? "Copiado ✓" : "Copiar roteiro"}</button>
            </div>
          </article>
        ))}
      </div>

      {d.ad && (
        <>
          <h2 className="secttl">Anúncio para impulsionar</h2>
          <div className="grid">
            <article className="card pcard" key={d.ad.id}>
              <div className="pill-row"><span className="rec rec-call">Anúncio</span></div>
              <img className="post-art" src={imgUrl(d.ad.id, "feed")} alt="arte do anúncio" loading="lazy" />
              <div className="phead">{d.ad.content.headline}</div>
              <pre className="body">{d.ad.content.caption}</pre>
              <div className="roteiro">
                {d.ad.content.target && <p><b>Público sugerido:</b> {d.ad.content.target}</p>}
                {d.ad.content.budget && <p><b>Verba sugerida:</b> {d.ad.content.budget}</p>}
              </div>
              <div className="pactions">
                <button className={`copy${copied === d.ad.id ? " done" : ""}`} onClick={() => copy(d.ad!.id, legend(d.ad!.content))}>{copied === d.ad.id ? "Copiado ✓" : "Copiar texto"}</button>
                <a className="dl" href={imgUrl(d.ad.id, "feed")} download={`anuncio-${d.ad.id}.png`} target="_blank" rel="noopener noreferrer">Baixar arte</a>
              </div>
            </article>
          </div>
        </>
      )}
    </div>
  );
}

const CSS = `
  :root{
    --bg:#F5F7F6; --surface:#FFFFFF; --surface-2:#F0F3F1; --ink:#141F1B; --muted:#5A6A63;
    --border:#E1E7E3; --accent:#0E7C66; --accent-ink:#0A5A4A;
    --email:#4F46E5; --ig:#D6336C; --wa:#12925A; --call:#B45309;
    --email-bg:#EEF0FE; --ig-bg:#FDECF3; --wa-bg:#E6F5EC; --call-bg:#FBF0E1;
    --st-new:#64748B; --st-engaged:#2563EB; --st-qualified:#0E7C66; --st-demo:#7C3AED; --st-won:#12925A; --st-lost:#B91C1C;
    --shadow:0 1px 2px rgba(20,31,27,.04),0 4px 16px rgba(20,31,27,.05);
  }
  @media (prefers-color-scheme:dark){:root{
    --bg:#0D1512; --surface:#151F1B; --surface-2:#1B2723; --ink:#E7EFEB; --muted:#93A69D;
    --border:#27332E; --accent:#2DD4BF; --accent-ink:#5EEAD4;
    --email:#8B93FF; --ig:#F472A6; --wa:#4FCB86; --call:#E0A45C;
    --email-bg:#1D2140; --ig-bg:#33202B; --wa-bg:#172B22; --call-bg:#2E2416;
    --st-new:#94A3B8; --st-engaged:#7CA0FF; --st-qualified:#2DD4BF; --st-demo:#A78BFA; --st-won:#4FCB86; --st-lost:#F16A6A;
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
  .badges{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  .stbadge{font-size:11px;font-weight:750;letter-spacing:.03em;text-transform:uppercase;padding:4px 9px;border-radius:999px;border:1px solid transparent}
  .stbadge.st-new{color:var(--st-new);background:color-mix(in srgb,var(--st-new) 12%,transparent)}
  .stbadge.st-engaged{color:var(--st-engaged);background:color-mix(in srgb,var(--st-engaged) 12%,transparent)}
  .stbadge.st-qualified{color:var(--st-qualified);background:color-mix(in srgb,var(--st-qualified) 12%,transparent)}
  .stbadge.st-demo{color:var(--st-demo);background:color-mix(in srgb,var(--st-demo) 14%,transparent)}
  .stbadge.st-won{color:#fff;background:var(--st-won)}
  .stbadge.st-lost{color:var(--st-lost);background:color-mix(in srgb,var(--st-lost) 12%,transparent)}
  .kpi-won .n{color:var(--st-won)}
  .dot.won{background:var(--st-won)}
  .statusbar{display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin:16px 0 2px}
  .statuslbl{font-size:12.5px;color:var(--muted);font-weight:700;margin-right:2px}
  .spill{font-size:12.5px;font-weight:600;border:1px solid var(--border);background:var(--surface);color:var(--ink);padding:5px 11px;border-radius:999px;cursor:pointer;display:inline-flex;gap:6px;align-items:center}
  .spill:hover{border-color:var(--accent)}
  .spill.active{border-color:var(--accent);color:var(--accent-ink);background:var(--surface-2)}
  .spill-n{font-variant-numeric:tabular-nums;font-size:11.5px;opacity:.65}
  .stage-ctl{display:flex;flex-wrap:wrap;gap:5px}
  .stbtn{font-size:11.5px;font-weight:650;border:1px solid var(--border);background:var(--surface);color:var(--muted);padding:4px 9px;border-radius:7px;cursor:pointer;transition:border-color .1s}
  .stbtn:hover{border-color:var(--accent);color:var(--ink)}
  .stbtn.on{color:#fff}
  .stbtn.st-new.on{background:var(--st-new);border-color:var(--st-new)}
  .stbtn.st-engaged.on{background:var(--st-engaged);border-color:var(--st-engaged)}
  .stbtn.st-qualified.on{background:var(--st-qualified);border-color:var(--st-qualified)}
  .stbtn.st-demo.on{background:var(--st-demo);border-color:var(--st-demo)}
  .stbtn.st-won.on{background:var(--st-won);border-color:var(--st-won)}
  .stbtn.st-lost.on{background:var(--st-lost);border-color:var(--st-lost)}
  .empty{grid-column:1/-1;text-align:center;color:var(--muted);padding:40px}
  footer{margin-top:34px;color:var(--muted);font-size:12.5px;border-top:1px solid var(--border);padding-top:16px}
  .topnav{display:flex;gap:6px;margin-bottom:22px;border-bottom:1px solid var(--border)}
  .topnav button{font-size:14px;font-weight:650;color:var(--muted);background:none;border:none;border-bottom:2px solid transparent;padding:10px 14px;cursor:pointer;margin-bottom:-1px}
  .topnav button:hover{color:var(--ink)}
  .topnav button.on{color:var(--accent-ink);border-bottom-color:var(--accent)}
  .secttl{font-size:15px;font-weight:750;letter-spacing:-.01em;margin:26px 0 2px}
  .pill-row{display:flex;gap:6px}
  .pcard{gap:12px}
  .post-art{width:100%;border-radius:12px;border:1px solid var(--border);display:block;aspect-ratio:4/5;object-fit:cover;background:var(--surface-2)}
  .phead{font-size:15.5px;font-weight:750;line-height:1.25;letter-spacing:-.01em;text-wrap:balance}
  .tags{font-size:12.5px;color:var(--accent-ink);font-weight:600}
  .roteiro{font-size:13px;color:var(--ink);display:flex;flex-direction:column;gap:6px}
  .roteiro p{margin:0}
  .roteiro b{font-weight:700}
  .roteiro ol{margin:2px 0;padding-left:20px;display:flex;flex-direction:column;gap:4px}
  .pactions{display:flex;gap:8px;flex-wrap:wrap;margin-top:2px}
  .dl{font-size:12.5px;font-weight:650;text-decoration:none;background:var(--accent);color:#fff;border:1px solid var(--accent);padding:5px 14px;border-radius:7px}
  .dl:hover{background:var(--accent-ink)}
  @media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;
