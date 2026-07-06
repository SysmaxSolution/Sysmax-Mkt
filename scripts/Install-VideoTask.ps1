# ============================================================================
# Install-VideoTask.ps1 — registra a tarefa agendada que renderiza os vídeos
# do dia (roteiros -> MP4 -> Supabase Storage -> painel). Roda LOCALMENTE, todo
# dia às 09:05 (depois do daily-am da Vercel gerar os roteiros às ~08:00 BRT).
#
# Uso (PowerShell normal, do usuário — NÃO precisa admin):
#   powershell -ExecutionPolicy Bypass -File scripts\Install-VideoTask.ps1
# Para remover:
#   Unregister-ScheduledTask -TaskName "SysmaxRenderVideos" -Confirm:$false
# ============================================================================

$ErrorActionPreference = "Stop"
$AgentDir = Split-Path -Parent $PSScriptRoot          # ...\Marketing\agent
$Script   = Join-Path $AgentDir "scripts\render-daily-videos.mjs"
$TaskName = "SysmaxRenderVideos"

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "node não encontrado no PATH. Instale o Node ou ajuste o PATH." }
if (-not (Test-Path $Script)) { throw "Script não encontrado: $Script" }

$action  = New-ScheduledTaskAction -Execute $node -Argument "`"$Script`"" -WorkingDirectory $AgentDir
$trigger = New-ScheduledTaskTrigger -Daily -At 9:05am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description "Renderiza os vídeos diários do painel comercial SYSVETMAX (roteiro -> MP4 -> Storage)." | Out-Null

Write-Host "OK — tarefa '$TaskName' registrada (diária 09:05)." -ForegroundColor Green
Write-Host "Testar agora:  Start-ScheduledTask -TaskName $TaskName" -ForegroundColor Cyan
Write-Host "Ou manual:     node `"$Script`"" -ForegroundColor Cyan
