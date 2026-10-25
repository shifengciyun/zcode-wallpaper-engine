# zcode-wallpaper-engine — apply the UI background patch to ZCode Desktop (v2, no Node needed).
# The patched app.asar is prebuilt in patch\prebuilt\. This script only backs up and copies files.
# ZCode must be closed while this runs; apply-ui-patch.bat handles that automatically.
[CmdletBinding()]
param(
  # Override for testing; default auto-detects the real installation.
  [string]$ResourcesDir = ""
)

$ErrorActionPreference = "Stop"

function Find-ZCodeResources {
  $proc = Get-Process -Name ZCode -ErrorAction SilentlyContinue | Select-Object -First 1
  $candidates = @()
  if ($proc -and $proc.Path) { $candidates += (Join-Path (Split-Path $proc.Path -Parent) "resources") }
  foreach ($c in $candidates) { if (Test-Path (Join-Path $c "app.asar")) { return $c } }
  throw "未找到 ZCode 的 resources 目录（没有 app.asar）。"
}

function Show-AndWait {
  param([string]$Message, [string]$Color = "White")
  Write-Host $Message -ForegroundColor $Color
}

try {
  $pluginRoot = Split-Path $PSScriptRoot -Parent
  $applyMjs = Join-Path $pluginRoot "patch	oolspply.mjs"
  if (-not (Test-Path $applyMjs)) { throw "apply.mjs not found at $applyMjs" }

  # live patch: build from THIS machine's own app.asar (version-matched, portable)
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) { throw "未找到 node。请安装 Node.js (https://nodejs.org) 后重试。" }
  Show-AndWait "正在从本机 app.asar 现场构建补丁（无需联网）..." "Gray"
  & $node $applyMjs $ResourcesDir
  if ($LASTEXITCODE -ne 0) { throw "apply.mjs 失败 (exit $LASTEXITCODE)" }

  # keep the auto-updater from wiping the patch (rename back to re-enable updates)
  try {
    $upd = Join-Path $ResourcesDir "app-update.yml"
    $updOff = Join-Path $ResourcesDir "app-update.yml.disabled-by-zwp"
    if ((Test-Path $upd) -and -not (Test-Path $updOff)) { Rename-Item $upd "app-update.yml.disabled-by-zwp" -Force }
  } catch {}

  Show-AndWait "" "White"
  Show-AndWait "✅ 补丁应用成功，校验通过。" "Green"
  if (Test-Path $wall) {
    Show-AndWait "界面壁纸已就绪: $wall" "Green"
  } else {
    Show-AndWait "注意: 还没有界面壁纸文件，启动后壁纸区域会是主题底色。装好插件后说一声即可生成。" "Yellow"
  }

  # local UI service (powers the in-app wallpaper panel): autostart at login + start now
  try {
    $startup = [Environment]::GetFolderPath("Startup")
    $svcBat = Join-Path $pluginRoot "scripts\start-ui-server.bat"
    if (Test-Path $svcBat) {
      Copy-Item $svcBat (Join-Path $startup "zcode-wallpaper-service.bat") -Force
      Show-AndWait "本地服务已设置开机自启（shell:startup）。" "Gray"
      Start-Process -FilePath $svcBat -WindowStyle Minimized
    }
  } catch { Show-AndWait ("本地服务自启设置失败（不影响壁纸显示）: " + $_.Exception.Message) "Yellow" }

  Show-AndWait "" "White"
  Show-AndWait "现在可以启动 ZCode 了。壁纸铺在界面背后；右下角 🖼 按钮打开壁纸面板（Ctrl+Alt+W），点击卡片立即应用。" "Green"
  Show-AndWait "换壁纸后若未即时刷新，按 Ctrl+Alt+R。撤销补丁: 运行 scripts\restore-ui.ps1" "Gray"
} catch {
  Show-AndWait "" "White"
  Show-AndWait ("❌ 打补丁失败: " + $_.Exception.Message) "Red"
  Show-AndWait "原版备份在 resources\app.asar.zwp-orig，随时可用 restore-ui.ps1 还原。" "Yellow"
  exit 1
}
