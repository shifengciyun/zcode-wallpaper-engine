# zcode-wallpaper-engine - Windows desktop wallpaper manager
# Subcommands: list | current | set | random | bing | live
# All output is a single JSON object on stdout. Requires Windows PowerShell 5.1+ (no admin).
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Command = "list",
  [string]$Path = "",
  [string]$WorkshopId = "",
  [string]$Type = "",
  [string]$MaxRating = "",
  [ValidateSet("cover", "fit", "stretch", "original")][string]$Style = "cover",
  [int]$Thumbs = 24,
  [int]$ThumbWidth = 480,
  [ValidateRange(0, 100)][int]$Scrim = 45,
  [switch]$Uhd,
  [switch]$Dry,
  [switch]$Live
)

$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$Script:CacheDir = Join-Path $env:TEMP "zcode-wallpaper-engine"
if (-not (Test-Path $Script:CacheDir)) { New-Item -ItemType Directory -Path $Script:CacheDir -Force | Out-Null }

function Out-Json([object]$Obj) {
  $Obj | ConvertTo-Json -Depth 6 -Compress
}

function New-Result([bool]$Ok, [string]$Cmd, [hashtable]$Extra) {
  $r = @{ ok = $Ok; command = $Cmd }
  if ($Extra) { foreach ($k in $Extra.Keys) { $r[$k] = $Extra[$k] } }
  [pscustomobject]$r
}

function Get-SteamRoots {
  $roots = New-Object System.Collections.Generic.List[string]
  $main = ""
  try {
    $main = (Get-ItemProperty "HKCU:\Software\Valve\Steam" -ErrorAction Stop).SteamPath
  } catch {
    $main = "C:\Program Files (x86)\Steam"
  }
  if ($main) { $roots.Add(($main -replace "/", "\")) }
  $vdf = Join-Path $roots[0] "steamapps\libraryfolders.vdf"
  if (Test-Path $vdf) {
    $text = Get-Content $vdf -Raw -Encoding UTF8
    foreach ($m in [regex]::Matches($text, '"path"\s+"([^"]+)"')) {
      $p = ($m.Groups[1].Value -replace "\\\\", "\")
      if (-not $roots.Contains($p)) { $roots.Add($p) }
    }
  }
  ,$roots
}

function Test-ImageKind([string]$File) {
  switch ([System.IO.Path]::GetExtension($File).ToLower()) {
    ".jpg"  { "jpg" }
    ".jpeg" { "jpg" }
    ".png"  { "png" }
    ".gif"  { "gif" }
    ".bmp"  { "bmp" }
    ".webp" { "webp" }
    default { "" }
  }
}

function Get-WallpaperSources {
  # workshop content dirs across all Steam libraries + WE local imports
  $dirs = New-Object System.Collections.Generic.List[string]
  foreach ($root in (Get-SteamRoots)) {
    $dirs.Add((Join-Path $root "steamapps\workshop\content\431960"))
  }
  $docs = [Environment]::GetFolderPath("MyDocuments")
  foreach ($local in @(
    (Join-Path $docs "Wallpaper Engine\projects"),
    (Join-Path $docs "My projects\Wallpaper Engine\projects")
  )) {
    if (Test-Path $local) { $dirs.Add($local) }
  }
  ,$dirs
}

function Get-WorkshopItems {
  $items = @()
  $zips = 0
  foreach ($dir in (Get-WallpaperSources)) {
    if (-not (Test-Path $dir)) { continue }
    foreach ($entry in (Get-ChildItem $dir -ErrorAction SilentlyContinue)) {
      if ($entry.PSIsContainer) {
        $pj = Join-Path $entry.FullName "project.json"
        if (-not (Test-Path $pj)) { continue }
        $meta = $null
        $parseError = ""
        try {
          $raw = Get-Content $pj -Raw -Encoding UTF8
          $meta = $raw | ConvertFrom-Json
        } catch { $parseError = $_.Exception.Message }
        $title = $entry.Name
        $type = "unknown"
        $file = ""
        $previewFile = ""
        $tags = @()
        $rating = "unrated"
        if ($meta) {
          if ($meta.title) { $title = [string]$meta.title }
          if ($meta.type) { $type = ([string]$meta.type).ToLower() }
          if ($meta.file) { $file = [string]$meta.file }
          if ($meta.preview) { $previewFile = [string]$meta.preview }
          if ($meta.tags) { $tags = @($meta.tags | ForEach-Object { [string]$_ }) }
          if ($meta.contentrating) { $rating = ([string]$meta.contentrating).ToLower() }
        }
        $previewPath = ""
        $previewKind = "none"
        if ($previewFile -and (Test-Path (Join-Path $entry.FullName $previewFile))) {
          $previewPath = Join-Path $entry.FullName $previewFile
          $previewKind = Test-ImageKind $previewPath
        } else {
          foreach ($cand in @("preview.jpg", "preview.png", "preview.gif", "wallpaper.jpg", "wallpaper.png")) {
            $c = Join-Path $entry.FullName $cand
            if (Test-Path $c) { $previewPath = $c; $previewKind = Test-ImageKind $c; break }
          }
        }
        if ($previewKind -eq "none" -and $previewPath) { $previewKind = "unsupported" }
        $items += [pscustomobject]@{
          id            = $entry.Name
          dir           = $entry.FullName
          title         = $title
          type          = $type
          file          = $file
          previewPath   = $previewPath
          previewKind   = $previewKind
          tags          = $tags
          contentrating = $rating
          parseError    = $parseError
        }
      } elseif ($entry.Extension -eq ".zip") {
        $zips++
      }
    }
  }
  @{ items = $items; zips = $zips }
}

function Get-RatingRank([string]$Rating) {
  switch ($Rating) {
    "everyone" { 0 }
    "mature"   { 1 }
    default    { 2 }
  }
}

function Convert-GifToPng([string]$GifPath, [string]$ItemId) {
  $out = Join-Path $Script:CacheDir ("we-" + $ItemId + ".png")
  if (Test-Path $out) { return $out }
  Add-Type -AssemblyName System.Drawing
  $img = [System.Drawing.Image]::FromFile($GifPath)
  try {
    $fd = New-Object System.Drawing.Imaging.FrameDimension $img.FrameDimensionsList[0]
    if ($img.GetFrameCount($fd) -gt 0) { $img.SelectActiveFrame($fd, 0) | Out-Null }
    $bmp = New-Object System.Drawing.Bitmap $img.Width, $img.Height
    try {
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      try {
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.DrawImage($img, 0, 0, $img.Width, $img.Height)
      } finally { $g.Dispose() }
      $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $bmp.Dispose() }
  } finally { $img.Dispose() }
  $out
}

function Get-PrimaryResolution {
  try {
    $vc = Get-CimInstance Win32_VideoController -ErrorAction Stop |
      Where-Object { $_.CurrentHorizontalResolution } |
      Sort-Object { [int]$_.CurrentHorizontalResolution * [int]$_.CurrentVerticalResolution } -Descending |
      Select-Object -First 1
    if ($vc) { return @{ W = [int]$vc.CurrentHorizontalResolution; H = [int]$vc.CurrentVerticalResolution } }
  } catch {}
  try {
    Add-Type -AssemblyName System.Windows.Forms
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    return @{ W = $b.Width; H = $b.Height }
  } catch {}
  return $null
}

function Convert-ComposeImage([string]$Src, [string]$Style, [int]$W, [int]$H) {
  Add-Type -AssemblyName System.Drawing
  $out = Join-Path $Script:CacheDir ("composed-" + ($Style) + "-" + [System.IO.Path]::GetFileNameWithoutExtension($Src) + "-" + $W + "x" + $H + ".jpg")
  $img = [System.Drawing.Image]::FromFile($Src)
  try {
    $bmp = New-Object System.Drawing.Bitmap $W, $H
    try {
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      try {
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.Clear([System.Drawing.Color]::Black)
        $iw = $img.Width; $ih = $img.Height
        if ($iw -lt 1 -or $ih -lt 1) { throw "source image has no size" }
        if ($Style -eq "stretch") {
          $g.DrawImage($img, 0, 0, $W, $H)
        } else {
          if ($Style -eq "fit") { $scale = [Math]::Min($W / $iw, $H / $ih) }
          else { $scale = [Math]::Max($W / $iw, $H / $ih) }
          $dw = $iw * $scale; $dh = $ih * $scale
          $g.DrawImage($img, [float](($W - $dw) / 2), [float](($H - $dh) / 2), [float]$dw, [float]$dh)
        }
      } finally { $g.Dispose() }
      $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
        Where-Object { $_.MimeType -eq "image/jpeg" } | Select-Object -First 1
      $eps = New-Object System.Drawing.Imaging.EncoderParameters 1
      $eps.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter -ArgumentList @([System.Drawing.Imaging.Encoder]::Quality, [long]92)
      try {
        $bmp.Save($out, $codec, $eps)
      } finally { $eps.Dispose() }
    } finally { $bmp.Dispose() }
  } finally { $img.Dispose() }
  $out
}

function Set-DesktopWallpaper([string]$ImagePath, [string]$Style) {
  Add-Type -AssemblyName System.Drawing
  $final = $ImagePath
  if ($Style -ne "original") {
    $res = Get-PrimaryResolution
    if ($res) { $final = Convert-ComposeImage $ImagePath $Style $res.W $res.H }
  }
  if (-not ("Win32.Wallpaper" -as [type])) {
    Add-Type -Namespace Win32 -Name Wallpaper -MemberDefinition @'
[DllImport("user32.dll", SetLastError = true)]
public static extern bool SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
'@
  }
  $ok = [Win32.Wallpaper]::SystemParametersInfo(20, 0, $final, 3)
  if (-not $ok) {
    $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw "SystemParametersInfo(SPI_SETDESKWALLPAPER) failed with Win32 error $err"
  }
  try {
    Set-ItemProperty "HKCU:\Control Panel\Desktop" -Name WallpaperStyle -Value "10" -Type String
    Set-ItemProperty "HKCU:\Control Panel\Desktop" -Name TileWallpaper -Value "0" -Type String
  } catch {}
  $final
}

function Resolve-ItemStaticImage([object]$Item) {
  if ($Item.previewKind -eq "jpg" -or $Item.previewKind -eq "png" -or $Item.previewKind -eq "bmp") {
    return $Item.previewPath
  }
  if ($Item.previewKind -eq "gif") { return (Convert-GifToPng $Item.previewPath $Item.id) }
  if ($Item.previewKind -eq "webp") { throw "item $($Item.id): webp preview cannot be used as a wallpaper without a converter" }
  throw "item $($Item.id): no usable preview image found"
}

function Convert-BlurPadDraw($g, $img, [int]$W, [int]$H, [int]$ScrimAlpha) {
  # backdrop: cover-crop the source into a tiny bitmap, then upscale = smooth blur fill
  $bw = 24
  $bh = [Math]::Max(8, [int]([Math]::Round(24 * $H / $W)))
  $tiny = New-Object System.Drawing.Bitmap $bw, $bh
  try {
    $tg = [System.Drawing.Graphics]::FromImage($tiny)
    try {
      $tg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $tg.Clear([System.Drawing.Color]::Black)
      $iw = $img.Width; $ih = $img.Height
      $bs = [Math]::Max($bw / $iw, $bh / $ih)
      $tg.DrawImage($img, [float](($bw - $iw * $bs) / 2), [float](($bh - $ih * $bs) / 2), [float]($iw * $bs), [float]($ih * $bs))
    } finally { $tg.Dispose() }
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($tiny, 0, 0, $W, $H)
  } finally { $tiny.Dispose() }
  if ($ScrimAlpha -gt 0) {
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($ScrimAlpha, 0, 0, 0))
    try { $g.FillRectangle($brush, 0, 0, $W, $H) } finally { $brush.Dispose() }
  }
  # foreground: fit-contain, full image visible, centered
  $iw = $img.Width; $ih = $img.Height
  $scale = [Math]::Min($W / $iw, $H / $ih)
  $dw = $iw * $scale; $dh = $ih * $scale
  $g.DrawImage($img, [float](($W - $dw) / 2), [float](($H - $dh) / 2), [float]$dw, [float]$dh)
}

function Save-Jpeg($bmp, [string]$Path, [int]$Quality) {
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
    Where-Object { $_.MimeType -eq "image/jpeg" } | Select-Object -First 1
  $eps = New-Object System.Drawing.Imaging.EncoderParameters 1
  $eps.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter -ArgumentList @([System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)
  try { $bmp.Save($Path, $codec, $eps) } finally { $eps.Dispose() }
}

function Convert-MakeThumb([string]$Src, [string]$ThumbPath, [int]$W) {
  Add-Type -AssemblyName System.Drawing
  $h = [int]([Math]::Round($W * 10 / 16))
  if (Test-Path $ThumbPath) { return $ThumbPath }
  $img = [System.Drawing.Image]::FromFile($Src)
  try {
    $bmp = New-Object System.Drawing.Bitmap $W, $h
    try {
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      try {
        Convert-BlurPadDraw $g $img $W $h 0
      } finally { $g.Dispose() }
      Save-Jpeg $bmp $ThumbPath 82
    } finally { $bmp.Dispose() }
  } finally { $img.Dispose() }
  $ThumbPath
}

function Get-WeMainExe {
  foreach ($root in (Get-SteamRoots)) {
    $we = Join-Path $root "steamapps\common\wallpaper_engine"
    foreach ($p in @((Join-Path $we "wallpaper64.exe"), (Join-Path $we "wallpaper32.exe"), (Join-Path $we "bin\wallpaper64.exe"), (Join-Path $we "bin\wallpaper32.exe"))) {
      if (Test-Path $p) { return $p }
    }
  }
  return ""
}

function Test-WeRunning {
  return ,@(Get-Process -Name wallpaper32, wallpaper64, webwallpaper64 -ErrorAction SilentlyContinue | ForEach-Object { $_.ProcessName })
}

function Invoke-LiveWallpaper([object]$Item) {
  $exe = Get-WeMainExe
  if (-not $exe) {
    throw "Wallpaper Engine main exe (wallpaper64/32.exe) not found in this install, so live control is unavailable. Use the static preview instead: wallpaper.ps1 set -WorkshopId $($Item.id)"
  }
  $running = Test-WeRunning
  $pj = Join-Path $Item.dir "project.json"
  if ($running.Count -gt 0) {
    Start-Process -FilePath $exe -ArgumentList @("-control", "openWallpaper", "-file", "`"$pj`"")
    @{ live = $true; exe = $exe; weProcesses = $running }
  } else {
    Start-Process -FilePath $exe -ArgumentList @("-control", "openWallpaper", "-file", "`"$pj`"")
    @{ live = $true; exe = $exe; weProcesses = @(); note = "WE was not running; main exe was launched with -control openWallpaper" }
  }
}

function Convert-UiWallpaper([string]$Src, [int]$ScrimAlpha) {
  Add-Type -AssemblyName System.Drawing
  $dir = Join-Path $env:USERPROFILE ".zcode\cli\wallpaper"
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $out = Join-Path $dir "current.jpg"
  $res = Get-PrimaryResolution
  if (-not $res) { $res = @{ W = 1920; H = 1080 } }
  $img = [System.Drawing.Image]::FromFile($Src)
  try {
    $bmp = New-Object System.Drawing.Bitmap $res.W, $res.H
    try {
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      try {
        Convert-BlurPadDraw $g $img $res.W $res.H $ScrimAlpha
      } finally { $g.Dispose() }
      Save-Jpeg $bmp $out 95
    } finally { $bmp.Dispose() }
  } finally { $img.Dispose() }
  $out
}

function Test-UiPatchApplied {
  $proc = Get-Process -Name ZCode -ErrorAction SilentlyContinue | Select-Object -First 1
  $candidates = @()
  if ($proc -and $proc.Path) { $candidates += (Join-Path (Split-Path $proc.Path -Parent) "resources") }
  foreach ($c in $candidates) { if (Test-Path (Join-Path $c "app.asar.zwp-orig")) { return $true } }
  return $false
}

function Get-CurrentWallpaper {
  $wall = ""
  try {
    $wall = [string](Get-ItemProperty "HKCU:\Control Panel\Desktop" -Name WallpaperPath -ErrorAction Stop).WallpaperPath
  } catch {}
  $transcoded = Join-Path $env:APPDATA "Microsoft\Windows\Themes\TranscodedWallpaper"
  [pscustomobject]@{
    wallpaperPath      = $wall
    transcodedExists   = (Test-Path $transcoded)
    transcodedWallpaper = $transcoded
    wallpaperStyle     = [string](Get-ItemProperty "HKCU:\Control Panel\Desktop" -ErrorAction SilentlyContinue).WallpaperStyle
    weProcesses        = Test-WeRunning
  }
}

# ---- main ----
try {
  switch ($Command) {
    "list" {
      $scan = Get-WorkshopItems
      $items = $scan.items
      if ($Type) { $items = @($items | Where-Object { $_.type -eq $Type.ToLower() }) }
      if ($MaxRating) {
        $max = Get-RatingRank $MaxRating.ToLower()
        $items = @($items | Where-Object { (Get-RatingRank $_.contentrating) -le $max })
      }
      Out-Json (New-Result $true "list" @{
        count         = $items.Count
        zipEntriesSkipped = $scan.zips
        items         = @($items)
      })
    }
    "thumbs" {
      $scan = Get-WorkshopItems
      $items = $scan.items
      if ($Type) { $items = @($items | Where-Object { $_.type -eq $Type.ToLower() }) }
      if ($MaxRating) {
        $max = Get-RatingRank $MaxRating.ToLower()
        $items = @($items | Where-Object { (Get-RatingRank $_.contentrating) -le $max })
      }
      $settable = @($items | Where-Object { $_.previewKind -ne "none" -and $_.previewKind -ne "unsupported" })
      if ($Thumbs -gt 0 -and $settable.Count -gt $Thumbs) { $settable = $settable[0..($Thumbs - 1)] }
      $thumbRows = @()
      foreach ($item in $settable) {
        try {
          $src = Resolve-ItemStaticImage $item
          $thumbDir = Join-Path $env:USERPROFILE ".zcode\cli\wallpaper\thumbs"
          if (-not (Test-Path $thumbDir)) { New-Item -ItemType Directory -Path $thumbDir -Force | Out-Null }
          $tp = Join-Path $thumbDir ("t" + $ThumbWidth + "-" + $item.id + ".jpg")
          Convert-MakeThumb $src $tp $ThumbWidth | Out-Null
          $thumbRows += [pscustomobject]@{ id = $item.id; title = $item.title; type = $item.type; contentrating = $item.contentrating; thumb = $tp }
        } catch {}
      }
      Out-Json (New-Result $true "thumbs" @{ count = $thumbRows.Count; thumbs = @($thumbRows) })
    }
    "current" {
      Out-Json (New-Result $true "current" @{ current = Get-CurrentWallpaper })
    }
    "set" {
      if (-not $Path -and -not $WorkshopId) { throw "provide -Path (any image file) or -WorkshopId (Wallpaper Engine workshop item id)" }
      $applied = ""
      $source = ""
      if ($WorkshopId) {
        $scan = Get-WorkshopItems
        $item = $scan.items | Where-Object { $_.id -eq $WorkshopId } | Select-Object -First 1
        if (-not $item) { throw "workshop item $WorkshopId not found" }
        if ($Live) {
          $liveResult = Invoke-LiveWallpaper $item
          Out-Json (New-Result $true "set" @{ applied = $null; live = $liveResult; item = $item })
          return
        }
        $source = Resolve-ItemStaticImage $item
      } else {
        if (-not (Test-Path $Path)) { throw "file not found: $Path" }
        $source = $Path
      }
      if ($Dry) {
        Out-Json (New-Result $true "set" @{ dryRun = $true; source = $source; style = $Style })
        return
      }
      $applied = Set-DesktopWallpaper $source $Style
      $weRun = @(Test-WeRunning).Count -gt 0
      Out-Json (New-Result $true "set" @{ applied = $applied; source = $source; style = $Style; weRunning = $weRun; weNote = $(if ($weRun) { "Wallpaper Engine is running and may cover the static wallpaper; exit WE or use -Live for a live wallpaper" } else { "" }) })
    }
    "random" {
      $scan = Get-WorkshopItems
      $items = $scan.items
      if ($Type) { $items = @($items | Where-Object { $_.type -eq $Type.ToLower() }) }
      if ($MaxRating) {
        $max = Get-RatingRank $MaxRating.ToLower()
        $items = @($items | Where-Object { (Get-RatingRank $_.contentrating) -le $max })
      }
      $settable = @($items | Where-Object { $_.previewKind -ne "none" -and $_.previewKind -ne "unsupported" })
      if ($settable.Count -lt 1) { throw "no settable wallpaper items match the given filters" }
      $pick = $settable | Get-Random
      if ($Dry) {
        Out-Json (New-Result $true "random" @{ dryRun = $true; picked = $pick })
        return
      }
      if ($Live) {
        $liveResult = Invoke-LiveWallpaper $pick
        Out-Json (New-Result $true "random" @{ picked = $pick; live = $liveResult })
        return
      }
      $source = Resolve-ItemStaticImage $pick
      $applied = Set-DesktopWallpaper $source $Style
      $weRun = @(Test-WeRunning).Count -gt 0
      Out-Json (New-Result $true "random" @{ applied = $applied; source = $source; style = $Style; picked = $pick; weRunning = $weRun; weNote = $(if ($weRun) { "Wallpaper Engine is running and may cover the static wallpaper; exit WE or use -Live for a live wallpaper" } else { "" }) })
    }
    "bing" {
      $mkt = "zh-CN"
      $api = "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=$mkt"
      $r = $null
      try { $r = Invoke-RestMethod -Uri $api -TimeoutSec 20 -UseBasicParsing }
      catch { $r = Invoke-RestMethod -Uri ("https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=$mkt") -TimeoutSec 20 -UseBasicParsing }
      if (-not $r -or -not $r.images -or $r.images.Count -lt 1) { throw "Bing API returned no image" }
      $img = $r.images[0]
      $url = [string]$img.url
      if ($Uhd) { $url = $url -replace "1920x1080", "UHD" }
      $full = "https://www.bing.com" + $url
      $out = Join-Path $Script:CacheDir ("bing-" + $img.startdate + $(if ($Uhd) { "-uhd" }) + ".jpg")
      Invoke-WebRequest -Uri $full -OutFile $out -TimeoutSec 90 -UseBasicParsing
      if (-not (Test-Path $out)) { throw "download failed: $full" }
      if ($Dry) {
        Out-Json (New-Result $true "bing" @{ dryRun = $true; downloaded = $out; copyright = [string]$img.copyright })
        return
      }
      $applied = Set-DesktopWallpaper $out "cover"
      Out-Json (New-Result $true "bing" @{ applied = $applied; downloaded = $out; copyright = [string]$img.copyright })
    }
    "ui" {
      if (-not $Path -and -not $WorkshopId) { throw "provide -Path (any image file) or -WorkshopId (Wallpaper Engine workshop item id)" }
      $uiSource = ""
      $uiItem = $null
      if ($WorkshopId) {
        $scan = Get-WorkshopItems
        $item = $scan.items | Where-Object { $_.id -eq $WorkshopId } | Select-Object -First 1
        if (-not $item) { throw "workshop item $WorkshopId not found" }
        $uiItem = $item
        $uiSource = Resolve-ItemStaticImage $item
      } else {
        if (-not (Test-Path $Path)) { throw "file not found: $Path" }
        $uiSource = $Path
      }
      if ($Dry) {
        Out-Json (New-Result $true "ui" @{ dryRun = $true; source = $uiSource; scrim = $Scrim })
        return
      }
      $uiOut = Convert-UiWallpaper $uiSource $Scrim
      $patched = Test-UiPatchApplied
      Out-Json (New-Result $true "ui" @{
        uiWallpaper = $uiOut; scrim = $Scrim; patchApplied = $patched
        item = $(if ($uiItem) { $uiItem } else { $null })
        nextStep = $(if ($patched) { "press Ctrl+Alt+R in ZCode (or restart it) to show the new wallpaper" } else { "UI patch not applied yet - run scripts\patch-ui.ps1 (ZCode must be closed), then start ZCode" })
      })
    }
    "live" {
      if (-not $WorkshopId) { throw "provide -WorkshopId for live control" }
      $scan = Get-WorkshopItems
      $item = $scan.items | Where-Object { $_.id -eq $WorkshopId } | Select-Object -First 1
      if (-not $item) { throw "workshop item $WorkshopId not found" }
      $liveResult = Invoke-LiveWallpaper $item
      Out-Json (New-Result $true "live" @{ live = $liveResult; item = $item })
    }
    default {
      throw "unknown command '$Command'. Valid: list | thumbs | current | set | random | bing | ui | live"
    }
  }
} catch {
  $at = ""
  try { $at = [string]$_.InvocationInfo.PositionMessage } catch {}
  Out-Json (New-Result $false $Command @{ error = $_.Exception.Message; at = $at })
}
