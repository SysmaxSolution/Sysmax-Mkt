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
