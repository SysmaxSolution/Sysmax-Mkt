-- ===========================================================================
-- 0006_material_fotos — foto anexada ao material enviado pelo painel
-- ---------------------------------------------------------------------------
-- A aba "Enviar material" passou a aceitar foto (pedido da captacao em
-- 2026-10-16). Para post, os caminhos vao no JSON de content_calendar.brief;
-- para recado, precisam de coluna propria aqui.
-- Aditiva e idempotente.
-- ===========================================================================

create table if not exists team_notes (
  id uuid primary key default gen_random_uuid(),
  autor text,
  titulo text,
  texto text,
  obs text,
  entregue boolean default false,
  created_at timestamptz default now()
);

alter table team_notes add column if not exists fotos text[];
