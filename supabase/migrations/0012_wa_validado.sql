-- ===========================================================================
-- 0012_wa_validado — telefone so vale se tiver WhatsApp
-- ---------------------------------------------------------------------------
-- Regra que ela estabeleceu em 16/10: "a maioria das clinicas no Brasil NAO
-- atende ligacao (...) nao existe ligacao para telefone fixo, muito menos para
-- celular sem whatsapp validado". Entao o cartao so mostra o telefone quando
-- o numero existe no WhatsApp.
-- Aditiva.
-- ===========================================================================

alter table leads add column if not exists wa_valido boolean;
alter table leads add column if not exists wa_checado_em timestamptz;

create index if not exists leads_wa_checado_idx on leads (wa_checado_em) where wa_checado_em is null;
