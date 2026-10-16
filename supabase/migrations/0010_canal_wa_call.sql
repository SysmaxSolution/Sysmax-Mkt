-- ===========================================================================
-- 0010_canal_wa_call — ligacao de WhatsApp como canal proprio
-- ---------------------------------------------------------------------------
-- Pedido da captacao em 16/10: ligacao pelo WhatsApp e gratis e e um caminho
-- que ela quer testar, mas nao pode se misturar com o contato ESCRITO no
-- relatorio -- sao duas taxas de resposta diferentes, e muita clinica avisa no
-- perfil que nao atende ligacao. Canal separado para medir cada um.
-- Aditiva: so amplia o check do outbox.
-- ===========================================================================

alter table outbox drop constraint if exists outbox_channel_check;
alter table outbox add constraint outbox_channel_check
  check (channel in ('email','whatsapp','call','ig_dm','wa_call'));
