-- ===========================================================================
-- 0008_social_investimento — quanto foi investido em trafego pago no dia
-- ---------------------------------------------------------------------------
-- A captacao rodou um teste de R$ 27 em 3 dias (10-13/out/2026) e perguntou se
-- vale investir. Sem o valor gasto ao lado das visualizacoes, a resposta e
-- chute. Em centavos para nao haver float em dinheiro.
-- Aditiva.
-- ===========================================================================

alter table social_metrics add column if not exists investimento_centavos integer;
