import { normalizePhoneBR } from "@/crm/lead-intake";

// ===========================================================================
// Telefone internacional em E.164 (sem '+').
//
// Existe por causa de um erro real (2026-10-15): o formulário tem país padrão
// US, a equipe digitou um número brasileiro e o telefone foi gravado sem o 55.
// O link do WhatsApp abriu a conversa errada. Número de prospecção errado
// significa mandar mensagem para a pessoa errada, então aqui o default é
// RECUSAR em vez de adivinhar — e a tela mostra o número final antes de abrir.
// ===========================================================================

export const DDI: Record<string, string> = {
  US: "1", CA: "1", BR: "55", PT: "351", AE: "971",
  GB: "44", ES: "34", MX: "52", AR: "54", AU: "61",
};

// Comprimento do número nacional (sem DDI), para pegar erro grosseiro.
const TAMANHO_NACIONAL: Record<string, [number, number]> = {
  US: [10, 10], CA: [10, 10], BR: [10, 11], PT: [9, 9], AE: [8, 9],
  GB: [9, 10], ES: [9, 9], MX: [10, 10], AR: [10, 11], AU: [9, 9],
};

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

  const ddi = DDI[pais];
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

  const [min, max] = TAMANHO_NACIONAL[pais] ?? [7, 14];
  const temDdi = digitos.startsWith(ddi) && digitos.length - ddi.length >= min && digitos.length - ddi.length <= max;
  const e164 = temDdi ? digitos : ddi + digitos;
  const nacional = e164.slice(ddi.length);

  if (nacional.length < min || nacional.length > max) {
    return {
      ok: false,
      erro: `Telefone não parece de ${pais}: esperado ${min === max ? min : `${min} a ${max}`} dígitos depois do código ${ddi}. Confira o país selecionado.`,
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
