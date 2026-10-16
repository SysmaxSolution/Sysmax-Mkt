"use client";

import { useCallback, useEffect, useState } from "react";
import FotoPicker from "./FotoPicker";

// ===========================================================================
// Relatório mensal acumulado + lançamento dos números de rede social.
// Ideia da captação: chegar na hora de investir sabendo ONDE o dinheiro rende,
// em vez de apostar. Por isso a taxa de resposta por canal fica em destaque.
//
// O print do relatório do Facebook entra aqui também: ela tira o print e, se
// não quiser transcrever, deixa os campos em branco — a linha fica "a conferir"
// e os números saem do print. Usa as classes CSS injetadas por /painel.
// ===========================================================================

type Print = {
  canal: string; dia: string; fotos: string[]; conferir: boolean;
  publicacoes: number | null; alcance: number | null;
};

type Dados = {
  mes: string;
  envios: { canal: string; total: number }[];
  totalEnvios: number;
  porPessoa: { quem: string; total: number }[];
  clinicasNovas: number;
  porPais: { pais: string; total: number }[];
  redes: { canal: string; publicacoes: number; alcance: number; investido: number }[];
  investido: number;
  custoPorVisualizacao: number | null;
  prints: Print[];
  aConferir: number;
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
  const [f, setF] = useState({ canal: "facebook_pagina", dia: hojeISO(), publicacoes: "", alcance: "", obs: "", investimento: "" });
  const [fotos, setFotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const fotoUrl = (p: string) => `/api/painel/material-foto?f=${encodeURIComponent(p)}&t=${encodeURIComponent(token)}`;

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
    if (!f.publicacoes.trim() && !fotos.length) {
      setMsg({ kind: "err", text: "Informe quantas publicações você fez, ou anexe o print do relatório." }); return;
    }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/painel/relatorio-mensal", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ ...f, fotos, autor: "Jéssica" }),
      });
      const j = await res.json();
      if (!j.ok) { setMsg({ kind: "err", text: j.error ?? "Não consegui salvar." }); return; }
      setMsg({
        kind: "ok",
        text: j.conferir
          ? "Print guardado. Os números saem dele — não precisa digitar."
          : "Números registrados. Já entraram no relatório.",
      });
      setF((p) => ({ ...p, publicacoes: "", alcance: "", obs: "", investimento: "" }));
      setFotos([]);
      carregar(mes);
    } catch { setMsg({ kind: "err", text: "Falha de rede. Se o print for muito grande, tente um por vez." }); }
    finally { setBusy(false); }
  }

  return (
    <section className="novo">
      <p className="nvhint">
        O acumulado do mês, para decidir <b>onde investir</b> quando houver orçamento — em vez de apostar.
        Lance abaixo as publicações e o alcance das redes: só você tem esses números, o painel não os enxerga sozinho.
        Pode mandar só o print do relatório do Facebook, se preferir.
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
            {d.investido > 0 && (
              <div className="diacard">
                <b>R$ {d.investido.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</b>
                <span>Investido em impulsionamento</span>
              </div>
            )}
            {d.custoPorVisualizacao !== null && (
              <div className="diacard">
                <b>R$ {d.custoPorVisualizacao.toLocaleString("pt-BR", { minimumFractionDigits: 3 })}</b>
                <span>por visualização<br />(pago + orgânico)</span>
              </div>
            )}
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
          {!d.totalEnvios && !d.redes.length && !d.clinicasNovas && !(d.prints ?? []).length && (
            <p className="empty">Nada registrado neste mês ainda.</p>
          )}

          {!!(d.prints ?? []).length && (
            <>
              <h3 className="rmtit">
                Prints do relatório ({d.prints.length})
                {d.aConferir > 0 && <span className="rmbadge">{d.aConferir} a conferir</span>}
              </h3>
              {d.aConferir > 0 && (
                <p className="chint">
                  Os marcados <b>a conferir</b> ainda não têm número digitado — nós tiramos do print.
                  Você não precisa fazer mais nada com eles.
                </p>
              )}
              <div className="printlist">
                {d.prints.map((p) => (
                  <div className="printrow" key={`${p.canal}-${p.dia}`}>
                    <div className="printinfo">
                      <b>{p.canal}</b>
                      <span>{new Date(`${p.dia}T12:00:00`).toLocaleDateString("pt-BR")}</span>
                      <span>
                        {p.conferir
                          ? "a conferir"
                          : `${p.publicacoes ?? 0} publicação(ões)${p.alcance ? ` · ${p.alcance} visualizações` : ""}`}
                      </span>
                    </div>
                    <div className="fotogrid">
                      {p.fotos.map((cam, i) => (
                        <a className="fotoitem" key={cam} href={fotoUrl(cam)} target="_blank" rel="noopener noreferrer" title="Abrir em tamanho real">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={fotoUrl(cam)} alt={`print ${i + 1} de ${p.canal}`} loading="lazy" />
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
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
        <div className="nvf">
          <label className="clabel" htmlFor="rm-inv">Investiu em impulsionamento? (R$)</label>
          <input id="rm-inv" className="cinput" inputMode="decimal" value={f.investimento} placeholder="27,00"
            onChange={(e) => setF((p) => ({ ...p, investimento: e.target.value.replace(/[^\d.,]/g, "") }))} />
        </div>
        <div className="nvf nvf-wide">
          <label className="clabel" htmlFor="rm-obs">Observação (opcional)</label>
          <input id="rm-obs" className="cinput" value={f.obs} onChange={(e) => setF((p) => ({ ...p, obs: e.target.value }))} />
        </div>
      </div>

      <FotoPicker
        fotos={fotos} setFotos={setFotos} rotulo="print" disabled={busy}
        label="Print do relatório (opcional)"
        ajuda="Print do relatório do Facebook, do Instagram ou de onde vier o número. Se anexar, pode deixar os campos de cima em branco: a linha fica “a conferir” e nós preenchemos pelo print."
        onErro={(t) => setMsg(t ? { kind: "err", text: t } : null)}
      />

      <p className="chint">Se lançar o mesmo canal e dia de novo, o número é corrigido — não soma duas vezes.</p>
      <div className="crow">
        <button className="csend" disabled={busy} onClick={lancar}>{busy ? "Salvando..." : "Registrar"}</button>
      </div>
      {msg && <p className={`nvmsg nv-${msg.kind}`}>{msg.text}</p>}
    </section>
  );
}
