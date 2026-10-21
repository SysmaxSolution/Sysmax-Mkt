-- ===========================================================================
-- 0019_vertical_e_score — Kanban por ramo + score automatico de lead
-- ---------------------------------------------------------------------------
-- vertical: hoje a descoberta (discover-prospects.mjs) so busca "clinica
-- veterinaria" no Google Places, entao TODO lead existente e veterinario por
-- definicao -- o campo ja fica pronto para quando laboratorio/estetico
-- entrarem na descoberta (fase futura).
--
-- lead_score: calculado por cron (nao digitado por ninguem), usado pelo
-- Kanban/copiloto para identificar lead quente/frio. Comeca em 0 — so passa
-- a ter sinal real depois que o registro automatico de contato (WhatsApp
-- multi-instancia, 0018) tiver historico suficiente.
-- Aditiva.
-- ===========================================================================

alter table leads add column if not exists vertical text not null default 'veterinario';
alter table leads add column if not exists lead_score integer not null default 0;
alter table leads add column if not exists lead_score_computed_at timestamptz;

update leads set vertical = 'veterinario' where vertical is null;

create index if not exists leads_vertical_idx on leads (vertical);
create index if not exists leads_score_idx on leads (lead_score desc);
