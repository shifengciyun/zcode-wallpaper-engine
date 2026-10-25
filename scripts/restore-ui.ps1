# zcode-wallpaper-engine — restore the original ZCode app.asar (undo patch-ui.ps1).
[CmdletBinding()]
param(
  [string]$ResourcesDir = ""
)

$ErrorActionPreference = "Stop"

function Find-ZCodeResources {
  $proc = Get-Process -Name ZCode -ErrorAction SilentlyContinue | Select-Object -First 1
  $candidates = @()
  if ($proc -and $proc.Path) { $candidates += (Join-Path (Split-Path $proc.Path -Parent) "resources") }
  foreach ($c in $candidates) { if (Test-Path (Join-Path $c "app.asar")) { return $c } }
  throw "ZCode resources directory not found."
}

try {
  $running = @(Get-Process -Name ZCode -ErrorAction SilentlyContinue)
  if ($running.Count -gt 0) {
    Write-Host "ZCode is running. Close ZCode completely, then run this script again." -ForegroundColor Yellow
    exit 1
  }
  if ($ResourcesDir -eq "") { $ResourcesDir = Find-ZCodeResources }
  $backup = Join-Path $ResourcesDir "app.asar.zwp-orig"
  $backupUnpacked = Join-Path $ResourcesDir "app.asar.unpacked.zwp-orig"
  if (-not (Test-Path $backup)) { throw "no backup found at $backup - nothing to restore (was the patch applied?)" }

  Copy-Item $backup (Join-Path $ResourcesDir "app.asar") -Force
  if (Test-Path $backupUnpacked) {
    Remove-Item (Join-Path $ResourcesDir "app.asar.unpacked") -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item $backupUnpacked (Join-Path $ResourcesDir "app.asar.unpacked") -Recurse -Force
  }
  Write-Host "Original app.asar restored. Start ZCode to confirm, then you may delete:" -ForegroundColor Green
  Write-Host "  $backup"
  if (Test-Path $backupUnpacked) { Write-Host "  $backupUnpacked" }
} catch {
  Write-Host ("restore-ui failed: " + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
