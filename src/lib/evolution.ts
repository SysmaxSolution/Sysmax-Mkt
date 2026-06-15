// Porta do cliente Evolution API do VetMax (src/lib/evolution-api-client.ts),
// apontando para a instancia COMERCIAL dedicada da Sysmax.
// Implementacao na Fase 1 (sendText / sendMedia / estado da conexao).
// Reaproveitar: normalizacao de markdown, fallback base64 em sendMedia,
// resolucao de JID @lid -> numero real.

export const EVOLUTION_INSTANCE = process.env.EVOLUTION_COMMERCIAL_INSTANCE ?? "sysmax-comercial";

// TODO(Fase 1): portar evolutionSendText, evolutionSendMedia, evolutionGetConnectionState.
export {};
