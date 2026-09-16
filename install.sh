#!/usr/bin/env bash
# Media Downloader for Premiere Pro & After Effects — installer (macOS)
#
#   curl -fsSL https://raw.githubusercontent.com/dsquash/media-downloader/main/install.sh | bash
#
set -uo pipefail

REPO="dsquash/media-downloader"
BRANCH="main"
EXT_ID="com.mariangrosu.ytdownloader"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/$EXT_ID"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

step() { printf '\033[36m%s\033[0m\n' "$*"; }
ok()   { printf '\033[32m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
die()  { printf '\033[31m%s\033[0m\n' "$*"; exit 1; }

echo
step "=== Media Downloader — installer (macOS) ==="
echo

step "[1/5] Allowing unsigned extensions…"
for v in 9 10 11 12 13; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1 2>/dev/null
done
killall cfprefsd 2>/dev/null
ok "      done"

step "[2/5] Downloading the extension…"
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" -o "$TMP/src.tgz" \
  || die "      ! Could not reach GitHub. Check your internet connection."
mkdir -p "$TMP/src"
tar -xzf "$TMP/src.tgz" -C "$TMP/src" --strip-components=1 || die "      ! Corrupt download."
mkdir -p "$DEST/bin"
# --delete keeps the install clean, but bin/ and cookies.txt are ours, not the repo's
rsync -a --delete \
  --exclude 'bin/' --exclude 'cookies.txt' --exclude '.git*' \
  --exclude 'install.sh' --exclude 'install.ps1' --exclude 'README.md' \
  "$TMP/src/" "$DEST/" || die "      ! Could not write to $DEST"
ok "      installed to $DEST"

# Everything below lands in the extension's own bin/ rather than relying on PATH:
# Premiere inherits the PATH it was launched with, so a tool installed afterwards
# is invisible to it until a reboot. Self-contained avoids that entirely.

# A binary that exists but won't run is worse than a missing one — yt-dlp reports
# only "ffmpeg is not installed" and you go looking in the wrong place entirely.
# That is exactly what evermeet.cx's x86_64-only builds did on Apple Silicon, so
# every tool below is run once before it is accepted.
runs() { [ -x "$1" ] && "$1" "${2:--version}" >/dev/null 2>&1; }

place() {           # place <url> <dest> [version-flag] — download, unquarantine, verify
  local url="$1" dest="$2" flag="${3:--version}"
  curl -fsSL "$url" -o "$dest.tmp" || { rm -f "$dest.tmp"; return 1; }
  chmod +x "$dest.tmp"
  xattr -dr com.apple.quarantine "$dest.tmp" 2>/dev/null
  runs "$dest.tmp" "$flag" || { rm -f "$dest.tmp"; return 1; }
  mv -f "$dest.tmp" "$dest"
}

if [ "$(uname -m)" = "arm64" ]; then ARCH_TAG="arm64"; else ARCH_TAG="x64"; fi

step "[3/5] Installing yt-dlp…"
if place "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos" "$DEST/bin/yt-dlp"; then
  ok "      done"
else
  die "      ! yt-dlp could not be installed — the extension cannot work without it."
fi

# yt-dlp needs BOTH: ffmpeg to convert, ffprobe to inspect what it downloaded.
step "[4/5] Installing ffmpeg + ffprobe…"
for tool in ffmpeg ffprobe; do
  dest="$DEST/bin/$tool"
  if place "https://github.com/eugeneware/ffmpeg-static/releases/latest/download/$tool-darwin-$ARCH_TAG" "$dest" "-version"; then
    ok "      $tool ok"
  elif sys="$(command -v "$tool" 2>/dev/null)" && [ -n "$sys" ] \
       && cp "$sys" "$dest" 2>/dev/null && runs "$dest" "-version"; then
    ok "      $tool ok — copied from $sys"
  else
    rm -f "$dest"
    warn "      ! $tool could not be installed — run:  brew install ffmpeg"
  fi
done

# yt-dlp runs YouTube's obfuscated JS through deno; without it some formats vanish.
step "[5/5] Installing deno…"
if [ "$ARCH_TAG" = "arm64" ]; then
  DENO_ZIP="deno-aarch64-apple-darwin.zip"
else
  DENO_ZIP="deno-x86_64-apple-darwin.zip"
fi
if curl -fsSL "https://github.com/denoland/deno/releases/latest/download/$DENO_ZIP" -o "$TMP/deno.zip" \
   && unzip -oq "$TMP/deno.zip" -d "$TMP" 2>/dev/null \
   && chmod +x "$TMP/deno" \
   && { xattr -dr com.apple.quarantine "$TMP/deno" 2>/dev/null; runs "$TMP/deno"; }; then
  mv -f "$TMP/deno" "$DEST/bin/deno"
  ok "      done"
else
  rm -f "$DEST/bin/deno"
  warn "      ! deno unavailable — downloads still work, but some formats may be missing."
fi

echo
ok "=== Installed! ==="
echo "Restart Premiere Pro / After Effects, then:  Window → Extensions → Media Downloader"
echo
echo "Tip: for videos that need a login, log into the site in Chrome or Safari first."
echo "     For Safari cookies, also give Premiere Pro Full Disk Access in"
echo "     System Settings → Privacy & Security → Full Disk Access."
echo
