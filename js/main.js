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

/* ---------- Rough Cut ---------- */

function roughCut() {
    var ffmpeg = findBinary("ffmpeg");
    var threshold = (elRcThreshold.value || "-30").trim();
    var minDur = (elRcMinDur.value || "0.5").trim();
    // add "dB" suffix if the user typed a bare number like -30
    var noiseArg = /^-?\d+(\.\d+)?$/.test(threshold) ? threshold + "dB" : threshold;

    elRoughCut.disabled = true;
    setStatus("Getting selected clips…");

    cs.evalScript("ytGetSelectedClips()", function (res) {
        var clips;
        try { clips = JSON.parse(res || "[]"); } catch (e) { clips = []; }

        if (!clips.length) {
            elRoughCut.disabled = false;
            setStatus("Select a clip on the timeline first, then click Rough Cut.", "err");
            return;
        }

        var sourceFile = clips[0].filePath;
        if (!sourceFile || !fs.existsSync(sourceFile)) {
            elRoughCut.disabled = false;
            setStatus("Source file not found on disk — offline clips are not supported.", "err");
            return;
        }

        setStatus("Detecting silence in " + path.basename(sourceFile) + "…");
        elProgressWrap.style.display = "block";
        elProgressBar.style.width = "0%";

        var args = ["-hide_banner", "-i", sourceFile,
                    "-af", "silencedetect=noise=" + noiseArg + ":d=" + minDur,
                    "-f", "null", "-"];

        var proc = cp.spawn(ffmpeg, args);
        currentProc = proc;
        var output = "";
        var totalDur = 0;

        function onChunk(d) {
            var chunk = d.toString();
            output += chunk;
            // grab total duration once
            if (!totalDur) {
                var dm = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
                if (dm) totalDur = (+dm[1]) * 3600 + (+dm[2]) * 60 + (+dm[3]);
            }
            // show progress
            var tm = chunk.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
            if (tm && totalDur) {
                var cur = (+tm[1]) * 3600 + (+tm[2]) * 60 + (+tm[3]);
                elProgressBar.style.width = Math.min(99, Math.round(cur / totalDur * 100)) + "%";
            }
        }
        proc.stdout.on("data", onChunk);
        proc.stderr.on("data", onChunk);

        proc.on("error", function (err) {
            currentProc = null;
            elRoughCut.disabled = false;
            elProgressWrap.style.display = "none";
            setStatus("ffmpeg error: " + err.message, "err");
        });

        proc.on("close", function () {
            currentProc = null;
            elProgressWrap.style.display = "none";

            // parse silence_start / silence_end pairs from ffmpeg silencedetect output
            var silences = [];
            var reStart = /silence_start:\s*([\d.e+\-]+)/g;
            var reEnd   = /silence_end:\s*([\d.e+\-]+)/g;
            var starts = [], ends = [], m;
            while ((m = reStart.exec(output)) !== null) starts.push(parseFloat(m[1]));
            while ((m = reEnd.exec(output)) !== null)   ends.push(parseFloat(m[1]));
            for (var i = 0; i < starts.length; i++) {
                silences.push({ start: starts[i], end: i < ends.length ? ends[i] : 999999 });
            }

            if (!silences.length) {
                elRoughCut.disabled = false;
                setStatus("No silence detected (threshold " + noiseArg + ", min " + minDur + "s). Try a higher threshold (e.g. -25).", "ok");
                return;
            }

            setStatus("Found " + silences.length + " silent section(s) — applying cuts…");
            var dataJson = JSON.stringify({ silences: silences, clips: clips });
            cs.evalScript("ytApplyRoughCut(" + JSON.stringify(dataJson) + ")", function (result) {
                elRoughCut.disabled = false;
                if (!result || result === "undefined") result = "Rough cut complete.";
                var isErr = /failed|error|only available/i.test(result);
                setStatus(result, isErr ? "err" : "ok");
            });
        });
    });
}

elRoughCut.addEventListener("click", roughCut);

elSort.addEventListener("click", function () {
    elSort.disabled = true;
    setStatus("Sorting project items…");
    cs.evalScript("ytSortProject()", function (res) {
        elSort.disabled = false;
        res = res || "Sort failed: no response from " + hostApp + ".";
        setStatus(res, /failed/i.test(res) ? "err" : "ok");
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
   Check up front instead, and name the tool that is actually missing. */

function checkTools() {
    var tools = ["yt-dlp", "ffmpeg", "ffprobe"];
    var missing = [], pending = tools.length;

    tools.forEach(function (name) {
        var flag = name === "yt-dlp" ? "--version" : "-version";
        cp.execFile(findBinary(name), [flag], function (err) {
            if (err) missing.push(name);
            if (--pending > 0) return;
            if (!missing.length) return;
            setStatus("Missing: " + missing.join(", ") + ". Re-run the installer — see the README.", "err");
        });
    });
}

refreshProjectInfo();
setInterval(refreshProjectInfo, 15000);
checkForUpdate();
checkTools();
