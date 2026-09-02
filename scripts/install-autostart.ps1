$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$starter = Join-Path $PSScriptRoot "start-camelbot.cmd"
$taskName = "CamelBot"

if (-not (Test-Path $starter)) {
  throw "Missing $starter"
}

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$starter`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = "PT45S"
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -DontStopOnIdleEnd `
  -RestartCount 5 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -StartWhenAvailable

try {
  icacls $root /grant "SYSTEM:(OI)(CI)M" /T /C | Out-Null
  $principal = New-ScheduledTaskPrincipal -UserId "NT AUTHORITY\SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Write-Host "CamelBot starts when this PC boots. Nobody has to log in."
} catch {
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Write-Host "CamelBot starts at boot after this Windows user is available."
  Write-Host "For true no-login start, run this script as Administrator."
}

Write-Host "Dashboard on this network: http://192.168.1.37:3000"
Write-Host "Do not port-forward 3000 on the modem. That page has no password."
Write-Host "Logs: $root\data\camelbot.log"
