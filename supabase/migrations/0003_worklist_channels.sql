-- ===========================================================================
-- 0003_worklist_channels — canais humanos (worklist) no outbox
-- ---------------------------------------------------------------------------
-- Piloto mostrou que ~83% das clínicas não publicam e-mail (só telefone/IG).
-- Para essas, o bot NÃO dispara nada: prepara um roteiro que o fundador executa
-- na mão (ligação/DM manual). Reusamos o outbox com dois canais humanos que o
-- worker de envio IGNORA — eles aparecem na worklist do /admin.
-- Fluxo: draft (a fazer) -> sent (feito) | rejected (pulado).
-- ===========================================================================

alter table outbox drop constraint if exists outbox_channel_check;
alter table outbox add constraint outbox_channel_check
  check (channel in ('email','whatsapp','call','ig_dm'));
