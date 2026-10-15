"use client";

import { useEffect, useState } from "react";

// ===========================================================================
// Relatório do dia montado do próprio rastro das ações (outbox + leads novos).
// Pedido da captação em 2026-10-15: substituir o resumo escrito à mão no
// WhatsApp e dar ao Diretor acompanhamento diário de quem fez o quê — o mesmo
// padrão serve quando a equipe crescer.
// ===========================================================================

type Dia = {
  resumo: { canal: string; total: number }[];
  porPessoa: { quem: string; total: number }[];
  clinicasNovas: number;
  acoes: { canal: string; clinica: string; onde: string; quando: string; quem: string | null }[];
};

export default function MeuDia({ token }: { token: string }) {
  const [d, setD] = useState<Dia | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const res = await fetch("/api/painel/meu-dia", { headers: { "x-admin-token": token } });
        const j = await res.json();
        if (!vivo) return;
        if (j.ok) setD(j); else setErr(j.error ?? "Falha ao carregar.");
      } catch { if (vivo) setErr("Falha de rede ao carregar o relatório."); }
    })();
    return () => { vivo = false; };
  }, [token]);

  if (err) return <p className="notemsg">{err}</p>;
  if (!d) return <p className="empty">Carregando...</p>;

  const total = d.resumo.reduce((a, b) => a + b.total, 0);

  return (
    <section className="novo">
      <p className="nvhint">
        O que foi feito hoje, montado automaticamente a partir das suas ações. Não precisa escrever resumo no WhatsApp.
      </p>

      {!total && !d.clinicasNovas && <p className="empty">Nenhum contato registrado hoje ainda.</p>}

      {(total > 0 || d.clinicasNovas > 0) && (
        <div className="diagrid">
          {d.resumo.map((r) => (
            <div className="diacard" key={r.canal}><b>{r.total}</b><span>{r.canal}</span></div>
          ))}
          <div className="diacard"><b>{d.clinicasNovas}</b><span>Clínicas novas cadastradas</span></div>
        </div>
      )}

      {d.porPessoa.length > 1 && (
        <p className="chint">Por pessoa: {d.porPessoa.map((p) => `${p.quem} (${p.total})`).join(" · ")}</p>
      )}

      {d.acoes.length > 0 && (
        <div className="dialist">
          {d.acoes.map((a, i) => (
            <div className="diarow" key={i}>
              <span className="diach">{a.canal}</span>
              <span className="diacl">{a.clinica}</span>
              <span className="diawh">{a.onde}</span>
              <span className="diatm">
                {new Date(a.quando).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
