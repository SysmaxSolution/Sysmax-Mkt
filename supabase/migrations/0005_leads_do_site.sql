-- ===========================================================================
-- 0005_leads_do_site — Leads inbound (formulário do site + cadastro Free)
-- ---------------------------------------------------------------------------
-- Alimenta a aba "Leads do site" do /painel: quem LEVANTA A MÃO no site
-- (formulário com consentimento) ou cria conta Free no app. Não há rastreio de
-- visitante anônimo. Estes leads NÃO entram nos builders de outbound (que só
-- leem source='places') — contato é sempre humano.
-- Migrations aditivas e idempotentes (padrão do projeto).
--
-- ROLLBACK (manual, só se necessário):
--   drop table if exists lead_form_hits;
--   drop index if exists leads_source_created_idx;
--   alter table leads drop column if exists source_ref;
--   alter table leads drop column if exists consent_at;
--   alter table leads drop column if exists signup_at;
--   alter table leads drop constraint if exists leads_source_check;
--   alter table leads add constraint leads_source_check
--     check (source in ('whatsapp','instagram','facebook','site','indicacao','places','outro'));
--   (antes: update leads set source='outro' where source='cadastro_free';)
-- ===========================================================================

-- Nova origem: conta Free criada no app (SYSVETMAX).
alter table leads drop constraint if exists leads_source_check;
alter table leads add constraint leads_source_check
  check (source in ('whatsapp','instagram','facebook','site','indicacao','places','outro','cadastro_free'));

-- Atribuição e rastro de consentimento.
alter table leads add column if not exists source_ref  text;         -- ex.: parceiro/campanha (?ref=) ou "form"
alter table leads add column if not exists consent_at  timestamptz;  -- quando marcou o aceite no formulário
alter table leads add column if not exists signup_at   timestamptz;  -- quando criou a conta Free no app

create index if not exists leads_source_created_idx on leads (source, created_at desc);

-- Rate limit do formulário público (5/h por IP). Guarda só o hash do IP.
create table if not exists lead_form_hits (
  id          bigint generated always as identity primary key,
  ip_hash     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists lead_form_hits_ip_idx on lead_form_hits (ip_hash, created_at desc);
alter table lead_form_hits enable row level security;
