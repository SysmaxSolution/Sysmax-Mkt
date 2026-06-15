// ===========================================================================
// Cliente Evolution API (portado do VetMax) — instancia COMERCIAL da Sysmax.
// Le credenciais do ambiente; a instancia e fixa (EVOLUTION_COMMERCIAL_INSTANCE).
// ===========================================================================

type Creds = { apiUrl: string; instanceId: string; apiKey: string };

function creds(): Creds {
  const apiUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instanceId = process.env.EVOLUTION_COMMERCIAL_INSTANCE ?? "sysmax-comercial";
  if (!apiUrl || !apiKey) throw new Error("EVOLUTION_API_URL/KEY ausentes no ambiente.");
  return { apiUrl, apiKey, instanceId };
}

function headers(apiKey: string): Record<string, string> {
  return { "Content-Type": "application/json", apikey: apiKey };
}

function formatPhone(raw: string): string {
  if (raw.includes("@")) return raw;
  const digits = raw.replace(/\D/g, "");
  return digits.startsWith("55") && digits.length >= 12 ? digits : "55" + digits;
}

// Converte markdown CommonMark da IA para o dialeto do WhatsApp.
function normalizeWhatsAppMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*\n]+?)\*\*/g, "*$1*")
    .replace(/__([^_\n]+?)__/g, "_$1_")
    .replace(/~~([^~\n]+?)~~/g, "~$1~");
}

export async function sendText(phone: string, message: string): Promise<void> {
  const c = creds();
  const url = `${c.apiUrl}/message/sendText/${c.instanceId}`;
  const body = JSON.stringify({ number: formatPhone(phone), text: normalizeWhatsAppMarkdown(message) });
  const res = await fetch(url, { method: "POST", headers: headers(c.apiKey), body });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Evolution sendText ${res.status}: ${t}`);
  }
}

// Resolve um JID @lid para o numero real via cache de contatos da instancia.
export async function fetchContactByLid(lidJid: string): Promise<string | null> {
  const c = creds();
  try {
    const res = await fetch(`${c.apiUrl}/chat/findContacts/${c.instanceId}`, {
      method: "POST",
      headers: headers(c.apiKey),
      body: JSON.stringify({ where: { remoteJid: lidJid } }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const contacts: Record<string, unknown>[] = Array.isArray(data) ? data : [];
    for (const ct of contacts) {
      const id = ct.id as string | undefined;
      if (id && id.endsWith("@s.whatsapp.net")) return id;
      const phone = ct.phone as string | undefined;
      if (phone) return phone.includes("@") ? phone : `${phone}@s.whatsapp.net`;
    }
    return null;
  } catch {
    return null;
  }
}
