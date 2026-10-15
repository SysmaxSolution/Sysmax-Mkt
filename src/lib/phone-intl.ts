import { normalizePhoneBR } from "@/crm/lead-intake";
import { paisPorSigla } from "@/lib/paises";

// ===========================================================================
// Telefone internacional em E.164 (sem '+').
//
// Existe por causa de um erro real (2026-10-15): o formulário tem país padrão
// US, a equipe digitou um número brasileiro e o telefone foi gravado sem o 55.
// O link do WhatsApp abriu a conversa errada. Número de prospecção errado
// significa mandar mensagem para a pessoa errada, então aqui o default é
// RECUSAR em vez de adivinhar — e a tela mostra o número final antes de abrir.
// ===========================================================================

export type FoneResultado =
  | { ok: true; e164: string; exibicao: string; aviso?: string }
  | { ok: false; erro: string };

function formatar(e164: string, ddi: string): string {
  const nac = e164.slice(ddi.length);
  return `+${ddi} ${nac}`;
}

export function montarTelefone(bruto: string, pais: string): FoneResultado {
  const digitos = (bruto ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (!digitos) return { ok: false, erro: "Informe o telefone." };

  const info = paisPorSigla(pais);
  const ddi = info?.ddi;
  if (!ddi) {
    // País fora da lista: aceita só se vier com código de país explícito.
    if (digitos.length < 10 || digitos.length > 15) {
      return { ok: false, erro: "Digite o telefone com o código do país." };
    }
    return { ok: true, e164: digitos, exibicao: `+${digitos}` };
  }

  if (pais === "BR") {
    const br = normalizePhoneBR(digitos);
    if (!br) return { ok: false, erro: "Telefone brasileiro inválido. Use DDD + número, ex: 11 93962-3300." };
    return { ok: true, e164: br, exibicao: formatar(br, "55") };
  }

  const [min, max] = info?.nacional ?? [7, 14];
  const temDdi = digitos.startsWith(ddi) && digitos.length - ddi.length >= min && digitos.length - ddi.length <= max;
  const e164 = temDdi ? digitos : ddi + digitos;
  const nacional = e164.slice(ddi.length);

  if (nacional.length < min || nacional.length > max) {
    return {
      ok: false,
      erro: `Telefone não parece de ${info?.nome ?? pais}: esperado ${min === max ? min : `${min} a ${max}`} dígitos depois do código ${ddi}. Confira o país.`,
    };
  }

  // Número brasileiro digitado com outro país selecionado — o erro que
  // derrubou o primeiro teste. Avisa em vez de abrir o WhatsApp errado.
  let aviso: string | undefined;
  if (pais !== "BR" && /^(?:55)?[1-9]{2}9\d{8}$/.test(digitos)) {
    aviso = `Esse número parece brasileiro. Se for, troque o país para Brasil — do contrário vai sair como ${formatar(e164, ddi)}.`;
  }
  return { ok: true, e164, exibicao: formatar(e164, ddi), aviso };
}
