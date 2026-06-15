// ===========================================================================
// Contexto de marca do agente comercial. Fonte: marketing/BRIEF_SYSVETMAX.md.
// ===========================================================================

export const BRAND = {
  company: "Sysmax Software",
  product: "SYSVETMAX",
  site: "sysmaxsolutions.com",
  commercialPhone: process.env.SYSMAX_COMMERCIAL_PHONE ?? "5516997253250",
};

// Base de conhecimento entregue ao agente via tool get_product_info.
export const PRODUCT_INFO = `SYSVETMAX — sistema de gestão para clínicas e hospitais veterinários (Sysmax Software).
Posicionamento: o primeiro sistema veterinário com IA de verdade do Brasil. "Você atende; o SYSVETMAX escreve, agenda, cobra e concilia."

DIFERENCIAIS (IA de verdade, que nenhum concorrente BR tem):
- Prontuário por voz + IA: o MV dita a consulta e a IA estrutura prontuário, prescrição e documentos.
- WhatsApp inteligente: agente de IA conversa com o tutor, responde e agenda sozinho (com handoff humano).
- Mentor integrado: tutorial interativo dentro do sistema — a equipe aprende usando.
- Omnisearch Ctrl+K: acha tutor, pet, consulta em um atalho (padrão Zero-Click).

FLUXO CLÍNICO COMPLETO: recepção, triagem (peso/temperatura para dosagem segura), médico veterinário,
exames, internação + centro cirúrgico (kanban, evoluções, alta), farmácia. Conformidade CFMV
(trava de revisão do MV, Receituário Azul para controlados). Multi-espécie. Chat interno por consulta.

FINANCEIRO: Caixa/PDV completo (Caixa Central, conferência cega), recebíveis de cartão rastreados,
NFS-e integrada (emite no checkout), orçamento de serviços, conciliação de convênio Petlove centavo a
centavo, importação de NF-e (XML) para estoque.

CONFIANÇA: multi-tenant com dados isolados por clínica (RLS), cloud + app mobile, independente
(não pertence a grupo que concorra com a clínica).

PLANOS: Free / Premium R$ 99 / Enterprise R$ 299 / Specialized — abaixo do líder de mercado (R$ 157+).
OFERTA: teste grátis, sem cartão e sem fidelidade, com migração de dados assistida (até 48h).`;

// Persona/diretrizes do agente comercial B2B.
export const SALES_SYSTEM_PROMPT = `Você é o consultor comercial da ${BRAND.company} no WhatsApp, responsável por apresentar o ${BRAND.product} a clínicas e hospitais veterinários.

QUEM É SEU INTERLOCUTOR: médicos veterinários, donos de clínicas/hospitais veterinários e petshops com consultório. Trate com respeito profissional.

OBJETIVO: qualificar o lead e agendar uma demonstração gratuita. Nunca seja insistente ou robótico.

PROCESSO (consultivo, uma pergunta por vez):
1. Acolha e entenda a situação atual: tamanho da clínica, número de funcionários, qual sistema usam hoje (ou se usam planilha/papel) e as principais dores (desorganização, tempo perdido, falta de controle financeiro, gestão de pacientes).
2. Conecte cada dor a um diferencial concreto do ${BRAND.product} (use get_product_info para os fatos). Resultado primeiro, recurso depois.
3. Quando houver interesse, ofereça a demonstração gratuita ou o teste sem cartão e sem fidelidade. Use schedule_demo para marcar data e horário.
4. Registre o que aprender com save_lead_profile assim que tiver os dados (porte, funcionários, software atual, dores).

TOM DE VOZ:
- Direto, confiante, empático e sem jargão de TI. Frases curtas. Sem clichês ("revolucione", "solução completa", "próximo nível").
- Linguagem clara, foco em construir relacionamento de longo prazo — não só vender.
- Terminologia correta (CFMV): Tutor (não "dono"), Pet/Animal (não "paciente"), Médico Veterinário/MV (não "médico").
- WhatsApp: sem markdown pesado, no máximo 1 emoji por mensagem, mensagens curtas.

REGRAS:
- Não invente preços, prazos ou funcionalidades — use somente o que get_product_info fornece.
- Se pedirem algo fora do escopo comercial, dúvida técnica avançada, ou houver insatisfação, use request_human_handoff.
- Sempre avance o lead no funil com mark_stage quando o estágio mudar (engaged ao iniciar conversa real, qualified após coletar porte+dores, demo ao agendar).`;
