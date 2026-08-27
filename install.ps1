# Media Downloader for Premiere Pro & After Effects — installer (Windows)
#
#   irm https://raw.githubusercontent.com/dsquash/media-downloader/main/install.ps1 | iex
#
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo   = 'dsquash/media-downloader'
$Branch = 'main'
$ExtId  = 'com.mariangrosu.ytdownloader'
$Dest   = Join-Path $env:APPDATA "Adobe\CEP\extensions\$ExtId"
$Tmp    = Join-Path $env:TEMP ("md_install_" + [guid]::NewGuid().ToString('N').Substring(0,8))

function Step($m) { Write-Host $m -ForegroundColor Cyan }
function Ok($m)   { Write-Host $m -ForegroundColor Green }
function Warn($m) { Write-Host $m -ForegroundColor Yellow }
function Die($m)  { Write-Host $m -ForegroundColor Red; exit 1 }

Write-Host ''
Step '=== Media Downloader - installer (Windows) ==='
Write-Host ''

New-Item -ItemType Directory -Force -Path $Tmp | Out-Null
try {

Step '[1/5] Allowing unsigned extensions...'
foreach ($v in 9,10,11,12,13) {
    $key = "HKCU:\Software\Adobe\CSXS.$v"
    if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
    Set-ItemProperty -Path $key -Name PlayerDebugMode -Value '1' -Type String
}
Ok '      done'

Step '[2/5] Downloading the extension...'
$srcZip = Join-Path $Tmp 'src.zip'
try {
    Invoke-WebRequest -UseBasicParsing -Uri "https://codeload.github.com/$Repo/zip/refs/heads/$Branch" -OutFile $srcZip
} catch {
    Die '      ! Could not reach GitHub. Check your internet connection.'
}
Expand-Archive -Path $srcZip -DestinationPath $Tmp -Force
$src = Get-ChildItem $Tmp -Directory | Where-Object { $_.Name -like 'media-downloader-*' } | Select-Object -First 1
if (-not $src) { Die '      ! Corrupt download.' }

New-Item -ItemType Directory -Force -Path (Join-Path $Dest 'bin') | Out-Null
# /MIR would mirror the repo exactly and wipe bin\ - exclude it, the binaries are ours
robocopy $src.FullName $Dest /E /XF install.ps1 install.sh README.md /XD bin .git | Out-Null
if ($LASTEXITCODE -ge 8) { Die "      ! Could not write to $Dest" }
Ok "      installed to $Dest"

# Everything below lands in the extension's own bin\ rather than relying on PATH:
# Premiere inherits the PATH it was launched with, so a tool installed afterwards
# is invisible to it until the app is restarted. Self-contained avoids that entirely.

Step '[3/5] Installing yt-dlp...'
try {
    Invoke-WebRequest -UseBasicParsing `
        -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' `
        -OutFile (Join-Path $Dest 'bin\yt-dlp.exe')
    Ok '      done'
} catch {
    Die '      ! yt-dlp download failed - the extension cannot work without it.'
}

# yt-dlp needs BOTH: ffmpeg to convert, ffprobe to inspect what it downloaded.
Step '[4/5] Installing ffmpeg + ffprobe (~80 MB, this takes a minute)...'
try {
    $ffZip = Join-Path $Tmp 'ffmpeg.zip'
    Invoke-WebRequest -UseBasicParsing `
        -Uri 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile $ffZip
    Expand-Archive -Path $ffZip -DestinationPath (Join-Path $Tmp 'ff') -Force
    foreach ($tool in 'ffmpeg.exe','ffprobe.exe') {
        $exe = Get-ChildItem (Join-Path $Tmp 'ff') -Recurse -Filter $tool | Select-Object -First 1
        if ($exe) {
            Copy-Item $exe.FullName (Join-Path $Dest "bin\$tool") -Force
            Ok "      $tool ok"
        } else {
            Warn "      ! $tool missing from the archive"
        }
    }
} catch {
    Warn '      ! ffmpeg download failed - try again, or run:  winget install Gyan.FFmpeg'
}

# yt-dlp runs YouTube's obfuscated JS through deno; without it some formats vanish.
Step '[5/5] Installing deno...'
try {
    $denoZip = Join-Path $Tmp 'deno.zip'
    $denoAsset = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
        'deno-aarch64-pc-windows-msvc.zip'
    } else {
        'deno-x86_64-pc-windows-msvc.zip'
    }
    Invoke-WebRequest -UseBasicParsing `
        -Uri "https://github.com/denoland/deno/releases/latest/download/$denoAsset" -OutFile $denoZip
    Expand-Archive -Path $denoZip -DestinationPath (Join-Path $Dest 'bin') -Force
    Ok '      done'
} catch {
    Warn '      ! deno unavailable - downloads still work, but some formats may be missing.'
}

Write-Host ''
Ok '=== Installed! ==='
Write-Host 'Restart Premiere Pro / After Effects, then:  Window -> Extensions -> Media Downloader'
Write-Host ''
Write-Host 'Tip: for videos that need a login, log into the site in Chrome or Edge first.'
Write-Host ''

} finally {
    Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}
