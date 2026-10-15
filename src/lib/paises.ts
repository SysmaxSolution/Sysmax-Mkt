// ===========================================================================
// Países para a prospecção internacional. A captação pediu (2026-10-15) um
// campo onde ela DIGITA o país em vez de procurar numa lista fixa: ela quer
// abrir mercados novos (México, etc.) sem depender de alguém cadastrar antes,
// e quer achar "EUA" digitando, sem rolar a lista.
//
// `ddi` e `nacional` alimentam a montagem do telefone: errar aqui é abrir a
// conversa de WhatsApp com o número errado, então os valores são conservadores
// e o resto do fluxo confere o resultado antes de usar.
// ===========================================================================

export type Pais = {
  sigla: string;
  nome: string;
  ddi: string;
  nacional: [number, number]; // dígitos do número sem o DDI
  apelidos?: string[];
};

export const PAISES: Pais[] = [
  { sigla: "US", nome: "Estados Unidos", ddi: "1", nacional: [10, 10], apelidos: ["eua", "usa", "united states", "america"] },
  { sigla: "PT", nome: "Portugal", ddi: "351", nacional: [9, 9] },
  { sigla: "AE", nome: "Emirados Árabes Unidos", ddi: "971", nacional: [8, 9], apelidos: ["emirados", "dubai", "abu dhabi", "uae"] },
  { sigla: "GB", nome: "Reino Unido", ddi: "44", nacional: [9, 10], apelidos: ["inglaterra", "uk", "united kingdom", "londres"] },
  { sigla: "ES", nome: "Espanha", ddi: "34", nacional: [9, 9], apelidos: ["spain"] },
  { sigla: "MX", nome: "México", ddi: "52", nacional: [10, 10], apelidos: ["mexico"] },
  { sigla: "AR", nome: "Argentina", ddi: "54", nacional: [10, 11] },
  { sigla: "BR", nome: "Brasil", ddi: "55", nacional: [10, 11], apelidos: ["brazil"] },
  { sigla: "CA", nome: "Canadá", ddi: "1", nacional: [10, 10], apelidos: ["canada"] },
  { sigla: "AU", nome: "Austrália", ddi: "61", nacional: [9, 9], apelidos: ["australia"] },
  { sigla: "NZ", nome: "Nova Zelândia", ddi: "64", nacional: [8, 9], apelidos: ["new zealand"] },
  { sigla: "IE", nome: "Irlanda", ddi: "353", nacional: [9, 9], apelidos: ["ireland"] },
  { sigla: "FR", nome: "França", ddi: "33", nacional: [9, 9], apelidos: ["franca", "france"] },
  { sigla: "DE", nome: "Alemanha", ddi: "49", nacional: [10, 11], apelidos: ["germany"] },
  { sigla: "IT", nome: "Itália", ddi: "39", nacional: [9, 10], apelidos: ["italia", "italy"] },
  { sigla: "NL", nome: "Países Baixos", ddi: "31", nacional: [9, 9], apelidos: ["holanda", "netherlands"] },
  { sigla: "BE", nome: "Bélgica", ddi: "32", nacional: [8, 9], apelidos: ["belgica", "belgium"] },
  { sigla: "CH", nome: "Suíça", ddi: "41", nacional: [9, 9], apelidos: ["suica", "switzerland"] },
  { sigla: "AT", nome: "Áustria", ddi: "43", nacional: [10, 11], apelidos: ["austria"] },
  { sigla: "SE", nome: "Suécia", ddi: "46", nacional: [7, 9], apelidos: ["suecia", "sweden"] },
  { sigla: "NO", nome: "Noruega", ddi: "47", nacional: [8, 8], apelidos: ["norway"] },
  { sigla: "DK", nome: "Dinamarca", ddi: "45", nacional: [8, 8], apelidos: ["denmark"] },
  { sigla: "FI", nome: "Finlândia", ddi: "358", nacional: [9, 10], apelidos: ["finlandia", "finland"] },
  { sigla: "PL", nome: "Polônia", ddi: "48", nacional: [9, 9], apelidos: ["polonia", "poland"] },
  { sigla: "CL", nome: "Chile", ddi: "56", nacional: [9, 9] },
  { sigla: "CO", nome: "Colômbia", ddi: "57", nacional: [10, 10], apelidos: ["colombia"] },
  { sigla: "PE", nome: "Peru", ddi: "51", nacional: [9, 9] },
  { sigla: "UY", nome: "Uruguai", ddi: "598", nacional: [8, 8], apelidos: ["uruguay"] },
  { sigla: "PY", nome: "Paraguai", ddi: "595", nacional: [9, 9], apelidos: ["paraguay"] },
  { sigla: "BO", nome: "Bolívia", ddi: "591", nacional: [8, 8], apelidos: ["bolivia"] },
  { sigla: "EC", nome: "Equador", ddi: "593", nacional: [9, 9], apelidos: ["ecuador"] },
  { sigla: "CR", nome: "Costa Rica", ddi: "506", nacional: [8, 8] },
  { sigla: "PA", nome: "Panamá", ddi: "507", nacional: [8, 8], apelidos: ["panama"] },
  { sigla: "SA", nome: "Arábia Saudita", ddi: "966", nacional: [9, 9], apelidos: ["arabia saudita", "saudi"] },
  { sigla: "QA", nome: "Catar", ddi: "974", nacional: [8, 8], apelidos: ["qatar"] },
  { sigla: "KW", nome: "Kuwait", ddi: "965", nacional: [8, 8], apelidos: ["kuwait"] },
  { sigla: "IL", nome: "Israel", ddi: "972", nacional: [9, 9] },
  { sigla: "TR", nome: "Turquia", ddi: "90", nacional: [10, 10], apelidos: ["turkey"] },
  { sigla: "ZA", nome: "África do Sul", ddi: "27", nacional: [9, 9], apelidos: ["africa do sul", "south africa"] },
  { sigla: "AO", nome: "Angola", ddi: "244", nacional: [9, 9] },
  { sigla: "MZ", nome: "Moçambique", ddi: "258", nacional: [9, 9], apelidos: ["mocambique", "mozambique"] },
  { sigla: "JP", nome: "Japão", ddi: "81", nacional: [10, 10], apelidos: ["japao", "japan"] },
  { sigla: "SG", nome: "Singapura", ddi: "65", nacional: [8, 8], apelidos: ["singapore"] },
  { sigla: "IN", nome: "Índia", ddi: "91", nacional: [10, 10], apelidos: ["india"] },
];

const PORSIGLA = new Map(PAISES.map((p) => [p.sigla, p]));

export function paisPorSigla(sigla: string): Pais | undefined {
  return PORSIGLA.get((sigla ?? "").toUpperCase());
}

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

// Aceita o que a equipe digitar: sigla ("US"), nome ("México", "Mexico") ou
// apelido ("EUA", "Dubai"). Devolve undefined quando não reconhece — quem
// chama decide se recusa ou pede confirmação, nunca adivinha.
export function resolverPais(entrada: string): Pais | undefined {
  const t = semAcento(entrada);
  if (!t) return undefined;
  if (t.length === 2) {
    const porSigla = PORSIGLA.get(t.toUpperCase());
    if (porSigla) return porSigla;
  }
  const exato = PAISES.find((p) => semAcento(p.nome) === t || p.apelidos?.some((a) => semAcento(a) === t));
  if (exato) return exato;
  return PAISES.find((p) => semAcento(p.nome).startsWith(t) || p.apelidos?.some((a) => semAcento(a).startsWith(t)));
}
