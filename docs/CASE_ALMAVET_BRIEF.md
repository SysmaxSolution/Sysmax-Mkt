# Case Almavet — roteiro do vídeo de prova social (2 min)

> **Por que este é o item nº 1** (veredito llm-council 2026-07-01): a Almavet não é "1 cliente", é um case de ROI com clínica real. Prova social local supera qualquer copy de bot — é o combustível dos posts diários E o gancho dos e-mails frios ("veja como uma clínica igual à sua fechou o prontuário falando"). É a única arma com que ganhamos da AllEars no preço dela.

## Objetivo
Vídeo curto (~90–120s) com a Dra. Lais (Almavet) usando o SYSVETMAX no dia a dia, focado no **momento mágico**: prontuário por voz. Sem jargão, sem tela de slides — clínica real, MV real.

## Estrutura (cenas)
1. **Gancho (0–8s):** Lais em frente à câmera na clínica: "Eu atendo sozinha. O que mais me tomava tempo era o prontuário."
2. **Momento mágico (8–45s):** captura de tela/celular: ela **fala** a consulta e a IA **escreve** o prontuário estruturado na frente do espectador. Mostrar o texto aparecendo.
3. **Resultado/ROI (45–80s):** 1 frase de número real: "Economizo cerca de X minutos por consulta / saio no horário / não levo prontuário pra casa." (coletar o número real com a Lais).
4. **Amplitude (80–105s):** cortes rápidos: WhatsApp com tutor, caixa/PDV, agenda. "E não é só a voz — é recepção, financeiro, WhatsApp, tudo junto."
5. **CTA (105–120s):** "Se você também atende sozinho, vale testar. 30 dias grátis, sem cartão." + selo Sysmax.

## Direção
- Terminologia CFMV: Tutor, Pet, Médico Veterinário/MV. Nada de "paciente/dono/médico".
- Tom real e humano; áudio da própria Lais é preferível a locução TTS.
- Formatos de saída: `9x16` (reels/stories), `1x1` (feed), `16x9` (YouTube/site).

## Montagem (pipeline existente)
- Footage da Lais + captura de tela real do produto.
- Assemblagem via Remotion em `C:\SysMax\marketing\video` (comps já existentes servem de molde — ver `src/CatReels.tsx`/`PillarAds.tsx`). Telas reais capturáveis via `tests/e2e/_marketing-capture.spec.ts` (`MARKETING_CAPTURE=1`).
- Ritmo padrão dos ads: rate -2%, pad 0,2–0,25s (ver memória de marketing).

## Dependência
- **Requer gravação com a Lais** (footage + o número de ROI). Enquanto não houver o footage, os posts do pilar `prova` no cron de conteúdo devem usar depoimento em texto/still, não vídeo.

## Uso
- Post fixado/destaque no Instagram + criativo recorrente do pilar `prova`.
- Anexo/gancho nos e-mails frios (link para o vídeo, não anexo pesado).
