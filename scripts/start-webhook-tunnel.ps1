$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$exeCandidates = @(
  "C:\Program Files (x86)\cloudflared\cloudflared.exe",
  "C:\Program Files\cloudflared\cloudflared.exe"
)
$exe = $exeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $exe) { throw "cloudflared is not installed. winget install Cloudflare.cloudflared" }

$data = Join-Path $root "data"
New-Item -ItemType Directory -Force -Path $data | Out-Null
$urlFile = Join-Path $data "tunnel-url.txt"
$logFile = Join-Path $data "tunnel.log"

Write-Host "Webhook formula: Kick -> Cloudflare -> http://127.0.0.1:3000/webhooks/kick"
Write-Host "Leave this running. Dashboard stays private; only /webhooks/kick is public."
Write-Host ""

# cloudflared logs to stderr. Windows PowerShell treats that as a terminating error
# when ErrorActionPreference is Stop, so run it through cmd and keep Continue.
$ErrorActionPreference = "Continue"
cmd.exe /c "`"$exe`" tunnel --url http://127.0.0.1:3000 2>&1" | ForEach-Object {
  $line = "$_"
  if ($_ -is [System.Management.Automation.ErrorRecord]) { $line = $_.ToString() }
  Add-Content -Path $logFile -Value $line
  Write-Host $line
  $m = [regex]::Match($line, "https://[a-z0-9-]+\.trycloudflare\.com")
  if ($m.Success) {
    Set-Content -Path $urlFile -Value $m.Value -Encoding ascii
    Write-Host ""
    Write-Host "Kick webhook URL:"
    Write-Host "$($m.Value)/webhooks/kick"
    Write-Host ""
  }
}
