# Media Downloader

A panel for **Adobe Premiere Pro** and **After Effects** that downloads video from
YouTube, TikTok, Instagram and ~1000 other sites straight into your project's
`assets` folder, imports it, and drops it on the timeline at the playhead.

Also on board: **Rough Cut** (removes silence from a selected clip), **Sort project
into bins**, and **Paste screenshot from clipboard**.

---

## Install

Copy one line, paste it, press Enter. Everything else is automatic.

**macOS** — open **Terminal**:

```bash
curl -fsSL https://raw.githubusercontent.com/dsquash/media-downloader/main/install.sh | bash
```

**Windows** — open **PowerShell**:

```powershell
irm https://raw.githubusercontent.com/dsquash/media-downloader/main/install.ps1 | iex
```

Then **restart Premiere Pro / After Effects** and open:

> **Window → Extensions → Media Downloader**

The same command re-runs safely — use it to reinstall or repair.

### What the installer does

| | |
|---|---|
| Allows unsigned extensions | Adobe blocks them by default (`PlayerDebugMode`) |
| Installs the panel | `…/Adobe/CEP/extensions/com.mariangrosu.ytdownloader` |
| Installs `yt-dlp` | does the downloading |
| Installs `ffmpeg` + `ffprobe` | converts and inspects the files |
| Installs `deno` | runs YouTube's obfuscated JS, needed for the best formats |

All four tools land **inside the extension's own `bin/` folder**, not on your system
PATH. That is deliberate: Premiere inherits the PATH it was launched with, so a tool
installed afterwards stays invisible to it until you restart the machine.

---

## Updates

The panel checks this repository every time it opens. If `version.json` here is
newer than the local copy, it downloads the new files and reloads itself — nothing
to click, nothing to reinstall.

Only the panel's own files update this way. To refresh `yt-dlp` / `ffmpeg` / `deno`,
re-run the install command above.

---

## Videos that ask for a login

Some videos (age-restricted YouTube, most Instagram posts, some TikToks) only play
for a signed-in session. The panel handles this on its own: if a download is
refused, it retries with a different player client, then with cookies from
`cookies.txt`, then with cookies from every browser installed on the machine.

For that last step to work, **be logged into the site in that browser**.

**On macOS, Safari cookies need one extra permission:** macOS blocks other apps from
reading them until you allow it in
**System Settings → Privacy & Security → Full Disk Access** → add **Premiere Pro**,
then restart it. Or just log into the site in Chrome instead.

You can also drop a `cookies.txt` (exported with the *Get cookies.txt LOCALLY*
browser extension) into the extension folder — it takes priority over browsers.

---

## Requirements

- Premiere Pro 14.0+ or After Effects 16.0+
- macOS or Windows
- The project must be **saved** — downloads go next to the project file

---

## Releasing a new version

1. Edit the files
2. Bump `version` in `version.json`
3. Bump the matching `?v=` on both `<script>` tags in `index.html`
4. Commit and push to `main`

Every panel picks it up the next time it opens.

---

Reach out to Marian Grosu for any problem.
