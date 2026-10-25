# parse-check all shipped ps1 scripts
$ErrorActionPreference = "Stop"
$files = @("patch-ui.ps1", "restore-ui.ps1", "wallpaper.ps1")
foreach ($f in $files) {
  $path = Join-Path $PSScriptRoot $f
  [System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw $path), [ref]$null) | Out-Null
  Write-Host "$f OK"
}
