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

step "[3/5] Installing yt-dlp…"
if curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos" -o "$DEST/bin/yt-dlp"; then
  chmod +x "$DEST/bin/yt-dlp"
  xattr -dr com.apple.quarantine "$DEST/bin/yt-dlp" 2>/dev/null
  ok "      done"
else
  die "      ! yt-dlp download failed — the extension cannot work without it."
fi

# yt-dlp needs BOTH: ffmpeg to convert, ffprobe to inspect what it downloaded.
step "[4/5] Installing ffmpeg + ffprobe…"
for tool in ffmpeg ffprobe; do
  if curl -fsSL "https://evermeet.cx/ffmpeg/getrelease/$tool/zip" -o "$TMP/$tool.zip" \
     && unzip -oq "$TMP/$tool.zip" -d "$DEST/bin/" 2>/dev/null; then
    chmod +x "$DEST/bin/$tool"
    xattr -dr com.apple.quarantine "$DEST/bin/$tool" 2>/dev/null
    ok "      $tool ok"
  elif sys="$(command -v "$tool")" && [ -n "$sys" ]; then
    cp "$sys" "$DEST/bin/$tool" && ok "      $tool copied from $sys"
  else
    warn "      ! $tool unavailable — install it with:  brew install ffmpeg"
  fi
done

# yt-dlp runs YouTube's obfuscated JS through deno; without it some formats vanish.
step "[5/5] Installing deno…"
if [ "$(uname -m)" = "arm64" ]; then
  DENO_ZIP="deno-aarch64-apple-darwin.zip"
else
  DENO_ZIP="deno-x86_64-apple-darwin.zip"
fi
if curl -fsSL "https://github.com/denoland/deno/releases/latest/download/$DENO_ZIP" -o "$TMP/deno.zip" \
   && unzip -oq "$TMP/deno.zip" -d "$DEST/bin/" 2>/dev/null; then
  chmod +x "$DEST/bin/deno"
  xattr -dr com.apple.quarantine "$DEST/bin/deno" 2>/dev/null
  ok "      done"
else
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
