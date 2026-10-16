-- Aplicado em 2026-10-15 no Supabase do agente comercial (uapbujizgmpgnjartrvn).
-- Suporte ao envio de e-mail direto do painel pela equipe comercial e à
-- prospecção internacional (EUA, Portugal, Emirados).

-- 1) Pais do lead. Antes so havia city/uf, o que nao acomodava o exterior.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'BR';
CREATE INDEX IF NOT EXISTS leads_country_idx ON leads(country);
COMMENT ON COLUMN leads.country IS 'ISO-3166 alpha-2 (BR, US, PT, AE). Default BR para as linhas existentes.';

-- 2) source 'manual' = clinica cadastrada a mao pela equipe no painel, em
-- oposicao a 'places' (descoberta automatica). A worklist filtra por esses dois.
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_check;
ALTER TABLE leads ADD CONSTRAINT leads_source_check CHECK (source = ANY (ARRAY[
  'whatsapp','instagram','facebook','site','indicacao','places','outro','cadastro_free','manual']));

-- 3) Recados que a equipe manda pelo painel para o Diretor. Nao sao conteudo,
-- entao nao cabiam em content_calendar (que exige platform de rede social).
CREATE TABLE IF NOT EXISTS team_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autor       text NOT NULL,
  titulo      text,
  texto       text NOT NULL,
  obs         text,
  entregue    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_notes_created_idx ON team_notes(created_at DESC);
COMMENT ON TABLE team_notes IS 'Recados da equipe comercial ao Diretor, enviados pela aba "Enviar material" do painel.';

-- 4) Metricas que o painel nao consegue medir sozinho (Facebook, Instagram):
-- quantas publicacoes a equipe fez e qual alcance deu. Entram no relatorio
-- mensal ao lado dos envios, para comparar canais na hora de decidir onde
-- investir. Um registro por canal/dia.
CREATE TABLE IF NOT EXISTS social_metrics (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canal        text NOT NULL CHECK (canal IN ('facebook_pagina','facebook_grupos','instagram','outro')),
  dia          date NOT NULL,
  publicacoes  integer NOT NULL DEFAULT 0 CHECK (publicacoes >= 0),
  alcance      integer CHECK (alcance IS NULL OR alcance >= 0),
  obs          text,
  autor        text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (canal, dia)
);
CREATE INDEX IF NOT EXISTS social_metrics_dia_idx ON social_metrics(dia DESC);
COMMENT ON TABLE social_metrics IS 'Publicacoes e alcance de redes sociais, lancados a mao pela equipe no painel.';
