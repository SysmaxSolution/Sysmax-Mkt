"use client";

import { useId, useMemo, useState } from "react";
import { PAISES, resolverPais } from "@/lib/paises";

// ===========================================================================
// Campo de país que se DIGITA, não que se procura numa lista. Pedido da
// captação (2026-10-15): ela quer abrir mercado novo sem depender de alguém
// cadastrar o país antes, e quer achar "EUA" digitando em vez de rolar a lista.
//
// Aceita sigla ("US"), nome ("México") ou apelido ("EUA", "Dubai"), com
// sugestões do navegador. Enquanto não reconhece, avisa — não adivinha.
// ===========================================================================

export default function CampoPais({
  valor, onChange, label = "País", id,
}: {
  valor: string;                       // sigla ISO já resolvida
  onChange: (sigla: string) => void;
  label?: string;
  id?: string;
}) {
  const auto = useId();
  const campoId = id ?? `pais-${auto}`;
  const listaId = `lista-${campoId}`;
  const inicial = useMemo(() => PAISES.find((p) => p.sigla === valor)?.nome ?? valor ?? "", [valor]);
  const [texto, setTexto] = useState(inicial);

  const achado = resolverPais(texto);

  function digitou(v: string) {
    setTexto(v);
    const p = resolverPais(v);
    if (p) onChange(p.sigla);
  }

  // Ao sair do campo, normaliza para o nome oficial do país reconhecido.
  function saiu() {
    if (achado) setTexto(achado.nome);
  }

  return (
    <>
      <label className="clabel" htmlFor={campoId}>{label}</label>
      <input
        id={campoId}
        className="cinput"
        list={listaId}
        value={texto}
        onChange={(e) => digitou(e.target.value)}
        onBlur={saiu}
        placeholder="Digite: EUA, Portugal, México..."
        autoComplete="off"
      />
      <datalist id={listaId}>
        {PAISES.map((p) => <option key={p.sigla} value={p.nome} />)}
      </datalist>
      {texto.trim() && !achado && (
        <span className="fonechk err">
          Não reconheci esse país. Digite o nome por extenso ou a sigla de 2 letras (ex: México, MX).
        </span>
      )}
      {achado && <span className="fonechk">{achado.nome} · código +{achado.ddi}</span>}
    </>
  );
}
