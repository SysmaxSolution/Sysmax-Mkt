-- ===========================================================================
-- 0001_init_sales_crm — Schema inicial do CRM comercial B2B da Sysmax Software
-- ---------------------------------------------------------------------------
-- Projeto Supabase EXCLUSIVO da Sysmax (funil de vendas do Sysvetmax).
-- Isolado do banco do produto VetMax. Aqui NAO existe clinic_id: os leads sao
-- clinicas veterinarias prospectadas, nao tenants do produto.
-- Migrations aditivas e idempotentes (IF NOT EXISTS), padrao do projeto.
-- ===========================================================================

create extension if not exists pgcrypto;

-- --- LEADS ------------------------------------------------------------------
-- Clinica veterinaria prospectada. Origem pode ser WhatsApp, IG, FB, site.
create table if not exists leads (
  id                uuid primary key default gen_random_uuid(),
  name              text,
  phone             text,                 -- E.164 sem '+', ex: 5516997023340
  email             text,
  instagram_handle  text,
  company_name      text,                 -- nome da clinica
  source            text not null default 'whatsapp'
                      check (source in ('whatsapp','instagram','facebook','site','indicacao','outro')),
  clinic_size       text check (clinic_size in ('solo','pequena','media','grande','rede')),
  employees         int,
  current_software  text,                 -- sistema que usa hoje (concorrente / planilha / nenhum)
  pains             text[] default '{}',  -- dores capturadas na qualificacao
  stage             text not null default 'new'
                      check (stage in ('new','engaged','qualified','demo','won','lost')),
  owner             text,                 -- responsavel humano (quando houver handoff)
  consent_optin     boolean not null default false,
  opted_out         boolean not null default false,
  notes             text,
  created_at        timestamptz not null default now(),
  last_contact_at   timestamptz,
  qualified_at      timestamptz,
  won_at            timestamptz
);
create unique index if not exists leads_phone_key on leads (phone) where phone is not null;
create index if not exists leads_stage_idx on leads (stage);
create index if not exists leads_source_idx on leads (source);
create index if not exists leads_ig_idx on leads (instagram_handle) where instagram_handle is not null;

-- --- CONVERSATIONS ----------------------------------------------------------
-- Uma thread por (lead, canal). status controla quem responde (bot/humano).
create table if not exists conversations (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references leads(id) on delete cascade,
  channel     text not null check (channel in ('whatsapp','instagram','facebook')),
  status      text not null default 'bot' check (status in ('bot','human','closed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists conversations_lead_idx on conversations (lead_id);
create unique index if not exists conversations_lead_channel_key on conversations (lead_id, channel);

-- --- MESSAGES ---------------------------------------------------------------
create table if not exists messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  direction        text not null check (direction in ('inbound','outbound')),
  channel          text not null check (channel in ('whatsapp','instagram','facebook')),
  content          text,
  sent_by          text not null check (sent_by in ('bot','human','client')),
  external_id      text,                  -- id da mensagem na Evolution/Meta (dedup)
  created_at       timestamptz not null default now()
);
create index if not exists messages_conversation_idx on messages (conversation_id, created_at);
create unique index if not exists messages_external_key on messages (channel, external_id) where external_id is not null;

-- --- SOCIAL_EVENTS ----------------------------------------------------------
-- Comentarios, DMs e mencoes capturados via Meta Graph (Fase 2).
create table if not exists social_events (
  id           uuid primary key default gen_random_uuid(),
  platform     text not null check (platform in ('instagram','facebook')),
  type         text not null check (type in ('comment','dm','mention')),
  external_id  text not null,             -- id do evento na Meta (dedup)
  author       text,                      -- handle/nome do autor
  content      text,
  post_ref     text,                      -- id do post/midia alvo
  intent       text check (intent in ('comercial','duvida','suporte','spam','outro')),
  handled      boolean not null default false,
  lead_id      uuid references leads(id) on delete set null,
  created_at   timestamptz not null default now()
);
create unique index if not exists social_events_external_key on social_events (platform, external_id);
create index if not exists social_events_handled_idx on social_events (handled) where handled = false;

-- --- DEMOS ------------------------------------------------------------------
create table if not exists demos (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references leads(id) on delete cascade,
  scheduled_at  timestamptz not null,
  status        text not null default 'scheduled'
                  check (status in ('scheduled','done','no_show','canceled')),
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists demos_lead_idx on demos (lead_id);
create index if not exists demos_scheduled_idx on demos (scheduled_at);

-- --- CONTENT_CALENDAR -------------------------------------------------------
-- Calendario editorial (5 pecas/semana). Orquestra o pipeline de marketing/.
create table if not exists content_calendar (
  id               uuid primary key default gen_random_uuid(),
  pillar           text,                  -- pilar de mensagem (BRIEF_SYSVETMAX)
  platform         text not null check (platform in ('instagram','facebook','youtube','google')),
  format           text,                  -- feed, carrossel, story, reel, display...
  scheduled_for    timestamptz,
  status           text not null default 'planned'
                     check (status in ('planned','generated','published','failed')),
  brief            text,                  -- brief/copy gerado pelo content-agent
  asset_path       text,                  -- caminho do criativo em marketing/output
  external_post_id text,                  -- id do post apos publicar via Graph API
  created_at       timestamptz not null default now()
);
create index if not exists content_calendar_status_idx on content_calendar (status);
create index if not exists content_calendar_sched_idx on content_calendar (scheduled_for);

-- --- METRICS_DAILY ----------------------------------------------------------
-- Consolidado diario dos KPIs-alvo (qualificacoes, conversao, tempo resposta).
create table if not exists metrics_daily (
  date                  date primary key,
  leads_new             int not null default 0,
  qualifications        int not null default 0,
  conversions           int not null default 0,
  avg_response_minutes  numeric,
  content_pieces        int not null default 0,
  social_events         int not null default 0,
  computed_at           timestamptz not null default now()
);

-- --- CONSENT_LOG (LGPD) -----------------------------------------------------
create table if not exists consent_log (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid references leads(id) on delete set null,
  identifier  text not null,              -- telefone ou handle
  channel     text not null check (channel in ('whatsapp','instagram','facebook')),
  optin_at    timestamptz,
  optout_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists consent_log_identifier_idx on consent_log (identifier);

-- --- RLS: deny-by-default ----------------------------------------------------
-- O app acessa via service_role (bypassa RLS). Habilitamos RLS sem policies
-- para que as chaves anon/authenticated nao consigam ler nada por engano.
alter table leads             enable row level security;
alter table conversations     enable row level security;
alter table messages          enable row level security;
alter table social_events     enable row level security;
alter table demos             enable row level security;
alter table content_calendar  enable row level security;
alter table metrics_daily     enable row level security;
alter table consent_log       enable row level security;
