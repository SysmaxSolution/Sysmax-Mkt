"use client";

import { useCallback, useEffect, useState } from "react";

// ===========================================================================
// Relatório mensal acumulado + lançamento dos números de rede social.
// Ideia da captação: chegar na hora de investir sabendo ONDE o dinheiro rende,
// em vez de apostar. Por isso a taxa de resposta por canal fica em destaque.
// Usa as classes CSS injetadas por /painel.
// ===========================================================================

type Dados = {
  mes: string;
  envios: { canal: string; total: number }[];
  totalEnvios: number;
  porPessoa: { quem: string; total: number }[];
  clinicasNovas: number;
  porPais: { pais: string; total: number }[];
  redes: { canal: string; publicacoes: number; alcance: number }[];
  responderam: number;
  taxaResposta: number | null;
};

const CANAIS = [
  { id: "facebook_pagina", nome: "Facebook — página" },
  { id: "facebook_grupos", nome: "Facebook — grupos" },
  { id: "instagram", nome: "Instagram" },
  { id: "outro", nome: "Outro" },
];

function mesAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function RelatorioMensal({ token }: { token: string }) {
  const [mes, setMes] = useState(mesAtual());
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [f, setF] = useState({ canal: "facebook_pagina", dia: hojeISO(), publicacoes: "", alcance: "", obs: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const carregar = useCallback(async (m: string) => {
    setErro(""); setD(null);
    try {
      const res = await fetch(`/api/painel/relatorio-mensal?mes=${m}`, { headers: { "x-admin-token": token } });
      const j = await res.json();
      if (j.ok) setD(j); else setErro(j.error ?? "Falha ao carregar.");
    } catch { setErro("Falha de rede."); }
  }, [token]);

  useEffect(() => { carregar(mes); }, [mes, carregar]);

  async function lancar() {
    if (!f.publicacoes.trim()) { setMsg({ kind: "err", text: "Informe quantas publicações você fez." }); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/painel/relatorio-mensal", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ ...f, autor: "Jéssica" }),
      });
      const j = await res.json();
      if (!j.ok) { setMsg({ kind: "err", text: j.error ?? "Não consegui salvar." }); return; }
      setMsg({ kind: "ok", text: "Números registrados. Já entraram no relatório." });
      setF((p) => ({ ...p, publicacoes: "", alcance: "", obs: "" }));
      carregar(mes);
    } catch { setMsg({ kind: "err", text: "Falha de rede." }); }
    finally { setBusy(false); }
  }

  return (
    <section className="novo">
      <p className="nvhint">
        O acumulado do mês, para decidir <b>onde investir</b> quando houver orçamento — em vez de apostar.
        Lance abaixo as publicações e o alcance das redes: só você tem esses números, o painel não os enxerga sozinho.
      </p>

      <div className="nvf" style={{ maxWidth: 220 }}>
        <label className="clabel" htmlFor="rm-mes">Mês</label>
        <input id="rm-mes" className="cinput" type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
      </div>

      {erro && <p className="notemsg">{erro}</p>}

      {d && (
        <>
          <div className="diagrid">
            {d.envios.map((e) => (
              <div className="diacard" key={e.canal}><b>{e.total}</b><span>{e.canal}</span></div>
            ))}
            <div className="diacard"><b>{d.clinicasNovas}</b><span>Clínicas novas</span></div>
            <div className="diacard"><b>{d.responderam}</b><span>Responderam</span></div>
            {d.taxaResposta !== null && (
              <div className="diacard"><b>{d.taxaResposta}%</b><span>Taxa de resposta</span></div>
            )}
          </div>

          {d.redes.length > 0 && (
            <div className="diagrid">
              {d.redes.map((r) => (
                <div className="diacard" key={r.canal}>
                  <b>{r.alcance || "—"}</b>
                  <span>{r.canal}<br />{r.publicacoes} publicação(ões)</span>
                </div>
              ))}
            </div>
          )}

          {d.porPais.length > 0 && (
            <p className="chint">Clínicas novas por país: {d.porPais.map((p) => `${p.pais} (${p.total})`).join(" · ")}</p>
          )}
          {d.porPessoa.length > 1 && (
            <p className="chint">Por pessoa: {d.porPessoa.map((p) => `${p.quem} (${p.total})`).join(" · ")}</p>
          )}
          {!d.totalEnvios && !d.redes.length && !d.clinicasNovas && (
            <p className="empty">Nada registrado neste mês ainda.</p>
          )}
        </>
      )}

      <h3 className="rmtit">Lançar números das redes</h3>
      <div className="nvgrid">
        <div className="nvf">
          <label className="clabel" htmlFor="rm-canal">Canal</label>
          <select id="rm-canal" className="cinput" value={f.canal} onChange={(e) => setF((p) => ({ ...p, canal: e.target.value }))}>
            {CANAIS.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        <div className="nvf">
          <label className="clabel" htmlFor="rm-dia">Dia</label>
          <input id="rm-dia" className="cinput" type="date" value={f.dia} onChange={(e) => setF((p) => ({ ...p, dia: e.target.value }))} />
        </div>
        <div className="nvf">
          <label className="clabel" htmlFor="rm-pub">Quantas publicações</label>
          <input id="rm-pub" className="cinput" inputMode="numeric" value={f.publicacoes}
            onChange={(e) => setF((p) => ({ ...p, publicacoes: e.target.value.replace(/\D/g, "") }))} placeholder="5" />
        </div>
        <div className="nvf">
          <label className="clabel" htmlFor="rm-alc">Visualizações / alcance (se souber)</label>
          <input id="rm-alc" className="cinput" inputMode="numeric" value={f.alcance}
            onChange={(e) => setF((p) => ({ ...p, alcance: e.target.value.replace(/\D/g, "") }))} placeholder="200" />
        </div>
        <div className="nvf nvf-wide">
          <label className="clabel" htmlFor="rm-obs">Observação (opcional)</label>
          <input id="rm-obs" className="cinput" value={f.obs} onChange={(e) => setF((p) => ({ ...p, obs: e.target.value }))} />
        </div>
      </div>
      <p className="chint">Se lançar o mesmo canal e dia de novo, o número é corrigido — não soma duas vezes.</p>
      <div className="crow">
        <button className="csend" disabled={busy} onClick={lancar}>{busy ? "Salvando..." : "Registrar"}</button>
      </div>
      {msg && <p className={`nvmsg nv-${msg.kind}`}>{msg.text}</p>}
    </section>
  );
}
