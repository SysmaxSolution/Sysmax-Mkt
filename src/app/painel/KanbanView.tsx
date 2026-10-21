"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// ===========================================================================
// Kanban de leads — visualização por estágio, com filtro por ramo (vertical)
// e score automático (calculado todo fim de tarde por /api/cron/lead-score,
// ninguém digita). Depende do dado já estar fluindo pelo registro automático
// (WhatsApp multi-instância, aba "WhatsApp") para o score ter sinal real.
// ===========================================================================

type Row = { leadId: string; clinic: string; city: string | null; uf: string | null; stage: string; vertical?: string; leadScore?: number };
type Conversation = { lead_id: string | null; needs_director_review: boolean; ai_suggestion: string | null };

const STAGES: { key: string; label: string }[] = [
  { key: "new", label: "Novo" },
  { key: "engaged", label: "Contatado" },
  { key: "qualified", label: "Qualificado" },
  { key: "demo", label: "Proposta/Demo" },
  { key: "won", label: "Fechado" },
  { key: "lost", label: "Perdido" },
];

const VERTICAL_LABEL: Record<string, string> = {
  veterinario: "Veterinário",
  laboratorio: "Laboratório",
  estetico: "Estético",
  outro: "Outro",
};

function scoreBand(score: number): { label: string; color: string } {
  if (score >= 65) return { label: "quente", color: "#d97757" };
  if (score >= 40) return { label: "morno", color: "#b08900" };
  return { label: "frio", color: "#6b7280" };
}

export default function KanbanView({ token }: { token: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [reviewByLead, setReviewByLead] = useState<Map<string, Conversation>>(new Map());
  const [vertical, setVertical] = useState<string>("todos");
  const [moving, setMoving] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [wl, conv] = await Promise.all([
      fetch("/api/admin/worklist/full", { headers: { "x-admin-token": token } }).then((r) => r.json()),
      fetch("/api/painel/whatsapp/conversations", { headers: { "x-admin-token": token } }).then((r) => r.json()),
    ]);
    if (wl?.ok) setRows(wl.rows);
    if (conv?.ok) {
      const m = new Map<string, Conversation>();
      for (const c of conv.conversations as Conversation[]) {
        if (c.lead_id) m.set(c.lead_id, c);
      }
      setReviewByLead(m);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const verticais = useMemo(() => {
    const set = new Set(rows.map((r) => r.vertical ?? "veterinario"));
    return [...set];
  }, [rows]);

  const filtered = useMemo(
    () => (vertical === "todos" ? rows : rows.filter((r) => (r.vertical ?? "veterinario") === vertical)),
    [rows, vertical]
  );

  async function moverEstagio(leadId: string, stage: string) {
    setMoving(leadId);
    setErro(null);
    try {
      const res = await fetch("/api/admin/lead/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ lead_id: leadId, stage }),
      });
      const j = await res.json().catch(() => ({ ok: res.ok }));
      if (!j.ok) throw new Error();
      setRows((prev) => prev.map((r) => (r.leadId === leadId ? { ...r, stage } : r)));
    } catch {
      setErro("Não consegui mover o lead. Tente de novo.");
    } finally {
      setMoving(null);
    }
  }

  return (
    <div className="kanban-view">
      <div className="kanban-filtros">
        <label>Ramo: </label>
        <select value={vertical} onChange={(e) => setVertical(e.target.value)}>
          <option value="todos">Todos</option>
          {verticais.map((v) => (
            <option key={v} value={v}>{VERTICAL_LABEL[v] ?? v}</option>
          ))}
        </select>
        {erro && <span className="erro"> {erro}</span>}
      </div>

      <div className="kanban-colunas">
        {STAGES.map((col) => {
          const cards = filtered.filter((r) => (r.stage ?? "new") === col.key);
          return (
            <div key={col.key} className="kanban-coluna">
              <h4>{col.label} ({cards.length})</h4>
              {cards.map((r) => {
                const score = r.leadScore ?? 0;
                const band = scoreBand(score);
                const review = reviewByLead.get(r.leadId);
                return (
                  <div key={r.leadId} className="kanban-card">
                    <b>{r.clinic}</b>
                    <div className="kanban-meta">
                      {r.city ? `${r.city}/${r.uf}` : ""} · {VERTICAL_LABEL[r.vertical ?? "veterinario"]}
                    </div>
                    <span className="kanban-score" style={{ color: band.color, borderColor: band.color }}>
                      {band.label} · {score}
                    </span>
                    {review?.needs_director_review && (
                      <p className="note" style={{ color: "#d97757" }}>⚠ {review.ai_suggestion}</p>
                    )}
                    <div className="kanban-mover">
                      {STAGES.filter((s) => s.key !== col.key).map((s) => (
                        <button key={s.key} disabled={moving === r.leadId} onClick={() => moverEstagio(r.leadId, s.key)}>
                          → {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {cards.length === 0 && <p className="note">Vazio.</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
