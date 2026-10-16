-- ===========================================================================
-- 0015_videos_tiktok — prateleira de videos prontos para publicar
-- ---------------------------------------------------------------------------
-- 16/10: combinado com a captacao -- eu gero o video com a legenda, ela baixa
-- no PC e publica no TikTok. Mandar link solto por WhatsApp funciona uma vez;
-- na terceira semana ninguem acha mais nada e nao se sabe o que ja foi ao ar.
-- Aqui fica a prateleira: o que existe, a legenda de cada um, e o que ela ja
-- publicou -- para eu nao gerar repetido nem ela postar duas vezes.
-- Aditiva.
-- ===========================================================================

create table if not exists videos_tiktok (
  id uuid primary key default gen_random_uuid(),
  arquivo text not null unique,       -- nome do mp4 no bucket content/videos/tiktok
  url text not null,
  titulo text not null,               -- modulo: "Consultorio por voz"
  gancho text not null,               -- a frase que aparece no alto do video
  legenda text not null,              -- texto pronto para colar na publicacao
  aula text,                          -- gravacao de origem, para refazer depois
  duracao_seg int,
  criado_em timestamptz not null default now(),
  publicado_em timestamptz            -- preenchido quando ela marca no painel
);

create index if not exists videos_tiktok_criado_idx on videos_tiktok (criado_em desc);
