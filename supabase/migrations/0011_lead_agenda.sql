-- ===========================================================================
-- 0011_lead_agenda — retorno e reuniao marcados no cartao do prospecto
-- ---------------------------------------------------------------------------
-- Pedido da captacao em 16/10: "crie + 2 botoes: retorno (data + hora) e
-- reuniao (data + hora); tem como deixar esse contato em destaque?".
-- Sem isso o compromisso vive na cabeca dela ou num caderno, e o painel nao
-- consegue avisar nada.
-- Aditiva.
-- ===========================================================================

alter table leads add column if not exists retorno_em timestamptz;
alter table leads add column if not exists reuniao_em timestamptz;

create index if not exists leads_retorno_em_idx on leads (retorno_em) where retorno_em is not null;
create index if not exists leads_reuniao_em_idx on leads (reuniao_em) where reuniao_em is not null;
