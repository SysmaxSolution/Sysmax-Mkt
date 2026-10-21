// ===========================================================================
// Cliente Evolution API (portado do VetMax) — instancia COMERCIAL da Sysmax.
// Le credenciais do ambiente; a instancia e fixa (EVOLUTION_COMMERCIAL_INSTANCE).
// ===========================================================================

type Creds = { apiUrl: string; instanceId: string; apiKey: string };

// BOM (U+FEFF) colado em env var derruba o fetch com "Cannot convert argument
// to a ByteString" — 40 envios da leva de 28/07 falharam assim. Sanitizar sempre.
const cleanEnv = (v: string | undefined) => v?.replace(/^﻿/, "").trim() || undefined;

// instanceId opcional: cada analista (WhatsApp multi-instância no painel) usa
// a propria instancia Evolution; sem o parametro, mantem o comportamento
// antigo (instancia fixa COMERCIAL usada pelo bot/outbox).
function creds(instanceId?: string): Creds {
  const apiUrl = cleanEnv(process.env.EVOLUTION_API_URL);
  const apiKey = cleanEnv(process.env.EVOLUTION_API_KEY);
  const resolvedInstance = cleanEnv(instanceId) ?? cleanEnv(process.env.EVOLUTION_COMMERCIAL_INSTANCE) ?? "sysmax-comercial";
  if (!apiUrl || !apiKey) throw new Error("EVOLUTION_API_URL/KEY ausentes no ambiente.");
  return { apiUrl, apiKey, instanceId: resolvedInstance };
}

function headers(apiKey: string): Record<string, string> {
  return { "Content-Type": "application/json", apikey: apiKey };
}

// Throttle simples entre envios dentro da mesma invocação (evita rajadas que
// disparam anti-spam do WhatsApp). Guardrail do council: WhatsApp só warm e
// nunca em rajada. Ajustável via WA_MIN_SEND_INTERVAL_MS (default 1500ms).
let _lastSendAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function throttle(): Promise<void> {
  const minInterval = parseInt(process.env.WA_MIN_SEND_INTERVAL_MS ?? "1500", 10);
  const wait = _lastSendAt + minInterval - Date.now();
  if (wait > 0) await sleep(wait);
  _lastSendAt = Date.now();
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

export async function sendText(phone: string, message: string, instanceId?: string): Promise<void> {
  await throttle();
  const c = creds(instanceId);
  const url = `${c.apiUrl}/message/sendText/${c.instanceId}`;
  const body = JSON.stringify({ number: formatPhone(phone), text: normalizeWhatsAppMarkdown(message) });
  const res = await fetch(url, { method: "POST", headers: headers(c.apiKey), body });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Evolution sendText ${res.status}: ${t}`);
  }
}

// Envia um documento (ex.: one-pager PDF) no chat. media = base64 puro.
export async function sendDocument(phone: string, mediaBase64: string, fileName: string): Promise<void> {
  await throttle();
  const c = creds();
  const res = await fetch(`${c.apiUrl}/message/sendMedia/${c.instanceId}`, {
    method: "POST",
    headers: headers(c.apiKey),
    body: JSON.stringify({
      number: formatPhone(phone),
      mediatype: "document",
      mimetype: "application/pdf",
      media: mediaBase64,
      fileName,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Evolution sendMedia ${res.status}: ${t}`);
  }
}

// Envia uma imagem no chat (ex.: foto que a equipe anexou a um recado).
// media = base64 puro, sem o prefixo "data:".
export async function sendImage(phone: string, mediaBase64: string, mimetype: string, caption?: string): Promise<void> {
  await throttle();
  const c = creds();
  const res = await fetch(`${c.apiUrl}/message/sendMedia/${c.instanceId}`, {
    method: "POST",
    headers: headers(c.apiKey),
    body: JSON.stringify({
      number: formatPhone(phone),
      mediatype: "image",
      mimetype,
      media: mediaBase64,
      fileName: `foto.${mimetype === "image/png" ? "png" : mimetype === "image/webp" ? "webp" : "jpg"}`,
      ...(caption ? { caption: normalizeWhatsAppMarkdown(caption) } : {}),
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Evolution sendMedia(image) ${res.status}: ${t}`);
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

// ===========================================================================
// Gerenciamento de instancia — WhatsApp multi-conta no painel (um analista =
// uma instancia Evolution, pareada por QR code). Nao usa a instancia COMERCIAL
// fixa: sempre recebe o instanceId explicito do wa_accounts.
// ===========================================================================

// Cria a instancia na Evolution (idempotente o suficiente: se ja existir, a
// API retorna erro que tratamos como "ja existe, segue o fluxo de QR").
export async function createInstance(instanceId: string, webhookUrl: string): Promise<void> {
  const c = creds(instanceId);
  const res = await fetch(`${c.apiUrl}/instance/create`, {
    method: "POST",
    headers: headers(c.apiKey),
    body: JSON.stringify({
      instanceName: c.instanceId,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
      webhook: { url: webhookUrl, byEvents: false, base64: false, events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"] },
    }),
  });
  if (!res.ok && res.status !== 403) {
    const t = await res.text().catch(() => "");
    throw new Error(`Evolution instance/create ${res.status}: ${t}`);
  }
}

// Retorna o QR code (base64 "data:image/png;base64,...") para o analista
// escanear, ou null se a instancia ja estiver conectada/sem QR pendente.
export async function getInstanceQr(instanceId: string): Promise<string | null> {
  const c = creds(instanceId);
  const res = await fetch(`${c.apiUrl}/instance/connect/${c.instanceId}`, {
    method: "GET",
    headers: headers(c.apiKey),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const base64 = data?.base64 ?? data?.qrcode?.base64 ?? null;
  return typeof base64 === "string" ? base64 : null;
}

// Estado de conexao atual direto na Evolution (fonte de verdade; wa_accounts.status
// e so um cache atualizado pelo webhook CONNECTION_UPDATE).
export async function getInstanceState(instanceId: string): Promise<"open" | "connecting" | "close" | "unknown"> {
  const c = creds(instanceId);
  try {
    const res = await fetch(`${c.apiUrl}/instance/connectionState/${c.instanceId}`, {
      method: "GET",
      headers: headers(c.apiKey),
    });
    if (!res.ok) return "unknown";
    const data = await res.json().catch(() => null);
    const state = data?.instance?.state ?? data?.state;
    return state === "open" || state === "connecting" || state === "close" ? state : "unknown";
  } catch {
    return "unknown";
  }
}
