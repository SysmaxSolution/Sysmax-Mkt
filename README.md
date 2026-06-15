# Sysmax Sales Agent

Agente autônomo de **marketing e comercial B2B** da **Sysmax Software** — funil de vendas do
**Sysvetmax** (sistema de gestão veterinária) para clínicas.

> **Isolamento total:** este app tem banco, número de WhatsApp e deploy **próprios**, separados do
> produto VetMax. Não compartilha schema, `clinic_id` nem credenciais com o sistema das clínicas.
> Reaproveita apenas *infraestrutura* (Evolution API, cliente Claude, pipeline de criativos em `marketing/`).

## Stack

Next.js 16 (somente rotas de API — webhooks + crons) · TypeScript · Supabase (projeto exclusivo Sysmax) ·
Anthropic Claude · Evolution API (WhatsApp) · Meta Graph API (Instagram/Facebook).

## Estrutura

```
marketing/agent/
├── src/app/api/
│   ├── webhooks/whatsapp   # inbound da instância comercial Evolution (Fase 1)
│   ├── webhooks/meta       # IG/FB: verify GET pronto; POST na Fase 2
│   └── cron/{social-poll,content-pipeline,lead-followups,metrics-rollup}
├── src/lib/                # supabase, evolution, anthropic, meta-graph, brand, cron-auth
├── src/agents/             # sales-agent (F1), social-agent (F2), content-agent (F3)
├── src/crm/                # leads/funil (F1), followups (F4)
├── supabase/migrations/    # 0001_init_sales_crm.sql
└── scripts/apply-migrations.mjs
```

## Roadmap (sub-fases)

- **Fase 0 — Provisionamento (atual):** scaffold + Supabase Sysmax + instância Evolution comercial + app Meta.
- **Fase 1:** agente comercial WhatsApp B2B + CRM (não depende da Meta).
- **Fase 2:** social listening (Meta webhooks) + auto-resposta.
- **Fase 3:** pipeline de conteúdo (5 peças/semana).
- **Fase 4:** analytics/KPIs + follow-ups multi-touch + anti-churn.

---

## Fase 0 — Provisionamento do Supabase exclusivo da Sysmax

> Objetivo: um projeto Supabase **novo**, sem nenhum vínculo com o banco do VetMax.

1. **Criar o projeto** em https://supabase.com/dashboard → *New project*
   - Organization: a da Sysmax (ou crie uma).
   - Name: `sysmax-comercial` · Region: `South America (São Paulo)` · defina uma DB password forte.
2. **Coletar credenciais** (Project Settings):
   - *API* → `Project URL` → `SALES_SUPABASE_URL`
   - *API* → `service_role` secret → `SALES_SUPABASE_SERVICE_KEY` (server-only, nunca no client)
   - *Database* → *Connection string* → *URI* → `SALES_DATABASE_URL`
3. **Configurar o `.env`** deste diretório:
   ```bash
   cp marketing/agent/.env.example marketing/agent/.env
   # preencha SALES_SUPABASE_URL, SALES_SUPABASE_SERVICE_KEY, SALES_DATABASE_URL
   ```
4. **Instalar deps e aplicar a migration:**
   ```bash
   cd marketing/agent
   npm install
   npm run db:migrate    # cria schema_migrations e aplica 0001_init_sales_crm.sql
   ```
   Saída esperada: `+ aplicando: 0001_init_sales_crm.sql` → `OK — 1 migration(s) nova(s) aplicada(s)`.
   Alternativa manual: copiar o conteúdo de `supabase/migrations/0001_init_sales_crm.sql` no *SQL Editor* do dashboard.
5. **Conferir** no dashboard (*Table editor*): tabelas `leads`, `conversations`, `messages`,
   `social_events`, `demos`, `content_calendar`, `metrics_daily`, `consent_log` com RLS habilitado.

### Itens de provisionamento em paralelo (não bloqueiam o código)

- **Instância Evolution comercial:** criar `sysmax-comercial` na VPS `wpp.sysmaxsolutions.com` e parear
  o número `(16) 99702-3340`; apontar o webhook para `…/api/webhooks/whatsapp`.
- **App Meta + App Review:** criar app na Meta, vincular conta IG Profissional à Página do Facebook e
  solicitar `instagram_basic`, `instagram_manage_comments`, `pages_messaging`, `pages_manage_metadata`.
  (Tramita ~1–2 semanas; a Fase 1 segue sem isso.)

### Verificação local

```bash
cd marketing/agent && npm run dev   # porta 4100
# GET de verificação da Meta (deve devolver o challenge):
# curl "http://localhost:4100/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=<META_VERIFY_TOKEN>&hub.challenge=123"
```
