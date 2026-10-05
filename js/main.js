/* Media Downloader for Premiere Pro & After Effects — Marian Grosu */

var nodeRequire = (typeof cep_node !== "undefined" && cep_node.require) ? cep_node.require : require;
var cp = nodeRequire("child_process");
var fs = nodeRequire("fs");
var path = nodeRequire("path");
var os = nodeRequire("os");
var nodeProcess = (typeof process !== "undefined") ? process : cep_node.process;

var cs = new CSInterface();
var extDir = cs.getSystemPath(SystemPath.EXTENSION);
var isWin = navigator.platform.indexOf("Win") !== -1;
var hostApp = (function () {
    try { return cs.getHostEnvironment().appName === "AEFT" ? "After Effects" : "Premiere"; }
    catch (e) { return "Premiere"; }
})();

var elUrl = document.getElementById("url");
var elModeVideo = document.getElementById("modeVideo");
var elModeAudio = document.getElementById("modeAudio");
var elSection = document.getElementById("chkSection");
var elTimeline = document.getElementById("chkTimeline");
var elTsInputs = document.getElementById("tsInputs");
var elTsStart = document.getElementById("tsStart");
var elTsEnd = document.getElementById("tsEnd");
var elBtn = document.getElementById("btnDownload");
var elCancel = document.getElementById("btnCancel");
var elSort = document.getElementById("btnSort");
var elPasteImg = document.getElementById("btnPasteImg");
var elRoughCut = document.getElementById("btnRoughCut");
var elRcThreshold = document.getElementById("rcThreshold");
var elRcMinDur = document.getElementById("rcMinDur");
var elPasteUrl = document.getElementById("btnPasteUrl");
var elProgressWrap = document.getElementById("progressWrap");
var elProgressBar = document.getElementById("progressBar");
var elStatus = document.getElementById("status");
var elLog = document.getElementById("log");
var elProjectInfo = document.getElementById("projectInfo");
var elCredits = document.getElementById("credits");
var elCreditText = document.getElementById("creditText");
var elCopyCredit = document.getElementById("btnCopyCredit");

var currentProc = null;
var safariBlocked = false;   // macOS denied access to Safari's cookie store

/* ---------- auto-update from GitHub ----------
   Checked once every time the panel opens: if version.json in the repo is newer
   than the local one, the listed files are fetched and the panel reloads itself.
   Downloads are collected in memory first and only written once every one of
   them succeeded — a half-applied update would leave a dead panel. */

var REPO_RAW = "https://raw.githubusercontent.com/dsquash/media-downloader/main";

function localVersion() {
    try {
        return JSON.parse(fs.readFileSync(path.join(extDir, "version.json"), "utf8")).version || "0.0.0";
    } catch (e) { return "0.0.0"; }
}

function isNewer(remote, local) {
    var a = String(remote).split("."), b = String(local).split(".");
    for (var i = 0; i < 3; i++) {
        var x = parseInt(a[i], 10) || 0, y = parseInt(b[i], 10) || 0;
        if (x !== y) return x > y;
    }
    return false;
}

function fetchText(url, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url + (url.indexOf("?") === -1 ? "?" : "&") + "t=" + Date.now(), true);
    xhr.timeout = 20000;
    xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        cb(xhr.status === 200 ? null : "HTTP " + xhr.status, xhr.responseText || "");
    };
    xhr.onerror = function () { cb("network error", ""); };
    xhr.ontimeout = function () { cb("timeout", ""); };
    xhr.send();
}

/* fs.mkdirSync's recursive option needs Node 10; CEP ships an older one */
function mkdirp(dir) {
    if (fs.existsSync(dir)) return;
    mkdirp(path.dirname(dir));
    try { fs.mkdirSync(dir); } catch (e) {}
}

function checkForUpdate() {
    // survives location.reload(), so an update can never loop
    try { if (sessionStorage.getItem("mdUpdated")) return; } catch (e) {}

    fetchText(REPO_RAW + "/version.json", function (err, body) {
        if (err) return; // offline is not an error worth showing
        var remote;
        try { remote = JSON.parse(body); } catch (e) { return; }
        if (!remote.version || !remote.files || !remote.files.length) return;
        if (!isNewer(remote.version, localVersion())) return;

        setStatus("Updating to v" + remote.version + "…");
        var pending = remote.files.length, failed = 0, blobs = {};

        remote.files.forEach(function (rel) {
            fetchText(REPO_RAW + "/" + rel, function (e2, text) {
                if (e2 || !text) { failed++; } else { blobs[rel] = text; }
                if (--pending > 0) return;
                if (failed) { setStatus(""); return; }

                try {
                    Object.keys(blobs).forEach(function (rel2) {
                        var dest = path.join(extDir, rel2);
                        mkdirp(path.dirname(dest));
                        fs.writeFileSync(dest + ".new", blobs[rel2], "utf8");
                        if (fs.existsSync(dest)) fs.unlinkSync(dest);
                        fs.renameSync(dest + ".new", dest);
                    });
                    fs.writeFileSync(path.join(extDir, "version.json"),
                                     JSON.stringify(remote, null, 2), "utf8");
                    try { sessionStorage.setItem("mdUpdated", remote.version); } catch (e3) {}
                    // the host script is loaded once at panel start — re-read it before reloading
                    cs.evalScript("$.evalFile(" + JSON.stringify(path.join(extDir, "jsx", "host.jsx")) + ")",
                                  function () { location.reload(true); });
                } catch (e4) {
                    setStatus("Update failed: " + e4.message + " — the extension still works.", "err");
                }
            });
        });
    });
}

/* ---------- Clipboard shortcuts ----------
   The host app swallows Cmd/Ctrl+A/C/V/X before they reach the panel, so text
   fields can't be pasted into. Claim those keys, then handle them ourselves. */
try {
    var keyInterest = isWin
        ? [{ keyCode: 65, ctrlKey: true }, { keyCode: 67, ctrlKey: true },
           { keyCode: 86, ctrlKey: true }, { keyCode: 88, ctrlKey: true }]
        : [{ keyCode: 0, metaKey: true }, { keyCode: 8, metaKey: true },
           { keyCode: 9, metaKey: true }, { keyCode: 7, metaKey: true }];
    cs.registerKeyEventsInterest(JSON.stringify(keyInterest));
} catch (e) {}

function readClipboard(cb) {
    var cmd = isWin ? "powershell -NoProfile -Command Get-Clipboard" : "pbpaste";
    cp.exec(cmd, function (err, stdout) { cb(err ? "" : stdout.toString()); });
}

function writeClipboard(text) {
    try {
        var proc = cp.spawn(isWin ? "clip" : "pbcopy");
        proc.stdin.write(text);
        proc.stdin.end();
    } catch (e) {}
}

document.addEventListener("keydown", function (ev) {
    if (!(ev.metaKey || ev.ctrlKey)) return;
    var el = document.activeElement;
    var k = (ev.key || "").toLowerCase();
    if (!el || (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA")) {
        // paste outside a text field = paste a screenshot from the clipboard
        if (k === "v" && !elPasteImg.disabled) {
            ev.preventDefault();
            pasteScreenshot();
        }
        return;
    }
    if (k === "a") {
        ev.preventDefault();
        el.select();
    } else if (k === "v" && !el.readOnly) {
        ev.preventDefault();
        readClipboard(function (text) {
            text = text.replace(/\r/g, "");
            if (el.tagName === "INPUT") text = text.replace(/\n/g, "").trim();
            var s = el.selectionStart, e = el.selectionEnd, v = el.value;
            el.value = v.slice(0, s) + text + v.slice(e);
            var pos = s + text.length;
            el.setSelectionRange(pos, pos);
        });
    } else if (k === "c" || k === "x") {
        ev.preventDefault();
        var sel = el.value.slice(el.selectionStart, el.selectionEnd);
        if (sel) writeClipboard(sel);
        if (k === "x" && sel && !el.readOnly) {
            var s2 = el.selectionStart;
            el.value = el.value.slice(0, s2) + el.value.slice(el.selectionEnd);
            el.setSelectionRange(s2, s2);
        }
    }
});

/* paste button next to the link field — works even when the host app swallows Cmd/Ctrl+V */
elPasteUrl.addEventListener("click", function () {
    readClipboard(function (text) {
        elUrl.value = (text || "").replace(/[\r\n]/g, "").trim();
        elUrl.focus();
    });
});

/* right-click menu on text fields: Paste / Copy / Select All */
var lastTextField = null;
document.addEventListener("focusin", function (ev) {
    var t = ev.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA") && t.type !== "checkbox" && t.type !== "radio") {
        lastTextField = t;
    }
});

function pasteIntoField(el, text) {
    text = (text || "").replace(/\r/g, "");
    if (el.tagName === "INPUT") text = text.replace(/\n/g, "").trim();
    var s = el.selectionStart, e = el.selectionEnd, v = el.value;
    el.value = v.slice(0, s) + text + v.slice(e);
    var pos = s + text.length;
    el.setSelectionRange(pos, pos);
}

try {
    cs.setContextMenu(
        '<Menu>' +
        '<MenuItem Id="ytPaste" Label="Paste"/>' +
        '<MenuItem Id="ytCopy" Label="Copy"/>' +
        '<MenuItem Id="ytSelectAll" Label="Select All"/>' +
        '</Menu>',
        function (id) {
            var el = lastTextField || elUrl;
            if (id === "ytPaste") {
                if (el.readOnly) return;
                readClipboard(function (text) { pasteIntoField(el, text); el.focus(); });
            } else if (id === "ytCopy") {
                var sel = el.value.slice(el.selectionStart, el.selectionEnd) || el.value;
                if (sel) writeClipboard(sel);
            } else if (id === "ytSelectAll") {
                el.focus();
                el.select();
            }
        }
    );
} catch (e) {}

elSection.addEventListener("change", function () {
    elTsInputs.className = "ts-inputs" + (elSection.checked ? " visible" : "");
});

function setStatus(msg, cls) {
    elStatus.textContent = msg;
    elStatus.className = cls || "";
}

/* The technical log stays hidden; it is only shown if something fails. */
function logLine(line) {
    elLog.textContent += line + "\n";
    elLog.scrollTop = elLog.scrollHeight;
}

function showLog() {
    elLog.style.display = "block";
    elLog.scrollTop = elLog.scrollHeight;
}

/* ---------- Premiere (ExtendScript) ---------- */

function getProjectPath(cb) {
    cs.evalScript("ytGetProjectPath()", function (res) {
        cb(res && res !== "null" && res !== "undefined" ? res : "");
    });
}

function importIntoProject(filePath, cb) {
    var insert = elTimeline.checked ? "true" : "false";
    cs.evalScript("ytImport(" + JSON.stringify(filePath) + "," + insert + ")", function (res) {
        cb(res);
    });
}

/* "ok" = imported + inserted; strings starting with "imported" = in project but not on the timeline */
function importedOk(res) {
    return res === "ok" || /^imported/.test(res || "");
}

function refreshProjectInfo() {
    getProjectPath(function (p) {
        if (!p) {
            elProjectInfo.textContent = "⚠ No project open (or not saved). Save the project first.";
        } else {
            var dir = path.dirname(p);
            elProjectInfo.textContent = "Project: " + path.basename(p) + "\nDownloads to: " + path.join(dir, findAssetsName(dir));
        }
    });
}

/* Look for an existing "assets" folder (case-insensitive); otherwise return "assets" (to be created). */
function findAssetsName(projDir) {
    try {
        var entries = fs.readdirSync(projDir);
        for (var i = 0; i < entries.length; i++) {
            if (entries[i].toLowerCase() === "assets" &&
                fs.statSync(path.join(projDir, entries[i])).isDirectory()) {
                return entries[i];
            }
        }
    } catch (e) {}
    return "assets";
}

function ensureAssetsDir(projDir) {
    var dir = path.join(projDir, findAssetsName(projDir));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    return dir;
}

/* ---------- yt-dlp ---------- */

function findBinary(name) {
    var local = path.join(extDir, "bin", isWin ? name + ".exe" : name);
    if (fs.existsSync(local)) return local;
    // fallback: PATH (including homebrew on Mac)
    var candidates = isWin ? [] : ["/opt/homebrew/bin/" + name, "/usr/local/bin/" + name, "/usr/bin/" + name];
    for (var i = 0; i < candidates.length; i++) {
        if (fs.existsSync(candidates[i])) return candidates[i];
    }
    return name; // hope it is in PATH
}

function validTimestamp(t) {
    return /^(\d{1,2}:)?\d{1,2}:\d{2}(\.\d+)?$|^\d+(\.\d+)?$/.test(t);
}

/* yt-dlp needs a JS runtime (deno) for full YouTube extraction — without it the
   fallback API may not expose the H.264 formats, forcing avoidable re-encodes */
function findDeno() {
    var cands = isWin
        ? [path.join(extDir, "bin", "deno.exe"), path.join(os.homedir(), ".deno", "bin", "deno.exe")]
        : [path.join(extDir, "bin", "deno"), path.join(os.homedir(), ".deno", "bin", "deno"),
           "/opt/homebrew/bin/deno", "/usr/local/bin/deno"];
    for (var i = 0; i < cands.length; i++) {
        if (fs.existsSync(cands[i])) return cands[i];
    }
    return "";
}

/* Only offer a browser's cookies if it actually has a cookies database — otherwise
   --cookies-from-browser fails with a confusing "could not find … cookies database".
   Chromium keeps cookies at <profile>/Cookies or <profile>/Network/Cookies. */
function chromiumHasCookies(base) {
    try {
        if (!fs.existsSync(base)) return false;
        var profiles = ["Default"];
        var entries = fs.readdirSync(base);
        for (var i = 0; i < entries.length; i++) {
            if (/^Profile /.test(entries[i])) profiles.push(entries[i]);
        }
        for (var p = 0; p < profiles.length; p++) {
            var prof = path.join(base, profiles[p]);
            if (fs.existsSync(path.join(prof, "Cookies")) ||
                fs.existsSync(path.join(prof, "Network", "Cookies"))) return true;
        }
    } catch (e) {}
    return false;
}

function firefoxHasCookies(base) {
    try {
        var prof = path.join(base, "Profiles");
        if (!fs.existsSync(prof)) return false;
        var dirs = fs.readdirSync(prof);
        for (var i = 0; i < dirs.length; i++) {
            if (fs.existsSync(path.join(prof, dirs[i], "cookies.sqlite"))) return true;
        }
    } catch (e) {}
    return false;
}

function browserInstalled(name) {
    var home = os.homedir();
    var base;
    if (isWin) {
        var la = nodeProcess.env.LOCALAPPDATA || "";
        var roam = nodeProcess.env.APPDATA || "";
        if (name === "chrome")  return chromiumHasCookies(path.join(la, "Google", "Chrome", "User Data"));
        if (name === "brave")   return chromiumHasCookies(path.join(la, "BraveSoftware", "Brave-Browser", "User Data"));
        if (name === "edge")    return chromiumHasCookies(path.join(la, "Microsoft", "Edge", "User Data"));
        if (name === "vivaldi") return chromiumHasCookies(path.join(la, "Vivaldi", "User Data"));
        if (name === "firefox") return firefoxHasCookies(path.join(roam, "Mozilla", "Firefox"));
        return false; // no Safari on Windows
    }
    var appSup = path.join(home, "Library", "Application Support");
    if (name === "chrome")  return chromiumHasCookies(path.join(appSup, "Google", "Chrome"));
    if (name === "brave")   return chromiumHasCookies(path.join(appSup, "BraveSoftware", "Brave-Browser"));
    if (name === "edge")    return chromiumHasCookies(path.join(appSup, "Microsoft Edge"));
    if (name === "vivaldi") return chromiumHasCookies(path.join(appSup, "Vivaldi"));
    if (name === "firefox") return firefoxHasCookies(path.join(appSup, "Firefox"));
    if (name === "safari")  return fs.existsSync(path.join(home, "Library", "Containers", "com.apple.Safari", "Data", "Library", "Cookies", "Cookies.binarycookies")) ||
                                   fs.existsSync(path.join(home, "Library", "Cookies", "Cookies.binarycookies"));
    return false;
}

/* On Apple Silicon use the hardware encoder for unavoidable re-encodes (≈10x faster);
   -q:v 80 is visually transparent. Elsewhere stick to libx264 CRF 18. */
var isMacArm = !isWin && os.arch && os.arch() === "arm64";
var ENC_VIDEO = isMacArm
    ? "-c:v h264_videotoolbox -q:v 80 -allow_sw 1"
    : "-c:v libx264 -crf 18 -preset medium";
var ENC_COMMON = "-pix_fmt yuv420p -vf scale=trunc(iw/2)*2:trunc(ih/2)*2 -c:a aac -b:a 256k";

/* ---------- screenshot from clipboard ---------- */

function saveClipboardImage(destPng, cb) {
    if (isWin) {
        var psDest = destPng.replace(/'/g, "''");
        var ps = "Add-Type -AssemblyName System.Windows.Forms; " +
                 "$img=[Windows.Forms.Clipboard]::GetImage(); " +
                 "if($img -eq $null){ exit 2 }; " +
                 "$img.Save('" + psDest + "',[System.Drawing.Imaging.ImageFormat]::Png)";
        cp.exec('powershell -NoProfile -STA -Command "' + ps.replace(/"/g, '\\"') + '"', function (err) {
            cb(err ? (err.code === 2 ? "no-image" : String(err)) : null);
        });
    } else {
        var scpt = 'try\n' +
                   'set f to open for access POSIX file "' + destPng + '" with write permission\n' +
                   'write (the clipboard as «class PNGf») to f\n' +
                   'close access f\n' +
                   'on error\n' +
                   'try\nclose access POSIX file "' + destPng + '"\nend try\n' +
                   'return "no-image"\n' +
                   'end try';
        cp.execFile("osascript", ["-e", scpt], function (err, stdout) {
            if (err) { cb(String(err)); return; }
            if ((stdout || "").indexOf("no-image") !== -1) { cb("no-image"); return; }
            cb(null);
        });
    }
}

function tsName() {
    function p(n) { return (n < 10 ? "0" : "") + n; }
    var d = new Date();
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
           " " + p(d.getHours()) + "." + p(d.getMinutes()) + "." + p(d.getSeconds());
}

function pasteScreenshot() {
    getProjectPath(function (projPath) {
        if (!projPath) {
            setStatus("No project open or the project is not saved. Save it first.", "err");
            return;
        }
        var outDir;
        try {
            outDir = ensureAssetsDir(path.dirname(projPath));
        } catch (e) {
            setStatus("Could not create the assets folder: " + e.message, "err");
            return;
        }
        var dest = path.join(outDir, "Screenshot " + tsName() + ".png");
        elPasteImg.disabled = true;
        setStatus("Saving screenshot…");
        saveClipboardImage(dest, function (err) {
            // the no-image path can leave an empty file behind — clean it up
            try { if (fs.existsSync(dest) && fs.statSync(dest).size === 0) { fs.unlinkSync(dest); err = err || "no-image"; } } catch (e2) {}
            if (err === "no-image") {
                elPasteImg.disabled = false;
                setStatus("No image in clipboard. Take a screenshot to clipboard first: Cmd+Ctrl+Shift+4 (Mac) / Win+Shift+S (Windows).", "err");
                return;
            }
            if (err) {
                elPasteImg.disabled = false;
                setStatus("⚠ " + err, "err");
                return;
            }
            setStatus("Importing into " + hostApp + "…");
            importIntoProject(dest, function (res) {
                elPasteImg.disabled = false;
                if (res === "ok") {
                    setStatus("✔ " + path.basename(dest) + " — saved to assets and imported.", "ok");
                } else if (importedOk(res)) {
                    setStatus("✔ " + path.basename(dest) + " — " + res, "ok");
                } else {
                    setStatus("Saved to assets, but import failed: " + res, "err");
                }
                refreshProjectInfo();
            });
        });
    });
}


function buildArgs(url, opts, outDir, printFile, metaFile) {
    var args = [url, "--no-playlist", "--newline", "--no-mtime",
                "--print-to-file", "after_move:filepath", printFile,
                "--print-to-file", "after_move:%(uploader_id)s\n%(channel)s\n%(uploader)s\n%(webpage_url)s", metaFile];

    var ffDir = path.dirname(findBinary("ffmpeg"));
    if (ffDir !== ".") args.push("--ffmpeg-location", ffDir);

    var deno = findDeno();
    if (deno) args.push("--js-runtimes", "deno:" + deno);

    var tmpl = "%(title).80B [%(id)s]";
    if (opts.section) tmpl += " [%(section_start)d-%(section_end)d]";
    tmpl += ".%(ext)s";
    args.push("-o", path.join(outDir, tmpl));

    if (opts.mode === "video") {
        // max quality, H.264 preferred at equal resolution; any needed conversion is
        // done by ensureCompatibleVideo afterwards (with real progress), not by yt-dlp
        args.push("-f", "bv*+ba/b", "-S", "res,fps,vcodec:h264,acodec:m4a");
    } else { // audio only
        args.push("-f", "ba/b", "-x", "--audio-format", "m4a", "--audio-quality", "0");
    }

    if (opts.section) {
        var start = opts.start || "0";
        var end = opts.end || "inf";
        args.push("--download-sections", "*" + start + "-" + end, "--force-keyframes-at-cuts");
    }
    return args;
}

/* ---------- codec compatibility ----------
   yt-dlp's --recode-video only looks at the container: a VP9/AV1 stream inside
   an .mp4 (typical for Instagram reels) is left as-is, and Premiere/AE then
   only see the audio. Check the actual codec and re-encode to H.264 if needed. */

var COMPAT_VCODECS = /^(h264|avc1?|hevc|h265|prores|dnxhd|dnxhr|mpeg2video|mpeg4|mjpeg|png)$/i;

function detectVideoStream(file, cb) {
    cp.execFile(findBinary("ffmpeg"), ["-hide_banner", "-i", file], function (err, stdout, stderr) {
        // ffmpeg exits non-zero without an output file; stream info is on stderr
        var se = String(stderr);
        var m = se.match(/Stream #[^\n]*Video:[^\n]*/);
        var line = m ? m[0] : "";
        var cm = line.match(/Video:\s*([A-Za-z0-9_]+)/);
        var dm = se.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        var dur = dm ? (+dm[1]) * 3600 + (+dm[2]) * 60 + (+dm[3]) : 0;
        cb(cm ? cm[1].toLowerCase() : "", line, dur);
    });
}

function ensureCompatibleVideo(file, cb) {
    detectVideoStream(file, function (codec, streamLine, dur) {
        if (!codec) { cb(file); return; }
        var badCodec = !COMPAT_VCODECS.test(codec);
        // H.264/HEVC in 4:4:4 or 4:2:2 (e.g. GIF sources) is rejected by Premiere — only yuv420p variants are safe
        var badPixFmt = /^(h264|avc1?|hevc|h265)$/i.test(codec) && !/yuvj?420p/.test(streamLine);
        // Premiere/AE don't read MKV/WebM containers even when the codec inside is fine
        var badContainer = !/^\.(mp4|mov|m4v)$/i.test(path.extname(file));
        if (!badCodec && !badPixFmt && !badContainer) { cb(file); return; }

        var fullReencode = badCodec || badPixFmt;
        var label = fullReencode
            ? "Re-encoding " + codec.toUpperCase() + " → H.264 for " + hostApp
            : "Repacking to MP4 for " + hostApp; // stream copy: fast, zero quality loss
        setStatus(label + "…");
        logLine(label + ": " + path.basename(file));

        var dir = path.dirname(file);
        var base = path.basename(file).replace(/\.[^.]+$/, "");
        var tmp = path.join(dir, base + ".convert.mp4");
        var args = ["-y", "-i", file];
        if (fullReencode) {
            args = args.concat(ENC_VIDEO.split(" ")).concat(ENC_COMMON.split(" "));
        } else {
            args = args.concat(["-c:v", "copy", "-c:a", "aac", "-b:a", "256k"]);
        }
        args.push(tmp);

        var proc = cp.spawn(findBinary("ffmpeg"), args);
        currentProc = proc;
        proc.stderr.on("data", function (d) {
            var m = d.toString().match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
            if (m && dur) {
                var t = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
                var pct = Math.min(99, Math.round(t / dur * 100));
                elProgressBar.style.width = pct + "%";
                setStatus(label + "… " + pct + "%");
            }
        });
        proc.on("error", function () { currentProc = null; cb(file); });
        proc.on("close", function (code) {
            currentProc = null;
            if (code !== 0 || !fs.existsSync(tmp) || fs.statSync(tmp).size === 0) {
                try { fs.unlinkSync(tmp); } catch (e) {}
                cb(file); // fall back to the original
                return;
            }
            var final = path.join(dir, base + ".mp4");
            try {
                fs.unlinkSync(file);
                fs.renameSync(tmp, final);
                cb(final);
            } catch (e2) {
                cb(tmp);
            }
        });
    });
}

function runDownload(url, opts, outDir, done) {
    var ytdlp = findBinary("yt-dlp");
    safariBlocked = false;
    var env = Object.assign({}, nodeProcess.env);
    if (!isWin) env.PATH = "/opt/homebrew/bin:/usr/local/bin:" + (env.PATH || "");

    // Some videos (e.g. certain Shorts, most Instagram posts) trigger a "Sign in to
    // confirm you're not a bot" / login check — the only way through is a logged-in
    // session. Retry with cookies.txt from the extension folder, then with cookies
    // from whichever browsers are actually installed on this machine.
    var attempts = [{ label: "", args: [] }];

    // YouTube hands out per-client media URLs, and the default client's often come back
    // 403 on the actual download. Another client usually just works, and it costs nothing
    // to try before dragging cookies into it.
    var altClient = [];
    if (/youtube\.com|youtu\.be/i.test(url)) {
        altClient = ["--extractor-args", "youtube:player_client=web_safari,tv,ios"];
        attempts.push({ label: "a different YouTube player", args: altClient });
    }

    var ck = path.join(extDir, "cookies.txt");
    if (fs.existsSync(ck)) attempts.push({ label: "cookies.txt", args: ["--cookies", ck].concat(altClient) });
    var browsers = ["chrome", "brave", "edge", "firefox", "vivaldi", "safari"];
    for (var bi = 0; bi < browsers.length; bi++) {
        if (browserInstalled(browsers[bi])) {
            attempts.push({
                label: browsers[bi] + " cookies",
                args: ["--cookies-from-browser", browsers[bi]].concat(altClient)
            });
        }
    }

    function attempt(idx) {
        runDownloadOnce(ytdlp, env, attempts[idx].args, url, opts, outDir, function (err, filePath, credit, needsAuth) {
            // Once we're in cookie-fallback mode (idx > 0) any failure — auth OR a
            // missing/locked cookie database — should just move to the next source,
            // not abort with a confusing "could not find … cookies database" error.
            if (err && (needsAuth || idx > 0)) {
                if (idx + 1 < attempts.length) {
                    setStatus("Site requests login — trying " + attempts[idx + 1].label + "…");
                    elProgressBar.style.width = "0%";
                    attempt(idx + 1);
                } else {
                    var tip = "This video would not download, even with cookies. Log into the site in Chrome or Safari, then try again.";
                    if (safariBlocked) {
                        tip += " macOS is blocking access to Safari's cookies — grant " + hostApp +
                               " Full Disk Access in System Settings → Privacy & Security, then restart it.";
                    }
                    done(tip, null);
                }
                return;
            }
            done(err, filePath, credit);
        });
    }
    attempt(0);
}

function runDownloadOnce(ytdlp, env, extraArgs, url, opts, outDir, done) {
    var printFile = path.join(os.tmpdir(), "ytdlp_out_" + Date.now() + ".txt");
    var metaFile = path.join(os.tmpdir(), "ytdlp_meta_" + Date.now() + ".txt");
    var args = extraArgs.concat(buildArgs(url, opts, outDir, printFile, metaFile));

    logLine("$ yt-dlp " + args.join(" "));
    var proc = cp.spawn(ytdlp, args, { env: env });
    currentProc = proc;
    var lastErr = "";
    var needsAuth = false;

    function onData(data) {
        var lines = data.toString().split("\n");
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;
            var m = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
            if (m) {
                elProgressBar.style.width = m[1] + "%";
                setStatus("Downloading… " + m[1] + "%");
            } else if (line.indexOf("[Merger]") === 0) {
                setStatus("Merging audio + video…");
                logLine(line);
            } else if (line.indexOf("[ExtractAudio]") === 0) {
                setStatus("Extracting audio…");
                logLine(line);
            } else if (line.indexOf("ERROR") !== -1) {
                lastErr = line;
                // every one of these is worth retrying from a different angle: a login
                // wall, an unreadable cookie store, or a 403 on the media URL itself
                if (/Sign in to confirm|not a bot|--cookies|login required|could not find.*cookies|cookies database|unable to load cookies|HTTP Error 403|Unexpected response from webpage/i.test(line)) needsAuth = true;
                if (/Operation not permitted.*binarycookies/i.test(line)) safariBlocked = true;
                logLine(line);
            } else {
                logLine(line);
            }
        }
    }

    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);

    proc.on("error", function (err) {
        currentProc = null;
        done("Could not start yt-dlp: " + err.message + "\nRun the installer (INSTALL).", null);
    });

    proc.on("close", function (code) {
        currentProc = null;
        if (code !== 0) {
            done(lastErr || ("yt-dlp exited with code " + code), null, "", needsAuth);
            return;
        }
        var finalPath = "";
        try {
            var content = fs.readFileSync(printFile, "utf8").trim().split("\n");
            finalPath = content[content.length - 1].trim();
            fs.unlinkSync(printFile);
        } catch (e) {}
        if (!finalPath || !fs.existsSync(finalPath)) {
            done("Download finished but the output file was not found.", null);
            return;
        }
        // copyright credit: account tag (handle) + source URL.
        // The handle lives in a different field per platform (YouTube: uploader_id,
        // Instagram: channel, TikTok: uploader) — pick the first handle-looking value.
        var credit = "";
        try {
            var meta = fs.readFileSync(metaFile, "utf8").trim().split("\n");
            fs.unlinkSync(metaFile);
            if (meta.length >= 4) {
                var candidates = [meta[0], meta[1], meta[2]];
                var tag = "";
                for (var ci = 0; ci < candidates.length; ci++) {
                    var c = candidates[ci].trim();
                    if (c && c !== "NA" && !/^\d+$/.test(c) && /^@?[A-Za-z0-9._-]+$/.test(c)) {
                        tag = c.replace(/^@/, "");
                        break;
                    }
                }
                if (!tag) { // fallback: first non-empty value, even if it's a display name
                    for (var cj = 0; cj < candidates.length; cj++) {
                        var c2 = candidates[cj].trim();
                        if (c2 && c2 !== "NA") { tag = c2; break; }
                    }
                }
                if (tag) credit = "@" + tag + "\nSource: " + meta[3].trim();
            }
        } catch (e2) {}
        if (opts.mode === "video") {
            ensureCompatibleVideo(finalPath, function (compatPath) {
                done(null, compatPath, credit);
            });
        } else {
            done(null, finalPath, credit);
        }
    });
}

/* ---------- UI flow ---------- */

function setBusy(busy) {
    elBtn.disabled = busy;
    elCancel.style.display = busy ? "block" : "none";
    elProgressWrap.style.display = busy ? "block" : "none";
    if (busy) {
        elProgressBar.style.width = "0%";
        elLog.textContent = "";
        elLog.style.display = "none";
        elCredits.style.display = "none";
        elCreditText.value = "";
    }
}

elPasteImg.addEventListener("click", pasteScreenshot);

/* ---------- Rough Cut + Normalize ----------
   Both work on whatever is selected in the timeline — any number of clips, on any
   tracks. The audio is analysed by ffmpeg straight from the source files, only the
   part each clip actually uses, so no transcript and no render is needed. */

var elRcPad = document.getElementById("rcPad");
var elRcClose = document.getElementById("rcClose");
var elRcNorm = document.getElementById("rcNorm");
var elNormalize = document.getElementById("btnNormalize");
var elNormTarget = document.getElementById("normTarget");
var elRcPunch = document.getElementById("rcPunch");
var elPunch = document.getElementById("btnPunch");
var elPunchZoom = document.getElementById("punchZoom");
var elPunchSfx = document.getElementById("punchSfx");
var elDynZoom = document.getElementById("btnDynZoom");
var elDzAmount = document.getElementById("dzAmount");
var elDzDir = document.getElementById("dzDir");
var elDzEase = document.getElementById("dzEase");
var elSfx = document.getElementById("btnSfx");
var elSfxPick = document.getElementById("btnSfxPick");
var elSfxName = document.getElementById("sfxName");
var elSfxAlign = document.getElementById("sfxAlign");

function numIn(el, def) {
    var v = parseFloat(String(el.value).replace(",", "."));
    return isFinite(v) ? v : def;
}

function setToolsBusy(busy) {
    elRoughCut.disabled = busy;
    elNormalize.disabled = busy;
    elPunch.disabled = busy;
    elDynZoom.disabled = busy;
    elSfx.disabled = busy;
    elProgressWrap.style.display = busy ? "block" : "none";
    if (busy) elProgressBar.style.width = "0%";
}

function toolsDone(msg, isErr) {
    setToolsBusy(false);
    setStatus(msg, isErr ? "err" : "ok");
}

function getSelection(cb) {
    cs.evalScript("ytGetSelectedClips()", function (res) {
        var sel;
        try { sel = JSON.parse(res); } catch (e) { sel = { error: "Could not read the timeline selection." }; }
        if (!sel.error && (!sel.items || !sel.items.length)) {
            sel.error = "Select one or more clips on the timeline first.";
        }
        cb(sel);
    });
}

/* One ffmpeg pass per source range, with silencedetect and/or ebur128 chained on
   the audio alone (-vn: the video is never decoded, which is most of the cost).
   -ss/-t before -i limit the work to the clip's in/out; timestamps then start at 0. */
function analyzeRange(src, opts, onProgress, cb) {
    var dur = Math.max(0.01, src.outPoint - src.inPoint);
    var filters = [];
    if (opts.silence) filters.push("silencedetect=noise=" + opts.noise + ":d=" + opts.minDur);
    if (opts.loudness) filters.push("ebur128=peak=true");
    var args = ["-hide_banner", "-ss", String(src.inPoint), "-t", String(dur), "-i", src.filePath,
                "-vn", "-sn", "-dn", "-af", filters.join(","), "-f", "null", "-"];

    var proc = cp.spawn(findBinary("ffmpeg"), args);
    currentProc = proc;
    var out = "";
    proc.stderr.on("data", function (d) {
        var chunk = d.toString();
        out += chunk;
        var tm = chunk.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (tm) onProgress(Math.min(1, ((+tm[1]) * 3600 + (+tm[2]) * 60 + (+tm[3])) / dur));
    });
    proc.stdout.on("data", function () {});
    proc.on("error", function (err) { currentProc = null; cb("ffmpeg: " + err.message); });
    proc.on("close", function () {
        currentProc = null;
        var r = { noAudio: !/Stream #[^\n]*Audio:/.test(out), sil: [], lufs: null, peak: null };
        if (r.noAudio) { cb(null, r); return; }

        if (opts.silence) {
            var m, starts = [], ends = [];
            var reS = /silence_start:\s*(-?[\d.]+)/g, reE = /silence_end:\s*(-?[\d.]+)/g;
            while ((m = reS.exec(out))) starts.push(parseFloat(m[1]));
            while ((m = reE.exec(out))) ends.push(parseFloat(m[1]));
            for (var i = 0; i < starts.length; i++) {
                r.sil.push({ s: src.inPoint + Math.max(0, starts[i]),
                             e: src.inPoint + (i < ends.length ? ends[i] : dur) });
            }
        }
        if (opts.loudness) {
            // per-frame lines also carry "I:", the summary is always the last one
            var li = out.match(/\bI:\s+-?[\d.]+ LUFS/g);
            var pk = out.match(/Peak:\s+(-?[\d.]+|-inf) dBFS/g);
            if (li) r.lufs = parseFloat(li[li.length - 1].match(/-?[\d.]+/)[0]);
            if (pk) {
                var pv = pk[pk.length - 1].match(/(-?[\d.]+|-inf) dBFS/)[1];
                r.peak = pv === "-inf" ? -Infinity : parseFloat(pv);
            }
        }
        cb(null, r);
    });
}

/* Linked video + audio of one clip read the same range of the same file — analyse it once. */
function analyzeAll(items, opts, cb) {
    var jobs = [], seen = {}, results = {};
    items.forEach(function (it) {
        it.key = it.filePath + "|" + it.inPoint.toFixed(3) + "|" + it.outPoint.toFixed(3);
        if (!seen[it.key]) { seen[it.key] = true; jobs.push(it); }
    });
    var i = 0;
    (function next() {
        if (i >= jobs.length) { cb(null, results); return; }
        var job = jobs[i];
        if (!fs.existsSync(job.filePath)) { cb("Source file not found (offline?): " + job.filePath); return; }
        setStatus("Analysing audio " + (i + 1) + " / " + jobs.length + " — " + path.basename(job.filePath) + "…");
        analyzeRange(job, opts, function (f) {
            elProgressBar.style.width = Math.round((i + f) / jobs.length * 100) + "%";
        }, function (err, r) {
            if (err) { cb(err); return; }
            results[job.key] = r;
            i++;
            next();
        });
    })();
}

function toSeq(it, t) { return it.seqStart + (t - it.inPoint) / (it.speed || 1); }

/* A moment is cut only if it is silent in EVERY selected clip that covers it — so
   with two mics or a multicam, nothing goes while anyone is talking. Clips with no
   audio of their own (b-roll, reversed clips) follow the cut but have no say in it. */
function computeCuts(items, results, minDur, pad, frame) {
    var voters = [];
    items.forEach(function (it) {
        var r = results[it.key];
        if (!r || r.noAudio || it.reversed) return;
        voters.push({ a: it.seqStart, b: it.seqEnd, sil: r.sil.map(function (s) {
            return { s: Math.max(it.seqStart, toSeq(it, s.s)), e: Math.min(it.seqEnd, toSeq(it, s.e)) };
        }) });
    });
    if (!voters.length) return [];

    var pts = [];
    voters.forEach(function (v) {
        pts.push(v.a, v.b);
        v.sil.forEach(function (s) { pts.push(s.s, s.e); });
    });
    pts.sort(function (x, y) { return x - y; });

    var raw = [];
    for (var i = 0; i + 1 < pts.length; i++) {
        var a = pts[i], b = pts[i + 1];
        if (b - a < 1e-6) continue;
        var m = (a + b) / 2, covered = false, silent = true;
        voters.forEach(function (v) {
            if (m < v.a || m >= v.b) return;
            covered = true;
            if (!v.sil.some(function (s) { return m >= s.s && m < s.e; })) silent = false;
        });
        if (!covered || !silent) continue;
        var last = raw[raw.length - 1];
        if (last && a - last.e < 1e-6) last.e = b; else raw.push({ s: a, e: b });
    }

    // pad keeps a breath around the words; edges snap inward to whole frames,
    // which is where Premiere's razor lands anyway
    var cuts = [];
    raw.forEach(function (c) {
        if (c.e - c.s < minDur) return;
        var s = Math.ceil((c.s + pad) / frame - 1e-6) * frame;
        var e = Math.floor((c.e - pad) / frame + 1e-6) * frame;
        if (e - s >= frame) cuts.push({ s: s, e: e });
    });
    return cuts;
}

/* Gain to reach the loudness target, held back so the true peak stays under -1 dBTP —
   no limiter is involved, so going louder than that would clip. */
function gainFor(r, target) {
    if (!r || r.noAudio || r.lufs === null || r.lufs < -60) return null;
    var g = target - r.lufs;
    if (r.peak !== null && isFinite(r.peak)) g = Math.min(g, -1 - r.peak);
    return Math.round(g * 10) / 10;
}

function applyGain(items, results, target, cb) {
    var list = [];
    items.forEach(function (it) {
        if (it.kind !== "audio") return;
        var g = gainFor(results[it.key], target);
        if (g !== null) list.push({ track: it.track, seqStart: it.seqStart, gain: g });
    });
    if (!list.length) { cb("None of the selected clips has measurable audio."); return; }
    setStatus("Setting clip volume…");
    cs.evalScript("ytSetClipGain(" + JSON.stringify(JSON.stringify(list)) + ")", function (res) {
        var r;
        try { r = JSON.parse(res); } catch (e) { cb("Premiere did not answer: " + res); return; }
        if (r.error) { cb(r.error); return; }
        var gains = list.map(function (x) { return x.gain; });
        var lo = Math.min.apply(null, gains), hi = Math.max.apply(null, gains);
        var fmt = function (g) { return (g > 0 ? "+" : "") + g.toFixed(1); };
        var msg = "Normalized " + r.done + " clip(s) to " + target + " LUFS (" +
                  (lo === hi ? fmt(lo) : fmt(lo) + " … " + fmt(hi)) + " dB).";
        if (r.capped) msg += " " + r.capped + " capped at +15 dB, Premiere's maximum.";
        if (r.failed) msg += " " + r.failed + " could not be changed.";
        cb(null, msg);
    });
}

function fmtDur(s) {
    if (s < 60) return s.toFixed(1) + "s";
    var m = Math.floor(s / 60), r = Math.round(s - m * 60);
    return m + ":" + (r < 10 ? "0" : "") + r;
}

function uniqTracks(items, kind) {
    var seen = {}, out = [];
    items.forEach(function (it) {
        if (it.kind === kind && !seen[it.track]) { seen[it.track] = true; out.push(it.track); }
    });
    return out;
}

function roughCut() {
    var needSfx = elRcPunch.checked && elPunchSfx.checked;
    withSfx(needSfx, roughCutWith);
}

function roughCutWith(sfx) {
    var noiseRaw = String(elRcThreshold.value || "-30").trim();
    var noise = /^-?\d+(\.\d+)?$/.test(noiseRaw) ? noiseRaw + "dB" : noiseRaw;
    var minDur = Math.max(0.1, numIn(elRcMinDur, 0.5));
    var pad = Math.max(0, numIn(elRcPad, 0.1));
    var close = elRcClose.checked, norm = elRcNorm.checked;
    var target = numIn(elNormTarget, -16);
    var punch = elRcPunch.checked ? punchZoom() : 0;
    if (punch === null) return;

    setToolsBusy(true);
    setStatus("Reading the selection…");
    getSelection(function (sel) {
        if (sel.error) { toolsDone(sel.error, true); return; }
        if (sel.unlinked && close) {
            toolsDone("Some selected clips have linked video/audio that isn't selected. Select it too " +
                      "(or turn on Linked Selection) — otherwise it falls out of sync.", true);
            return;
        }
        analyzeAll(sel.items, { silence: true, noise: noise, minDur: minDur, loudness: norm }, function (err, results) {
            if (err) { toolsDone(err, true); return; }
            var cuts = computeCuts(sel.items, results, minDur, pad, sel.frame);

            function cut(prefix) {
                if (!cuts.length) {
                    toolsDone(prefix + "No silence found (threshold " + noise + ", min " + minDur +
                              "s). Try a higher threshold, e.g. -25.", false);
                    return;
                }
                setStatus(prefix + "Cutting " + cuts.length + " silent section(s)…");
                var payload = { cuts: cuts, frame: sel.frame, close: close, punch: punch, sfx: sfx,
                                video: uniqTracks(sel.items, "video"), audio: uniqTracks(sel.items, "audio"),
                                ranges: sel.items.filter(function (it) { return it.kind === "video"; })
                                                 .map(function (it) { return { track: it.track, s: it.seqStart, e: it.seqEnd }; }) };
                cs.evalScript("ytApplyRoughCut(" + JSON.stringify(JSON.stringify(payload)) + ")", function (res) {
                    var r;
                    try { r = JSON.parse(res); } catch (e) { toolsDone("Rough cut failed: " + res, true); return; }
                    if (r.error) { toolsDone(prefix + r.error, true); return; }
                    var msg = "✔ Cut " + r.applied + " silent section(s)";
                    msg += close && r.closed ? " — " + fmtDur(r.saved) + " shorter." : ", gaps left in place.";
                    if (close && !r.closed) msg += " Some gaps could not be closed: Sequence → Close Gap.";
                    if (punch) msg += " Punch-in on " + (r.punched || 0) + " piece(s).";
                    if (sfx) msg += sfxNote(r.sfxPlaced, r.sfxNoRoom);
                    if (r.skipped) msg += " " + r.skipped + " skipped (unselected clips on the same tracks).";
                    if (r.missed) msg += " " + r.missed + " could not be cut cleanly and were left alone.";
                    if (r.backup) msg += " Original kept as “" + r.backup + "”.";
                    toolsDone(prefix + msg, false);
                });
            }

            // normalize before razoring, so every piece inherits the same volume
            if (!norm) { cut(""); return; }
            applyGain(sel.items, results, target, function (e2, normMsg) {
                if (e2) { toolsDone(e2, true); return; }
                cut(normMsg + " ");
            });
        });
    });
}

function normalizeSelected() {
    var target = numIn(elNormTarget, -16);
    setToolsBusy(true);
    setStatus("Reading the selection…");
    getSelection(function (sel) {
        if (sel.error) { toolsDone(sel.error, true); return; }
        var audio = sel.items.filter(function (it) { return it.kind === "audio"; });
        if (!audio.length) { toolsDone("Select clips that have audio on the timeline.", true); return; }
        analyzeAll(audio, { loudness: true }, function (err, results) {
            if (err) { toolsDone(err, true); return; }
            applyGain(audio, results, target, function (e2, msg) {
                toolsDone(e2 ? e2 : "✔ " + msg, !!e2);
            });
        });
    });
}

/* returns the zoom percentage, or null (with the reason shown) if it makes no sense */
function punchZoom() {
    var z = numIn(elPunchZoom, 110);
    if (z <= 100 || z > 200) {
        setStatus("Punch-in zoom must be between 101 and 200 %.", "err");
        return null;
    }
    return z;
}

function punchSelected() {
    withSfx(elPunchSfx.checked, punchSelectedWith);
}

function punchSelectedWith(sfx) {
    var zoom = punchZoom();
    if (zoom === null) return;
    setToolsBusy(true);
    setStatus("Punching in…");
    cs.evalScript("ytPunchIn(" + JSON.stringify(JSON.stringify({ zoom: zoom, sfx: sfx })) + ")", function (res) {
        var r;
        try { r = JSON.parse(res); } catch (e) { toolsDone("Punch-in failed: " + res, true); return; }
        if (r.error) { toolsDone(r.error, true); return; }
        var msg = "✔ Punch-in " + zoom + "% on " + r.done + " of " + r.seen + " clip(s) — every second one.";
        if (r.done < Math.floor(r.seen / 2)) msg += " Clips with keyframed Scale were left alone.";
        if (sfx) msg += sfxNote(r.sfxPlaced, r.sfxNoRoom);
        toolsDone(msg, false);
    });
}

elRoughCut.addEventListener("click", roughCut);
elPunch.addEventListener("click", punchSelected);

function dynamicZoomSelected() {
    var amount = numIn(elDzAmount, 115);
    if (amount <= 100 || amount > 200) { setStatus("Dynamic Zoom amount must be between 101 and 200 %.", "err"); return; }
    var opts = { amount: amount, dir: elDzDir.value, ease: elDzEase.checked };
    setToolsBusy(true);
    setStatus("Animating zoom…");
    cs.evalScript("ytDynamicZoom(" + JSON.stringify(JSON.stringify(opts)) + ")", function (res) {
        var r;
        try { r = JSON.parse(res); } catch (e) { toolsDone("Dynamic Zoom failed: " + res, true); return; }
        if (r.error) { toolsDone(r.error, true); return; }
        var label = { "in": "zoom in", out: "zoom out", alt: "alternating in / out" }[opts.dir];
        var msg = "✔ Dynamic Zoom (" + label + ", " + amount + "%) on " + r.done + " clip(s).";
        if (r.failed) msg += " " + r.failed + " could not be animated (too short, or no Motion effect).";
        toolsDone(msg, !r.done);
    });
}

elDynZoom.addEventListener("click", dynamicZoomSelected);

/* ---------- SFX at cuts ----------
   The sound comes from the editor's own disk and is remembered per machine, so it
   can be swapped any time without an update — and nobody's licensed SFX has to
   live in this public repo. */

var SFX_KEY = "md.sfxFile";

function sfxFile() {
    try { return localStorage.getItem(SFX_KEY) || ""; } catch (e) { return ""; }
}

function showSfx() {
    var f = sfxFile();
    elSfxName.textContent = f ? path.basename(f) : "no sound chosen";
    elSfxName.title = f;
}

function pickSfx(then) {
    var r = null;
    try {
        r = window.cep.fs.showOpenDialogEx(false, false, "Choose a sound effect", "",
                                          ["wav", "mp3", "aif", "aiff", "m4a", "aac"]);
    } catch (e) {}
    var f = r && r.data && r.data[0];
    if (!f) return;
    try { localStorage.setItem(SFX_KEY, f); } catch (e2) {}
    showSfx();
    if (then) then(f);
}

function sfxAtCuts(file) {
    if (!file || !fs.existsSync(file)) { pickSfx(sfxAtCuts); return; }
    setToolsBusy(true);
    setStatus("Reading " + path.basename(file) + "…");
    detectVideoStream(file, function (codec, line, dur) {
        if (!dur) { toolsDone("Could not read the length of " + path.basename(file) + ".", true); return; }
        var opts = { file: file, dur: dur, align: elSfxAlign.value };
        setStatus("Placing sounds…");
        cs.evalScript("ytSfxAtCuts(" + JSON.stringify(JSON.stringify(opts)) + ")", function (res) {
            var r;
            try { r = JSON.parse(res); } catch (e) { toolsDone("SFX at cuts failed: " + res, true); return; }
            if (r.error) { toolsDone(r.error, true); return; }
            var msg = "✔ " + path.basename(file) + " placed on " + r.placed + " of " + r.points + " cut(s).";
            if (r.noRoom) msg += " " + r.noRoom + " had no free audio track — add an empty one and run it again.";
            toolsDone(msg, !r.placed);
        });
    });
}

/* Resolve the chosen sound into { file, dur, align } — asking for one if none is set
   yet — or hand back null when no sound is wanted. Nothing runs if the dialog is
   cancelled. */
function withSfx(needed, run) {
    if (!needed) { run(null); return; }
    var go = function (file) {
        setStatus("Reading " + path.basename(file) + "…");
        detectVideoStream(file, function (codec, line, dur) {
            if (!dur) { setStatus("Could not read the length of " + path.basename(file) + ".", "err"); return; }
            run({ file: file, dur: dur, align: elSfxAlign.value });
        });
    };
    var f = sfxFile();
    if (f && fs.existsSync(f)) go(f); else pickSfx(go);
}

function sfxNote(placed, noRoom) {
    var n = " Sound on " + (placed || 0) + " punch-in(s).";
    if (noRoom) n += " " + noRoom + " had no free audio track — add an empty one.";
    return n;
}

elSfxPick.addEventListener("click", function () { pickSfx(); });
elSfx.addEventListener("click", function () { sfxAtCuts(sfxFile()); });
showSfx();
elNormalize.addEventListener("click", normalizeSelected);

elSort.addEventListener("click", function () {
    elSort.disabled = true;
    setStatus("Sorting project items…");
    cs.evalScript("ytSortProject()", function (res) {
        elSort.disabled = false;
        res = res || "Sort failed: no response from " + hostApp + ".";
        setStatus(res, /failed/i.test(res) ? "err" : "ok");
    });
});

/* Install commands are long and Premiere swallows Cmd/Ctrl+C, so the only
   practical way to get one out of the panel is a copy button. */
Array.prototype.forEach.call(document.querySelectorAll(".ins-copy"), function (btn) {
    btn.addEventListener("click", function () {
        writeClipboard(document.getElementById(btn.getAttribute("data-target")).value);
        btn.textContent = "✔";
        setTimeout(function () { btn.textContent = "⧉"; }, 1200);
    });
});

elCopyCredit.addEventListener("click", function () {
    elCreditText.select();
    document.execCommand("copy");
    elCopyCredit.textContent = "✔ Copied!";
    setTimeout(function () { elCopyCredit.textContent = "⧉ Copy credit"; }, 1500);
});

elCancel.addEventListener("click", function () {
    if (currentProc) {
        try { currentProc.kill("SIGTERM"); } catch (e) {}
        setStatus("Cancelled.", "err");
        setBusy(false);
    }
});

elBtn.addEventListener("click", function () {
    var url = elUrl.value.trim();
    // yt-dlp supports ~1000 sites (YouTube, TikTok, Instagram, X, Vimeo, Twitch...) — just require a valid URL
    if (!/^https?:\/\/\S+\.\S+/.test(url)) {
        setStatus("Invalid link. Paste a video URL (YouTube, TikTok, Instagram…).", "err");
        return;
    }
    var opts = {
        mode: elModeAudio.checked ? "audio" : "video",
        section: elSection.checked,
        start: elTsStart.value.trim(),
        end: elTsEnd.value.trim()
    };
    if (opts.section) {
        if (opts.start && !validTimestamp(opts.start)) { setStatus("Invalid start timestamp (use MM:SS or HH:MM:SS).", "err"); return; }
        if (opts.end && !validTimestamp(opts.end)) { setStatus("Invalid end timestamp (use MM:SS or HH:MM:SS).", "err"); return; }
        if (!opts.start && !opts.end) { setStatus("Fill in at least one timestamp.", "err"); return; }
    }

    getProjectPath(function (projPath) {
        if (!projPath) {
            setStatus("No project open or the project is not saved. Save it first.", "err");
            return;
        }
        var outDir;
        try {
            outDir = ensureAssetsDir(path.dirname(projPath));
        } catch (e) {
            setStatus("Could not create the assets folder: " + e.message, "err");
            return;
        }
        setBusy(true);
        setStatus("Starting download…");

        runDownload(url, opts, outDir, function (err, filePath, credit) {
            if (err) {
                setBusy(false);
                setStatus("⚠ " + err, "err");
                showLog();
                return;
            }
            elProgressBar.style.width = "100%";
            setStatus("Importing into " + hostApp + "…");
            importIntoProject(filePath, function (res) {
                setBusy(false);
                if (res === "ok") {
                    setStatus("✔ Done: " + path.basename(filePath) + " — imported into the project.", "ok");
                } else if (importedOk(res)) {
                    setStatus("✔ Done: " + path.basename(filePath) + " — " + res, "ok");
                } else {
                    setStatus("Downloaded to assets, but import failed: " + res, "err");
                    showLog();
                }
                if (credit) {
                    elCreditText.value = credit;
                    elCredits.style.display = "block";
                }
                refreshProjectInfo();
            });
        });
    });
});

/* ---------- startup health check ----------
   ffprobe is easy to miss: yt-dlp only complains about it after a download has
   already finished, and the message ("ffprobe and ffmpeg not found") blames both.
   Run each tool up front instead — a binary built for the wrong CPU sits there on
   disk looking installed, so existing is not the same as working. */

function checkTools() {
    var tools = ["yt-dlp", "ffmpeg", "ffprobe"];
    var broken = [], pending = tools.length;

    tools.forEach(function (name) {
        var flag = name === "yt-dlp" ? "--version" : "-version";
        cp.execFile(findBinary(name), [flag], function (err) {
            if (err) broken.push(name);
            if (--pending > 0) return;
            if (!broken.length) return;
            setStatus(broken.join(" and ") + " missing or not working — re-run the install " +
                      "command under “Install on another machine” below.", "err");
        });
    });
}

refreshProjectInfo();
setInterval(refreshProjectInfo, 15000);
checkForUpdate();
checkTools();

/* ---------- tabs + collapsible tool cards ----------
   Which tab and which tools were open are remembered per machine, so the panel
   reopens the way it was left. */

(function () {
    var tabs = document.querySelectorAll(".tab"), panes = document.querySelectorAll(".pane");
    function show(name) {
        Array.prototype.forEach.call(tabs, function (t) {
            t.classList.toggle("active", t.getAttribute("data-tab") === name);
        });
        Array.prototype.forEach.call(panes, function (p) {
            p.classList.toggle("active", p.id === "pane-" + name);
        });
        try { localStorage.setItem("md.tab", name); } catch (e) {}
    }
    Array.prototype.forEach.call(tabs, function (t) {
        t.addEventListener("click", function () { show(t.getAttribute("data-tab")); });
    });
    var saved = "download";
    try { saved = localStorage.getItem("md.tab") || saved; } catch (e) {}
    if (!document.getElementById("pane-" + saved)) saved = "download";
    show(saved);

    Array.prototype.forEach.call(document.querySelectorAll("details.tool"), function (d) {
        var key = "md.open." + d.id;
        try {
            var v = localStorage.getItem(key);
            if (v !== null) d.open = v === "1";
        } catch (e2) {}
        d.addEventListener("toggle", function () {
            try { localStorage.setItem(key, d.open ? "1" : "0"); } catch (e3) {}
        });
    });
})();
