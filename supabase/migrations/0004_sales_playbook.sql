-- ===========================================================================
-- 0004_sales_playbook — aprendizado contínuo do agente comercial
-- ---------------------------------------------------------------------------
-- O cron /api/cron/prompt-learning estuda as conversas reais de WhatsApp
-- (bot + consultor humano + clientes) e os resultados do outbox (enviado vs
-- pulado/rejeitado) e destila DIRETRIZES em texto. A versão mais recente é
-- injetada nos prompts geradores (worklist-build, lead-followups) e no
-- system prompt do sales-agent. Histórico preservado (append-only).
-- Migrations aditivas e idempotentes (padrão do projeto).
-- ===========================================================================

create table if not exists sales_playbook (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null default 'global'
                check (scope in ('global','whatsapp','email','call','ig_dm')),
  insights    text not null,             -- diretrizes destiladas (bullets pt-BR)
  sample      jsonb,                     -- contagens do material estudado
  created_at  timestamptz not null default now()
);

create index if not exists sales_playbook_scope_idx
  on sales_playbook (scope, created_at desc);

alter table sales_playbook enable row level security;
