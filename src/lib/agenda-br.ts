// ===========================================================================
// Calendário de trabalho da prospecção — regra geral dada pela captação em
// 2026-10-16, depois de meses ligando para clínica:
//
//   "as clínicas param de responder depois das 16:30 — então até 17h é o
//    limite para as clínicas Brasil (...) clínicas + e-mail SOMENTE 2ª a 6ª
//    feira. NÃO enviar nada, NÃO agendar nenhum compromisso em feriado, de
//    jeito nenhum. (...) rede social 100% livre pra tudo."
//
// Feriado e fim de semana são BLOQUEIO (foi assim que ela falou). Fora do
// horário é AVISO, porque reunião combinada para as 18h com o dono da clínica
// continua sendo uma reunião válida.
//
// Rede social não passa por aqui: não tem hora nem dia.
// ===========================================================================

const FUSO_BR = -3; // Brasília, o ano todo (sem horário de verão desde 2019)

// Páscoa pelo algoritmo de Meeus/Jones/Butcher — base dos feriados móveis.
function pascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

const ddmm = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

function maisDias(base: Date, dias: number): Date {
  return new Date(base.getTime() + dias * 86_400_000);
}

// Feriados NACIONAIS. Municipal e estadual não entram: a fila é do Brasil
// inteiro e bloquear o aniversário de uma cidade pararia o país.
export function feriadosNacionais(ano: number): Map<string, string> {
  const p = pascoa(ano);
  const m = new Map<string, string>([
    ["01-01", "Confraternização Universal"],
    ["21-04", "Tiradentes"],
    ["01-05", "Dia do Trabalho"],
    ["07-09", "Independência"],
    ["12-10", "Nossa Senhora Aparecida"],
    ["02-11", "Finados"],
    ["15-11", "Proclamação da República"],
    ["20-11", "Consciência Negra"],
    ["25-12", "Natal"],
  ]);
  m.set(ddmm(maisDias(p, -48)), "Carnaval (segunda)");
  m.set(ddmm(maisDias(p, -47)), "Carnaval");
  m.set(ddmm(maisDias(p, -2)), "Sexta-feira Santa");
  m.set(ddmm(maisDias(p, 60)), "Corpus Christi");
  return m;
}

// Partes da data no fuso de Brasília, sem depender do fuso do servidor.
function emBrasilia(iso: string | Date): { ano: number; chave: string; diaSemana: number; hora: number; minuto: number } {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const local = new Date(d.getTime() + FUSO_BR * 3_600_000);
  return {
    ano: local.getUTCFullYear(),
    chave: ddmm(local),
    diaSemana: local.getUTCDay(), // 0 domingo, 6 sábado
    hora: local.getUTCHours(),
    minuto: local.getUTCMinutes(),
  };
}

export type Veredito = { ok: true; aviso?: string } | { ok: false; erro: string };

// Vale para agendar compromisso e para disparar e-mail de clínica.
export function diaDeTrabalho(iso: string | Date): Veredito {
  const { ano, chave, diaSemana, hora, minuto } = emBrasilia(iso);

  if (diaSemana === 0 || diaSemana === 6) {
    return { ok: false, erro: "Fim de semana não. Clínica só de segunda a sexta." };
  }
  const feriado = feriadosNacionais(ano).get(chave);
  if (feriado) {
    return { ok: false, erro: `${feriado} é feriado. Nada de contato nem compromisso em feriado.` };
  }
  const minutos = hora * 60 + minuto;
  if (minutos < 8 * 60) {
    return { ok: true, aviso: "Antes das 8h a clínica costuma não estar aberta." };
  }
  if (minutos > 17 * 60) {
    return { ok: true, aviso: "Depois das 17h as clínicas quase não respondem — o limite é 17h." };
  }
  return { ok: true };
}

// Próximo dia útil a partir de uma data, mantendo a hora. Usado no "retorno
// em 1 mês": se cair em sábado ou feriado, anda para a frente.
export function proximoDiaUtil(iso: string | Date): Date {
  let d = typeof iso === "string" ? new Date(iso) : new Date(iso.getTime());
  for (let i = 0; i < 30; i++) {
    const v = diaDeTrabalho(d);
    if (v.ok) return d;
    d = new Date(d.getTime() + 86_400_000);
  }
  return d;
}
