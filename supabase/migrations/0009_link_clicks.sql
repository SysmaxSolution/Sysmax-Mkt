-- ===========================================================================
-- 0009_link_clicks — cliques nos links que a equipe divulga
-- ---------------------------------------------------------------------------
-- Pergunta da captacao em 16/10: "nao sei como ter essa resposta se alguem
-- clicou no site". O site e estatico e nao tem nenhuma medicao. Para o anuncio
-- o Gerenciador de Anuncios ja responde; para post organico e grupo, nao ha
-- quem responda. Um link proprio por campanha resolve.
--
-- Uma linha por clique: volume e baixo e evita corrida de incremento.
-- Sem dado pessoal: campanha, dia e horario. Nada de IP ou identificacao.
-- ===========================================================================

create table if not exists link_clicks (
  id uuid primary key default gen_random_uuid(),
  campanha text not null,
  destino text,
  dia date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now()
);

create index if not exists link_clicks_campanha_dia_idx on link_clicks (campanha, dia);
