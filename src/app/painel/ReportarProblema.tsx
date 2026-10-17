"use client";

import { useState } from "react";

// ===========================================================================
// Botão flutuante "Reportar problema" — o caminho que os funcionários têm
// para avisar de erro no painel, já que (diferente da Jéssica) eles não
// falam comigo pelo WhatsApp. Pedido dela em 17/10.
// ===========================================================================

export default function ReportarProblema({ token, pagina }: { token: string; pagina: string }) {
  const [aberto, setAberto] = useState(false);
  const [autor, setAutor] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [feito, setFeito] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar() {
    if (!mensagem.trim()) { setErro("Descreva o que aconteceu."); return; }
    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch("/api/painel/reportar", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ mensagem, autor: autor || null, pagina }),
      });
      const d = await res.json().catch(() => null);
      if (!d?.ok) { setErro(d?.error ?? "Não consegui enviar. Tente de novo."); return; }
      setFeito(true);
      setMensagem("");
    } catch {
      setErro("Falha de rede ao enviar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="repbox">
      <button className="repbtn" onClick={() => { setAberto((v) => !v); setFeito(false); setErro(null); }}>
        {aberto ? "Fechar" : "⚠ Reportar problema"}
      </button>
      {aberto && (
        <div className="reppanel">
          {feito ? (
            <p className="nvmsg nvok">Recebido. A equipe vai ver e corrigir.</p>
          ) : (
            <>
              <p className="chint">Deu erro em algum envio, botão, ou qualquer coisa aqui no painel? Descreva — a equipe vê isso e corrige.</p>
              <input className="repinput" placeholder="Seu nome (opcional)" value={autor} onChange={(e) => setAutor(e.target.value)} />
              <textarea className="reptext" placeholder="O que aconteceu?" value={mensagem} onChange={(e) => setMensagem(e.target.value)} rows={3} />
              {erro && <p className="nvmsg nv-err">{erro}</p>}
              <button className="csend" onClick={enviar} disabled={enviando}>{enviando ? "Enviando…" : "Enviar"}</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
