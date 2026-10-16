-- ===========================================================================
-- 0013_ficha_clinica — campos que ela mantinha no Google Keep
-- ---------------------------------------------------------------------------
-- Ela mandou o modelo do Keep (16/10) com a ficha que usa por clinica. O que
-- o painel nao tinha e ela tinha:
--   - RESPONSAVEL (nome de quem pedir para falar) -- o mais importante:
--     "a Dra. Savana esta disponivel?" abre porta que "o responsavel" nao abre
--   - CRMV do responsavel tecnico
--   - CNPJ
-- "Raio-X de sistema" (se ja usa algum sistema) cabe em current_software, que
-- ja existe. O resto da pesquisa vai em notes.
-- Aditiva.
-- ===========================================================================

alter table leads add column if not exists responsavel text;
alter table leads add column if not exists crmv text;
alter table leads add column if not exists cnpj text;
