"use client";

import { useCallback, useEffect, useState } from "react";

// ===========================================================================
// Aba "Vídeos" — a prateleira do que está pronto para publicar no TikTok.
//
// Ela publica pelo computador (16/10: "vou baixar e publicar pelo PC pra não
// encher a memória do celular"). Então cada linha tem o que ela precisa na
// ordem em que precisa: baixar o arquivo, copiar a legenda, marcar que foi.
// Usa as classes CSS injetadas por /painel.
// ===========================================================================

type Video = {
  arquivo: string; url: string; titulo: string; gancho: string;
  legenda: string; duracao_seg: number | null;
  criado_em: string; publicado_em: string | null;
};

export default function VideosView({ token }: { token: string }) {
  const [itens, setItens] = useState<Video[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/api/painel/videos", { headers: { "x-admin-token": token } });
      const d = await res.json();
      if (!d.ok) { setErro(d.error ?? "Não consegui carregar."); return; }
      setItens(d.itens);
    } catch {
      setErro("Falha de rede ao carregar os vídeos.");
    }
  }, [token]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function marcar(v: Video) {
    const publicado = !v.publicado_em;
    setItens((p) => (p ?? []).map((x) => x.arquivo === v.arquivo
      ? { ...x, publicado_em: publicado ? new Date().toISOString() : null } : x));
    await fetch("/api/painel/videos", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: JSON.stringify({ arquivo: v.arquivo, publicado }),
    });
  }

  async function copiar(v: Video) {
    try {
      await navigator.clipboard.writeText(v.legenda);
      setCopiado(v.arquivo);
      setTimeout(() => setCopiado(null), 2500);
    } catch {
      // Navegador que bloqueia a área de transferência: o texto está na tela,
      // dá para selecionar à mão. Melhor isso do que um erro sem saída.
      setErro("Seu navegador não deixou copiar. Selecione o texto da legenda e copie à mão.");
    }
  }

  if (erro && !itens) return <section className="novo"><p className="nvmsg nv-err">{erro}</p></section>;
  if (!itens) return <section className="novo"><p className="chint">Carregando…</p></section>;

  const pendentes = itens.filter((v) => !v.publicado_em).length;

  return (
    <section className="novo">
      <p className="nvhint">
        Vídeos prontos para o TikTok, já no formato vertical. <b>{pendentes}</b> ainda não publicado(s).
        Baixa o arquivo, copia a legenda e marca aqui quando subir — assim eu sei o que já foi ao ar
        e não repito.
      </p>

      {erro && <p className="nvmsg nv-err">{erro}</p>}

      <div className="dialist">
        {itens.map((v) => (
          <div className={`vidrow${v.publicado_em ? " off" : ""}`} key={v.arquivo}>
            <div className="vidtop">
              <b>{v.titulo}</b>
              <span className="impsub">{v.duracao_seg ? `${v.duracao_seg}s` : ""}</span>
              {v.publicado_em && <span className="impok">publicado</span>}
            </div>
            <p className="vidgancho">&ldquo;{v.gancho}&rdquo;</p>
            {v.legenda && <p className="vidleg">{v.legenda}</p>}
            <div className="crow">
              <a className="csend" href={v.url} download={v.arquivo}>Baixar o vídeo</a>
              {v.legenda && (
                <button className="ccancel" onClick={() => copiar(v)}>
                  {copiado === v.arquivo ? "Legenda copiada" : "Copiar a legenda"}
                </button>
              )}
              <button className="ccancel" onClick={() => marcar(v)}>
                {v.publicado_em ? "Desmarcar" : "Marcar como publicado"}
              </button>
            </div>
          </div>
        ))}
        {!itens.length && <p className="chint">Nenhum vídeo na prateleira ainda.</p>}
      </div>
    </section>
  );
}
