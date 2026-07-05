# Runbook — Esteira Comercial Semi-Autônoma

Topo de funil automatizado **com aprovação humana**. Veredito llm-council 2026-07-01: automatizar descoberta + primeiro toque + posts; **o fundador aprova todo disparo e fecha as demos**. Meta do piloto: **3 clínicas novas pagando preço cheio em 60 dias**.

## Arquitetura (fluxo)
```
discover-prospects.mjs (Places)  →  leads (source=places, enrichment_status)
        │
cron lead-followups (builder)    →  outbox (status=draft)   [gera e-mail, NÃO envia]
        │
/admin/outbox (fundador aprova)  →  outbox (status=approved)
        │
cron outbox-send (worker)        →  envia respeitando warm-up  →  outbox (status=sent)
        │
/api/unsubscribe                 →  suppression + lead.opted_out   [opt-out em todo e-mail]

cron content-pipeline (diário)   →  content_calendar (pending_approval)  [copy do post do dia]
cron metrics-rollup (diário)     →  metrics_daily + digest ao fundador + placar kill/scale
```

## Variáveis de ambiente (Vercel do projeto sysmax-sales-agent)
Já existentes: `SALES_SUPABASE_URL`, `SALES_SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY`, `EVOLUTION_*`, `CRON_SECRET`, `ADMIN_TOKEN`.

**Novas a configurar:**
| Var | Para quê |
|---|---|
| `GOOGLE_PLACES_API_KEY` | descoberta de clínicas (Places API New — habilitar no Google Cloud) |
| `RESEND_API_KEY` | envio de e-mail frio |
| `MAIL_FROM` | remetente no **subdomínio dedicado**, ex: `Sysmax Software <contato@mkt.sysmaxsolutions.com>` |
| `MAIL_REPLY_TO` | inbox real do fundador (respostas caem no Gmail) |
| `APP_BASE_URL` | base pública p/ link de unsubscribe, ex: `https://sysmax-sales-agent.vercel.app` |
| `UNSUBSCRIBE_SECRET` | segredo p/ assinar o link (se ausente, usa `ADMIN_TOKEN`) |
| `WARMUP_START_DATE` | data ISO de início do aquecimento (rampa 20→40/dia) |
| `FOUNDER_WHATSAPP_PHONE` | número do fundador p/ receber o digest diário (E.164) |
| `DIGEST_EMAIL` | e-mail p/ receber o digest diário (fallback: `MAIL_REPLY_TO`) |
| `REVIEW_WHATSAPP_PHONE` | número PESSOAL do fundador (diferente do bot) p/ o preview diário da fila; a aprovação segue no painel |
| `KILLSCALE_START_DATE` | início da janela de 60 dias do placar |

Opcionais (têm default): `OUTBOX_BUILD_CAP=30`, `WARMUP_MIN=20`, `WARMUP_MAX=40`, `WARMUP_STEP=5`, `WA_DAILY_CAP=15`, `OUTBOX_SEND_BATCH=25`, `WA_MIN_SEND_INTERVAL_MS=1500`, `KILLSCALE_GOAL=3`, `KILLSCALE_DAYS=60`.

## Setup externo (bloqueadores — precisa do fundador)
1. **Subdomínio de e-mail (proteção do domínio):** criar `mkt.sysmaxsolutions.com`, verificar no Resend e publicar **SPF, DKIM e DMARC** no DNS. NÃO enviar cold do domínio raiz.
2. **Google Cloud:** habilitar *Places API (New)*, gerar `GOOGLE_PLACES_API_KEY` (restringir por API).
3. **Vercel Cron:** os horários (várias vezes/dia, seg-sex) exigem plano **Pro**. No Hobby, reduzir para 1x/dia por cron.
4. **Aquecimento:** definir `WARMUP_START_DATE` e começar com volume baixo; monitorar spam/bounces.

## Operação diária
1. Manhã: `lead-followups` gera rascunhos no `outbox`.
2. Fundador abre **`/admin/outbox`**, cola o `ADMIN_TOKEN`, revisa, edita e **aprova** (individual ou "aprovar todos").
3. `outbox-send` envia os aprovados ao longo do dia respeitando o cap de aquecimento.
4. **Respostas caem no Gmail** (`MAIL_REPLY_TO`) — o fundador responde e conduz a demo **na mão** (guardrail do council).
5. Posts: `content-pipeline` deixa a copy do dia em `content_calendar` (pending_approval); publicação manual (Meta API bloqueada por App Review).
6. Digest diário chega no WhatsApp do fundador com o placar kill/scale.

## Rodar a descoberta (piloto)
```bash
cd C:/SysMax/Marketing/agent
node scripts/discover-prospects.mjs "Ribeirão Preto" SP --limit=40
```

## Guardrails (não violar)
- 1 canal frio = e-mail (subdomínio aquecido). WhatsApp só **warm** + aprovação. **Sem** automação de DM Instagram/Facebook.
- Todo disparo passa pelo `/admin/outbox`. Todo e-mail leva unsubscribe. `suppression` é revalidada no envio.
- O fundador fecha as demos até ~10-20 clientes.
