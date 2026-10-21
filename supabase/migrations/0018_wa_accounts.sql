-- ===========================================================================
-- 0018_wa_accounts — WhatsApp multi-instancia dentro do painel
-- ---------------------------------------------------------------------------
-- Cada analista (Jessica e quem vier depois) passa a ter sua PROPRIA instancia
-- Evolution, pareada por QR code dentro do painel. Toda mensagem enviada e
-- recebida fica registrada aqui (nao depende de ninguem "marcar que fez") e
-- vinculada ao lead pelo telefone, dando historico cronologico por conversa.
-- Aditiva.
-- ===========================================================================

create table if not exists wa_accounts (
  id uuid primary key default gen_random_uuid(),
  analyst_name text not null,
  evolution_instance_id text not null unique,
  phone_e164 text,
  status text not null default 'pending' check (status in ('pending', 'connected', 'disconnected')),
  created_at timestamptz not null default now(),
  connected_at timestamptz
);

create table if not exists wa_conversations (
  id uuid primary key default gen_random_uuid(),
  wa_account_id uuid not null references wa_accounts(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  contact_phone text not null,
  contact_name text,
  last_message_at timestamptz,
  ai_suggestion text,
  needs_director_review boolean not null default false,
  created_at timestamptz not null default now(),
  unique (wa_account_id, contact_phone)
);

create table if not exists wa_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references wa_conversations(id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  body text not null,
  sent_at timestamptz not null default now(),
  raw_payload jsonb
);

create index if not exists wa_conversations_account_idx on wa_conversations (wa_account_id);
create index if not exists wa_conversations_lead_idx on wa_conversations (lead_id) where lead_id is not null;
create index if not exists wa_conversations_review_idx on wa_conversations (needs_director_review) where needs_director_review;
create index if not exists wa_messages_conversation_idx on wa_messages (conversation_id, sent_at);
