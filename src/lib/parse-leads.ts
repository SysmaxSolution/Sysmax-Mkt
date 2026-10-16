// ===========================================================================
// Interpreta a lista de clínicas que a captação extrai com a IA dela e cola no
// painel. O formato varia entre rodadas ("E-mail:", 'E-mail "correto":',
// "Destinatário (E-mail):", nome na linha seguinte ao rótulo), então o parser é
// tolerante de propósito: o que ele não entender vira aviso na prévia, nunca
// lead silenciosamente errado.
// ===========================================================================

import { PAISES } from "@/lib/paises";

export type ParsedLead = {
  clinic: string;
  contact: string | null;
  city: string | null;
  country: string;
  email: string | null;
  phone: string | null;
  subject: string | null;
  emailBody: string | null;
  uf: string | null;
  nota: string | null;
  raw: string;
  warnings: string[];
};

// Local vem em texto livre ("Manassas, Virginia, EUA", "Austin, Texas (EUA)",
// "Dubai, Emirados Árabes Unidos"). Os padrões saem da MESMA lista usada pelo
// campo de país e pelo telefone: país novo cadastrado lá passa a ser
// reconhecido aqui sem nenhuma outra alteração.
const PADROES: { re: RegExp; sigla: string }[] = PAISES.flatMap((p) => {
  const termos = [p.nome, ...(p.apelidos ?? [])]
    .map((t) => t.normalize("NFD").replace(/[̀-ͯ]/g, ""))
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length);
  return [{ re: new RegExp(`\\b(?:${termos.join("|")})\\b`, "i"), sigla: p.sigla }];
});

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

// Siglas dos estados: a lista que a equipe traz do caderno/Keep termina em
// "Umuarama - Paraná" ou "Bauru - SP". Reconhecer isso resolve cidade, UF e,
// de quebra, o pais -- sem UF a lista inteira entrava como se fosse dos EUA.
const UFS: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará",
  DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão",
  MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará",
  PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte", RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima",
  SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};
const semAcento = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const POR_NOME: Record<string, string> = Object.fromEntries(
  Object.entries(UFS).map(([sigla, nome]) => [semAcento(nome), sigla]),
);

// "Umuarama - Paraná" / "Bauru - SP" / "Umuarama/PR" -> { city, uf }
function cidadeUf(linha: string): { city: string; uf: string } | null {
  const m = linha.trim().match(/^(.{2,60}?)\s*[-–—/]\s*([A-Za-zÀ-ú\s]{2,25})$/);
  if (!m) return null;
  const cauda = m[2].trim();
  const uf = cauda.length === 2 ? cauda.toUpperCase() : POR_NOME[semAcento(cauda)];
  if (!uf || !UFS[uf]) return null;
  return { city: m[1].trim(), uf };
}

// Telefone brasileiro em texto livre: 10 ou 11 digitos com DDD, com ou sem o
// 55 na frente. Rejeita data (8.10.26), CEP e CNPJ, que tambem sao numeros.
function foneBr(linha: string): string | null {
  const t = linha.trim();
  if (/^(?:data|obs|cnpj|cep)\b/i.test(t)) return null;
  if (/\d{2}[./-]\d{2}[./-]\d{2,4}/.test(t)) return null;          // data
  if (/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.test(t)) return null;    // CNPJ
  if (/\b\d{5}-?\d{3}\b/.test(t) && !/\d{4}-?\d{4}/.test(t)) return null; // CEP
  const d = t.replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) return d;
  if (d.length === 12 && d.startsWith("55")) return d;
  if (d.length === 11 || d.length === 10) return "55" + d;
  return null;
}

// Linha que e so numero/endereco nao serve como nome de clinica.
function pareceNome(t: string): boolean {
  if (t.length < 3) return false;
  if (foneBr(t)) return false;
  if (EMAIL_RE.test(t)) return false;
  if (/^(?:data|obs|cnpj|cep)\b/i.test(t)) return false;
  if (/^(?:R\.|Rua|Av\.|Avenida|Alameda|Trav\.|Travessa|Rod\.|Rodovia)\b/i.test(t)) return false;
  if (cidadeUf(t)) return false;
  const digitos = (t.match(/\d/g) ?? []).length;
  return digitos < t.length / 2;
}
// Telefone internacional em texto: + opcional, 8 a 15 dígitos com separadores.
const PHONE_RE = /\+?\d[\d\s().-]{7,20}\d/;

// O ':' é OBRIGATÓRIO em todo rótulo. Sem isso, "Clínica Veterinária de Braga"
// casava com o rótulo curto 'clinica' e o nome chegava sem a 1ª palavra.
const ROTULOS = {
  clinic: /^(?:nome\s+da\s+cl[ií]nica|nome\s+da\s+empresa|cl[ií]nica|nome)\s*:\s*(.*)$/i,
  local: /^(?:local|localiza[çc][ãa]o|cidade|endere[çc]o|pa[íi]s)\s*:\s*(.*)$/i,
  contact: /^(?:respons[áa]vel|contato|propriet[áa]ri[oa]|diretor[a]?|gestor[a]?)\s*:\s*(.*)$/i,
  email: /^(?:e-?mail(?:\s*"?correto"?)?|destinat[áa]rio\s*\(e-?mail\)|endere[çc]o\s+de\s+e-?mail)\s*:\s*(.*)$/i,
  phone: /^(?:telefone|tel|whatsapp|zap|celular|phone)\s*:\s*(.*)$/i,
  // A IA da equipe (Gemini) já devolve o e-mail redigido por clínica, então
  // importamos assunto e corpo junto: ela deixa de copiar e colar.
  subject: /^(?:assunto(?:\s+e-?mail)?|subject)\s*:\s*(.*)$/i,
  emailBody: /^(?:texto(?:\s+(?:do\s+)?e-?mail)?|corpo(?:\s+do\s+e-?mail)?|mensagem|body)\s*:\s*(.*)$/i,
};

function paisDe(texto: string): string | null {
  // Compara sem acento: a lista chega com "Mexico" e "México" misturados.
  const t = texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
  for (const p of PADROES) if (p.re.test(t)) return p.sigla;
  return null;
}

// "Manassas, Virginia, EUA" → "Manassas". Tira o país e o estado do fim.
function cidadeDe(local: string): string | null {
  const limpo = local.replace(/\((.*?)\)/g, " ").replace(/\s+/g, " ").trim();
  if (!limpo) return null;
  const partes = limpo.split(/[,;–—]/).map((s) => s.trim()).filter(Boolean);
  if (!partes.length) return null;
  const semPais = partes.filter((p) => !paisDe(p));
  return (semPais[0] ?? partes[0]).slice(0, 80) || null;
}

// Quebra o texto colado em blocos de uma clínica cada. Aceita separador de
// '=' / '---', linha em branco, ou o próprio rótulo de nome reiniciando.
function dividirBlocos(texto: string): string[] {
  const normal = texto.replace(/\r\n/g, "\n");

  // Lista de caderno nao tem rotulo nenhum: o que separa uma clinica da
  // outra e a linha em branco. So vale quando NAO ha rotulo no texto todo --
  // na lista que a IA monta, linha em branco aparece dentro do corpo do
  // e-mail, e dividir ali picotaria a mensagem.
  const temRotulo = normal.split("\n").some((l) => ROTULOS.clinic.test(l.trim()));
  if (!temRotulo) {
    const porLinhaVazia = normal.split(/\n[ \t]*\n/).map((b) => b.trim()).filter(Boolean);
    if (porLinhaVazia.length > 1) return porLinhaVazia;
  }
  const porSeparador = normal
    .split(/^\s*(?:[=*_-]{1,}|•)\s*$/m)
    .map((b) => b.trim())
    .filter(Boolean);

  const blocos: string[] = [];
  for (const bloco of porSeparador) {
    const linhas = bloco.split("\n");
    let atual: string[] = [];
    for (const linha of linhas) {
      const abreNovo = ROTULOS.clinic.test(linha.trim()) && atual.some((l) => ROTULOS.clinic.test(l.trim()));
      if (abreNovo) { blocos.push(atual.join("\n")); atual = [linha]; continue; }
      atual.push(linha);
    }
    if (atual.length) blocos.push(atual.join("\n"));
  }
  return blocos.map((b) => b.trim()).filter(Boolean);
}

function valorDoRotulo(linhas: string[], re: RegExp): { valor: string | null; idx: number } {
  for (let i = 0; i < linhas.length; i++) {
    const m = linhas[i].trim().match(re);
    if (!m) continue;
    const direto = (m[1] ?? "").trim().replace(/^["'“”]|["'“”]$/g, "").trim();
    if (direto) return { valor: direto, idx: i };
    // Rótulo sem valor na mesma linha: a IA às vezes quebra a linha.
    const proxima = (linhas[i + 1] ?? "").trim();
    if (proxima && !Object.values(ROTULOS).some((r) => r.test(proxima))) {
      return { valor: proxima.replace(/^["'“”]|["'“”]$/g, "").trim(), idx: i };
    }
    return { valor: null, idx: i };
  }
  return { valor: null, idx: -1 };
}

// A lista vem agrupada por país, com cabeçalhos como "🇺🇸 ESTADOS UNIDOS (USA)".
// Sem reconhecê-los, o corpo do e-mail de uma clínica engolia o cabeçalho da
// seção seguinte.
function ehCabecalhoDeSecao(linha: string): boolean {
  const t = linha.trim();
  if (!t) return false;
  if (/\p{Extended_Pictographic}|\u{1F1E6}-\u{1F1FF}/u.test(t) && t.length < 60) return true;
  return t.length < 60 && !/[a-zà-ú]/.test(t) && /[A-ZÀ-Ú]{4,}/.test(t);
}

// O corpo do e-mail é multi-linha: começa no rótulo e segue até o fim do
// bloco, pulando as linhas que são outros rótulos conhecidos.
function corpoDoEmail(linhas: string[]): string | null {
  const i = linhas.findIndex((l) => ROTULOS.emailBody.test(l.trim()));
  if (i < 0) return null;
  const primeira = (linhas[i].trim().match(ROTULOS.emailBody)?.[1] ?? "").trim();
  const resto: string[] = [];
  for (let j = i + 1; j < linhas.length; j++) {
    const t = linhas[j];
    const ehOutroRotulo = [ROTULOS.clinic, ROTULOS.local, ROTULOS.contact, ROTULOS.email, ROTULOS.phone, ROTULOS.subject]
      .some((r) => r.test(t.trim()));
    if (ehOutroRotulo || ehCabecalhoDeSecao(t)) break;
    resto.push(t);
  }
  const corpo = [primeira, ...resto].join("\n").trim();
  return corpo || null;
}

export function parseLeadList(texto: string, paisPadrao = "US"): ParsedLead[] {
  const out: ParsedLead[] = [];
  for (const bloco of dividirBlocos(texto)) {
    const linhas = bloco.split("\n").filter((l) => l.trim());
    if (!linhas.length) continue;

    const clinicM = valorDoRotulo(linhas, ROTULOS.clinic);
    const localM = valorDoRotulo(linhas, ROTULOS.local);
    const contactM = valorDoRotulo(linhas, ROTULOS.contact);
    const emailM = valorDoRotulo(linhas, ROTULOS.email);
    const phoneM = valorDoRotulo(linhas, ROTULOS.phone);
    const subjectM = valorDoRotulo(linhas, ROTULOS.subject);
    const emailBody = corpoDoEmail(linhas);

    // Sem rótulo de nome: usa a 1ª linha que não seja outro rótulo nem cabeçalho.
    let clinic = clinicM.valor;
    if (!clinic) {
      // Sem rótulo: a 1ª linha que PAREÇA nome. Antes bastava ter 3 letras, e
      // numa lista de caderno (telefone na 1ª linha) o telefone virava o nome
      // da clínica.
      const cand = linhas.find((l) => {
        const t = l.trim();
        if (Object.values(ROTULOS).some((r) => r.test(t))) return false;
        if (/^[A-ZÀ-Ú\s\d().—–-]{6,}$/.test(t) && !/[a-zà-ú]/.test(t)) return false; // cabeçalho em CAIXA ALTA
        return pareceNome(t);
      });
      clinic = cand?.trim() ?? null;
    }
    if (!clinic) continue;

    const warnings: string[] = [];
    const warnings_fone: string[] = [];
    const emailBruto = emailM.valor ?? "";
    const email = (emailBruto.match(EMAIL_RE) ?? bloco.match(EMAIL_RE) ?? [null])[0];
    if (email) {
      if (/@(gmail|hotmail|outlook|yahoo|icloud)\./i.test(email)) {
        warnings.push("e-mail pessoal (gmail/hotmail), não institucional");
      }
    } else {
      warnings.push("sem e-mail");
    }

    // O e-mail já procurava no bloco inteiro quando não havia rótulo; o
    // telefone não — e numa lista de caderno ele nunca vem rotulado. Numa
    // prospecção por WhatsApp, telefone perdido é a clínica perdida.
    const phoneBruto = phoneM.valor ?? "";
    let phone: string | null = null;
    const comRotulo = phoneBruto.match(PHONE_RE);
    if (comRotulo) phone = comRotulo[0].replace(/\D/g, "");
    if (!phone) {
      for (const l of linhas) {
        const f = foneBr(l);
        if (f) { phone = f; break; }
      }
    }
    if (!phone) warnings_fone.push("sem telefone");

    const local = localM.valor ?? "";
    // "Umuarama - Paraná" numa linha solta resolve cidade, UF e país de uma
    // vez. Sem isso, lista brasileira inteira entrava como se fosse dos EUA,
    // que é o padrão do campo.
    const linhaCidade = linhas.map((l) => cidadeUf(l)).find(Boolean) ?? null;
    const country = linhaCidade ? "BR" : (paisDe(local) ?? paisDe(bloco) ?? paisPadrao);
    if (!linhaCidade && !paisDe(local) && !paisDe(bloco)) {
      warnings.push(`país não identificado, assumi ${paisPadrao}`);
    }
    // "obs: 13.10 - 9h - a clínica respondeu" é o histórico dela. Vai para a
    // anotação da clínica em vez de se perder na importação.
    const nota = linhas
      .filter((l) => /^(?:obs|observa[çc][ãa]o|data\s+contato)\s*:/i.test(l.trim()))
      .map((l) => l.trim())
      .join(" | ") || null;

    out.push({
      clinic: clinic.slice(0, 160),
      contact: contactM.valor ? contactM.valor.slice(0, 120) : null,
      city: linhaCidade?.city ?? cidadeDe(local),
      country,
      email: email ? email.toLowerCase() : null,
      phone,
      subject: subjectM.valor ? subjectM.valor.slice(0, 200) : null,
      emailBody,
      uf: linhaCidade?.uf ?? null,
      nota,
      raw: bloco,
      warnings: [...warnings, ...warnings_fone],
    });
  }
  return out;
}
