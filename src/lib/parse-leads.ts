// ===========================================================================
// Interpreta a lista de clínicas que a captação extrai com a IA dela e cola no
// painel. O formato varia entre rodadas ("E-mail:", 'E-mail "correto":',
// "Destinatário (E-mail):", nome na linha seguinte ao rótulo), então o parser é
// tolerante de propósito: o que ele não entender vira aviso na prévia, nunca
// lead silenciosamente errado.
// ===========================================================================

export type ParsedLead = {
  clinic: string;
  contact: string | null;
  city: string | null;
  country: string;
  email: string | null;
  phone: string | null;
  subject: string | null;
  emailBody: string | null;
  raw: string;
  warnings: string[];
};

// Local vem em texto livre ("Manassas, Virginia, EUA", "Austin, Texas (EUA)",
// "Dubai, Emirados Árabes Unidos"). Mapeia pelo nome do país no fim da frase.
const PAISES: { re: RegExp; sigla: string }[] = [
  { re: /\b(eua|usa|estados unidos|united states|u\.s\.a?\.?)\b/i, sigla: "US" },
  { re: /\bportugal\b/i, sigla: "PT" },
  { re: /\b(emirados|dubai|abu dhabi|uae|united arab)\b/i, sigla: "AE" },
  { re: /\b(reino unido|united kingdom|inglaterra|london|londres|uk)\b/i, sigla: "GB" },
  { re: /\b(espanha|spain|madrid|barcelona)\b/i, sigla: "ES" },
  { re: /\b(m[eé]xico|mexico)\b/i, sigla: "MX" },
  { re: /\b(argentina|buenos aires)\b/i, sigla: "AR" },
  { re: /\b(brasil|brazil)\b/i, sigla: "BR" },
  { re: /\b(canad[aá]|canada|toronto)\b/i, sigla: "CA" },
  { re: /\b(austr[aá]lia|australia|sydney)\b/i, sigla: "AU" },
];

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
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
  for (const p of PAISES) if (p.re.test(texto)) return p.sigla;
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
      const cand = linhas.find((l) => {
        const t = l.trim();
        if (Object.values(ROTULOS).some((r) => r.test(t))) return false;
        if (EMAIL_RE.test(t)) return false;
        if (/^[A-ZÀ-Ú\s\d().—–-]{6,}$/.test(t) && !/[a-zà-ú]/.test(t)) return false; // cabeçalho em CAIXA ALTA
        return t.length > 2;
      });
      clinic = cand?.trim() ?? null;
    }
    if (!clinic) continue;

    const warnings: string[] = [];
    const emailBruto = emailM.valor ?? "";
    const email = (emailBruto.match(EMAIL_RE) ?? bloco.match(EMAIL_RE) ?? [null])[0];
    if (email) {
      if (/@(gmail|hotmail|outlook|yahoo|icloud)\./i.test(email)) {
        warnings.push("e-mail pessoal (gmail/hotmail), não institucional");
      }
    } else {
      warnings.push("sem e-mail");
    }

    const phoneBruto = phoneM.valor ?? "";
    const phoneMatch = phoneBruto.match(PHONE_RE) ?? null;
    const phone = phoneMatch ? phoneMatch[0].replace(/\D/g, "") : null;

    const local = localM.valor ?? "";
    const country = paisDe(local) ?? paisDe(bloco) ?? paisPadrao;
    if (!paisDe(local) && !paisDe(bloco)) warnings.push(`país não identificado, assumi ${paisPadrao}`);

    out.push({
      clinic: clinic.slice(0, 160),
      contact: contactM.valor ? contactM.valor.slice(0, 120) : null,
      city: cidadeDe(local),
      country,
      email: email ? email.toLowerCase() : null,
      phone,
      subject: subjectM.valor ? subjectM.valor.slice(0, 200) : null,
      emailBody,
      raw: bloco,
      warnings,
    });
  }
  return out;
}
