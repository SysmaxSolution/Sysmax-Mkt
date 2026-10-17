-- ===========================================================================
-- support_reports — canal de erro/problema DENTRO do painel, para quem não
-- fala comigo pelo WhatsApp (os funcionários; só a Jéssica tem esse canal).
-- Pedido dela em 17/10: "resolver colocando um caminho onde o funcionário
-- pode se comunicar com vc se der erro em alguma coisa de envio ou qualquer
-- outra coisa dentro do painel".
-- ===========================================================================
create table if not exists support_reports (
  id uuid primary key default gen_random_uuid(),
  autor text,                 -- nome de quem relatou, se informado
  pagina text,                -- aba do painel onde aconteceu
  mensagem text not null,
  resolvido boolean not null default false,
  criado_em timestamptz not null default now()
);

create index if not exists support_reports_resolvido_idx on support_reports (resolvido, criado_em desc);
