// Contexto de marca para os agentes: voz, pilares, posicionamento e oferta.
// Fonte de verdade: marketing/BRIEF_SYSVETMAX.md e marketing/PESQUISA_MERCADO.md.
// Implementacao na Fase 1 (carregar e expor como string para o system prompt).

export const BRAND = {
  company: "Sysmax Software",
  product: "Sysvetmax",
  commercialPhone: process.env.SYSMAX_COMMERCIAL_PHONE ?? "5516997023340",
};

// TODO(Fase 1): carregar o BRIEF e montar o system prompt comercial consultivo.
