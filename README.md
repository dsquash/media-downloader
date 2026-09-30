# Media Downloader

A panel for **Adobe Premiere Pro** and **After Effects** that downloads video from
YouTube, TikTok, Instagram and ~1000 other sites straight into your project's
`assets` folder, imports it, and drops it on the timeline at the playhead.

Also on board: **Rough Cut** and **Normalize** for selected clips, **Sort project
into bins**, and **Paste screenshot from clipboard**.

---

## Rough Cut & Normalize (Premiere Pro)

Select one or more clips on the timeline — linked video and audio together — and:

**✂ Rough Cut selected clips** removes the silences.

| Setting | |
|---|---|
| Threshold | quieter than this counts as silence. Raise it (e.g. `-25`) for noisy rooms |
| Min silence | pauses shorter than this are kept |
| Pad | kept on both sides of every cut, so words aren't clipped |
| Close gaps | slides the rest of the edit left; off leaves the gaps in place |
| Normalize first | applies Normalize (below) before cutting, so every piece gets the same volume |
| Punch-in | zooms in on every second piece after cutting (see below) |

- With several clips stacked — two mics, a multicam — a moment is only cut when it
  is silent **in all of them**, so nobody gets cut off mid-sentence.
- Silent sections that overlap *unselected* clips on the same tracks are skipped,
  never cut through.
- The original sequence is kept as **"<name> Copy"** in the project before anything
  is changed.

**🔊 Normalize selected clips** measures each clip's loudness (EBU R128, only the part
used on the timeline) and sets its **Volume → Level** to reach the target — `-16 LUFS`
by default, `-14` for louder social/YouTube delivery. Gain is held back so true peak
stays under −1 dB. Nothing is rendered and the source files are untouched; it's just
the clip's volume, adjustable afterwards like any other.

**🔍 Punch-in selected clips** scales every second clip up (110 % by default), so jump
cuts alternate wide / close instead of looking like skips. The zoom is relative to the
wide clip before it, so footage scaled to fit (e.g. 4K at 50 % on a 1080 timeline) goes
50 → 55 %, and running it twice doesn't zoom any further. Clips with keyframed Scale
are left alone. Works on clips you cut yourself too, not only after Rough Cut.

**🎥 Dynamic Zoom selected clips** animates a slow push-in or pull-out across each
clip, like DaVinci Resolve's Dynamic Zoom: two Scale keyframes, on the first and last
frame. Choose *Zoom in*, *Zoom out* or *Alternate* (in, out, in… in playback order —
good on jump cuts), how far it travels (115 % by default, relative to the clip's
current scale) and whether it eases in and out. Running it again replaces the
previous animation rather than zooming further.

**💥 SFX at cuts between selected clips** puts a sound on every cut — every point where
one selected clip ends and the next begins, such as the joins Rough Cut leaves. Pick
the sound once with **Choose sound…** (any wav / mp3 / aif on your computer; it's
remembered on that machine) and whether it's centred on the cut, starts at it or ends
at it. Each sound lands on the first audio track that is free at that moment, so it
never covers dialogue or music, and nothing on the timeline moves. If no track is
free, add an empty audio track and run it again. The sound is imported once into an
**SFX** bin.

Rough Cut and Normalize read the audio straight from the source files with ffmpeg — no
transcript and no render needed. Clips must be online (file on disk).

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
