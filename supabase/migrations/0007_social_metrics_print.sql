-- ===========================================================================
-- 0007_social_metrics_print — print do relatorio de rede social
-- ---------------------------------------------------------------------------
-- A captacao tira print do relatorio do Facebook e, ate aqui, nao tinha onde
-- colocar: mandava a imagem no WhatsApp e alguem digitava os numeros (pedido
-- de 2026-10-16: "e mais em questao de te enviar relatorio do FB mesmo").
-- Agora o print sobe junto; se os numeros nao forem digitados, a linha fica
-- marcada para conferencia em vez de registrar zero.
-- Aditiva; o drop not null apenas afrouxa (nenhuma linha existente quebra).
-- ===========================================================================

alter table social_metrics add column if not exists fotos text[];
alter table social_metrics add column if not exists conferir boolean not null default false;
alter table social_metrics alter column publicacoes drop not null;
