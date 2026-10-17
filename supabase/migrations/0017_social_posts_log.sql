-- ===========================================================================
-- social_posts_log — registro do que a Jéssica publica manualmente nas redes
-- (Instagram, TikTok, Facebook etc.), fora do pipeline de IA. Pedido dela
-- 17/10: "não sei como vai acontecer no painel, não vou enviar 2x a mesma
-- coisa, vou enviar aqui, vc atualiza lá".
-- ===========================================================================
create table if not exists social_posts_log (
  id uuid primary key default gen_random_uuid(),
  canal text not null,          -- instagram | tiktok | facebook | meta_ads
  titulo text,                  -- nome do arquivo/imagem que ela mandou
  legenda text,
  publicado_em timestamptz not null default now(),
  registrado_em timestamptz not null default now()
);

create index if not exists social_posts_log_publicado_idx on social_posts_log (publicado_em desc);
