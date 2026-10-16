-- ===========================================================================
-- 0014_import_runs — recibo de cada tentativa de importacao
-- ---------------------------------------------------------------------------
-- 16/10: ela colou a carteira do Keep, perguntou "deu certo?" e nao havia como
-- responder: o banco nao tinha nenhuma clinica nova e nenhum rastro do que
-- aconteceu no caminho. Sem recibo, a resposta honesta era "nao sei".
-- Agora toda tentativa (previa e gravacao) deixa linha aqui: quantos caracteres
-- colados, quantos blocos entendidos, quantos gravados, pulados e o erro, se
-- houve. Sem o texto colado -- so o tamanho e uma amostra curta do inicio,
-- para diagnosticar formato sem guardar a carteira dela no banco.
-- Aditiva.
-- ===========================================================================

create table if not exists import_runs (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  etapa text not null,                -- 'previa' | 'gravacao'
  chars int,
  blocos int,
  criados int,
  pulados int,
  rascunhos int,
  erro text,
  amostra text,
  com_telefone int,
  com_email int,
  com_ficha int
);

create index if not exists import_runs_at_idx on import_runs (at desc);
