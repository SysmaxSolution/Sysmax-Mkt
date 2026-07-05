-- ===========================================================================
-- 0002_outbound_esteira — Esteira comercial semi-autônoma (topo de funil)
-- ---------------------------------------------------------------------------
-- Adiciona: descoberta de prospects (Places), fila de disparo COM aprovação
-- humana (outbox), opt-out global (suppression) e ampliações de checks para
-- suportar canal e-mail e origem 'places'.
-- Veredito llm-council 2026-07-01: automatizar topo + prova social; humano
-- aprova todo disparo e fecha as demos. Ver plano da sprint.
-- Migrations aditivas e idempotentes (padrão do projeto).
-- ===========================================================================

-- --- LEADS: campos de prospecção fria -------------------------------------
alter table leads add column if not exists website           text;
alter table leads add column if not exists uf                text;   -- SP, RS, PR, MG, RJ
alter table leads add column if not exists city              text;
alter table leads add column if not exists place_id          text;   -- Google Places id (dedup)
alter table leads add column if not exists legal_basis       text;   -- base LGPD do tratamento
alter table leads add column if not exists discovered_at     timestamptz;
alter table leads add column if not exists enrichment_status text
                    default 'pending';  -- pending | enriched | no_email | failed

create unique index if not exists leads_place_id_key on leads (place_id) where place_id is not null;
create index if not exists leads_uf_idx on leads (uf) where uf is not null;
create index if not exists leads_enrichment_idx on leads (enrichment_status);

-- Ampliar origem para incluir prospecção via Google Places.
alter table leads drop constraint if exists leads_source_check;
alter table leads add constraint leads_source_check
  check (source in ('whatsapp','instagram','facebook','site','indicacao','places','outro'));

-- --- CONSENT_LOG: incluir canal e-mail ------------------------------------
alter table consent_log drop constraint if exists consent_log_channel_check;
alter table consent_log add constraint consent_log_channel_check
  check (channel in ('whatsapp','instagram','facebook','email'));

-- --- OUTBOX: fila de disparo com aprovação humana --------------------------
-- Nada sai daqui sem passar por status='approved' via /admin/outbox.
create table if not exists outbox (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null references leads(id) on delete cascade,
  channel        text not null check (channel in ('email','whatsapp')),
  subject        text,                    -- assunto (e-mail); null p/ whatsapp
  body           text not null,           -- corpo gerado (editável na aprovação)
  status         text not null default 'draft'
                   check (status in ('draft','approved','rejected','sent','failed')),
  scheduled_for  timestamptz,             -- quando pode sair (respeitando warm-up)
  approved_by    text,
  approved_at    timestamptz,
  sent_at        timestamptz,
  provider_msg_id text,                   -- id no provedor (Resend/Evolution)
  error          text,
  created_at     timestamptz not null default now()
);
create index if not exists outbox_status_idx   on outbox (status);
create index if not exists outbox_lead_idx      on outbox (lead_id);
create index if not exists outbox_sched_idx     on outbox (scheduled_for);
-- Evita 2 disparos abertos no mesmo canal para o mesmo lead.
create unique index if not exists outbox_open_per_lead_channel
  on outbox (lead_id, channel) where status in ('draft','approved');

-- --- SUPPRESSION: opt-out global (LGPD) ------------------------------------
-- Qualquer identificador aqui NUNCA mais entra no builder de outbound.
create table if not exists suppression (
  id          uuid primary key default gen_random_uuid(),
  identifier  text not null,              -- e-mail (lower) ou telefone E.164
  channel     text not null check (channel in ('email','whatsapp','all')),
  reason      text,                       -- unsubscribe | bounce | reclamacao | manual
  created_at  timestamptz not null default now()
);
create unique index if not exists suppression_identifier_channel_key
  on suppression (identifier, channel);

-- --- CONTENT_CALENDAR: fluxo de aprovação ----------------------------------
alter table content_calendar drop constraint if exists content_calendar_status_check;
alter table content_calendar add constraint content_calendar_status_check
  check (status in ('planned','generated','pending_approval','approved','published','failed'));
alter table content_calendar add column if not exists approved_at timestamptz;

-- --- METRICS_DAILY: funil de outbound + placar kill/scale ------------------
alter table metrics_daily add column if not exists prospects_discovered int not null default 0;
alter table metrics_daily add column if not exists emails_sent          int not null default 0;
alter table metrics_daily add column if not exists emails_replied       int not null default 0;
alter table metrics_daily add column if not exists demos_scheduled      int not null default 0;
alter table metrics_daily add column if not exists paying_full_price    int not null default 0;

-- --- RLS: deny-by-default nas tabelas novas --------------------------------
alter table outbox      enable row level security;
alter table suppression enable row level security;
