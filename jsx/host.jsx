/* Host ExtendScript for Media Downloader — Premiere Pro + After Effects */

function ytIsAE() {
    try {
        if (typeof BridgeTalk !== "undefined" && BridgeTalk.appName &&
            BridgeTalk.appName.toLowerCase().indexOf("aftereffects") !== -1) {
            return true;
        }
    } catch (e) {}
    try {
        // feature-detect: AE has rootFolder, Premiere has rootItem
        return app.project && app.project.rootFolder !== undefined;
    } catch (e2) {}
    return false;
}

function ytGetProjectPath() {
    try {
        if (ytIsAE()) {
            if (app.project && app.project.file) return app.project.file.fsName;
        } else {
            if (app.project && app.project.path) return app.project.path;
        }
    } catch (e) {}
    return "";
}

function ytImport(filePath, insertAtPlayhead) {
    try {
        var f = new File(filePath);
        if (!f.exists) return "File does not exist: " + filePath;
        return ytIsAE() ? ytImportAE(f, insertAtPlayhead) : ytImportPPro(filePath, insertAtPlayhead);
    } catch (e) {
        return String(e);
    }
}

/* ---------- Premiere Pro ---------- */

function ytImportPPro(filePath, insertAtPlayhead) {
    var targetBin = null;
    try {
        // look for an "assets" bin in the project root; create it if missing
        var root = app.project.rootItem;
        for (var i = 0; i < root.children.numItems; i++) {
            var item = root.children[i];
            if (item.type === ProjectItemType.BIN && item.name.toLowerCase() === "assets") {
                targetBin = item;
                break;
            }
        }
        if (!targetBin) targetBin = root.createBin("assets");
    } catch (e) {
        targetBin = app.project.rootItem;
    }

    var ok = app.project.importFiles([filePath], true, targetBin, false);
    if (!ok) return "importFiles failed";
    if (!insertAtPlayhead) return "ok";

    var item2 = ytFindInBinByPath(targetBin, filePath);
    if (!item2) return "imported, but could not locate the item to insert";
    return ytInsertPPro(item2, filePath);
}

function ytFindInBinByPath(bin, p) {
    for (var i = 0; i < bin.children.numItems; i++) {
        var it = bin.children[i];
        try {
            if (it.type !== ProjectItemType.BIN && it.getMediaPath() === p) return it;
        } catch (e) {}
    }
    return null;
}

function ytInsertPPro(item, filePath) {
    var seq = app.project.activeSequence;
    if (!seq) return "imported (no active sequence — nothing inserted)";
    var t;
    try { t = seq.getPlayerPosition(); } catch (e) { return "imported, but could not read the playhead: " + String(e); }

    var isAudio = ytExtCategory(filePath) === "Audio";
    var tracks = isAudio ? seq.audioTracks : seq.videoTracks;
    var track = null;
    for (var i = 0; i < tracks.numTracks; i++) {
        var locked = false;
        try { locked = tracks[i].isLocked(); } catch (e2) {}
        if (!locked) { track = tracks[i]; break; }
    }
    if (!track) return "imported (all tracks are locked — nothing inserted)";

    try {
        track.insertClip(item, t.ticks);
        return "ok";
    } catch (e3) {
        return "imported, but insert at playhead failed: " + String(e3);
    }
}

/* ---------- After Effects ---------- */

function ytImportAE(f, insertAtPlayhead) {
    var folder = null;
    try {
        // look for an "assets" folder in the project root; create it if missing
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof FolderItem &&
                item.name.toLowerCase() === "assets" &&
                item.parentFolder === app.project.rootFolder) {
                folder = item;
                break;
            }
        }
        if (!folder) folder = app.project.items.addFolder("assets");
    } catch (e) {}

    var imported = app.project.importFile(new ImportOptions(f));
    if (folder) imported.parentFolder = folder;
    if (!insertAtPlayhead) return "ok";

    var comp = app.project.activeItem;
    if (!(comp && comp instanceof CompItem)) return "imported (open a comp to insert at the playhead)";
    try {
        var layer = comp.layers.add(imported);
        layer.startTime = comp.time;
        return "ok";
    } catch (e2) {
        return "imported, but insert at playhead failed: " + String(e2);
    }
}

/* ---------- Rough Cut + Normalize ---------- */

/* ExtendScript is ES3 and has no JSON object of its own */
function ytStr(v) {
    if (v === null || v === undefined) return "null";
    var t = typeof v, i, a;
    if (t === "number") return isFinite(v) ? String(v) : "null";
    if (t === "boolean") return v ? "true" : "false";
    if (t === "string") {
        return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
                      .replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + '"';
    }
    if (v instanceof Array) {
        a = [];
        for (i = 0; i < v.length; i++) a.push(ytStr(v[i]));
        return "[" + a.join(",") + "]";
    }
    a = [];
    for (var k in v) if (v.hasOwnProperty(k)) a.push(ytStr(k) + ":" + ytStr(v[k]));
    return "{" + a.join(",") + "}";
}

function ytSelected(c) {
    try { return (typeof c.isSelected === "function") ? c.isSelected() : !!c.selected; }
    catch (e) { return false; }
}

function ytGetSelectedClips() {
    if (ytIsAE()) return ytStr({ error: "This only works in Premiere Pro." });
    try {
        var seq = app.project.activeSequence;
        if (!seq) return ytStr({ error: "Open a sequence first." });
        var items = [], skipped = 0, unlinked = 0;

        function scan(tracks, kind) {
            for (var ti = 0; ti < tracks.numTracks; ti++) {
                var clips = tracks[ti].clips;
                for (var ci = 0; ci < clips.numItems; ci++) {
                    var c = clips[ci];
                    if (!ytSelected(c)) continue;
                    var fp = "";
                    try { fp = c.projectItem ? c.projectItem.getMediaPath() : ""; } catch (e) {}
                    if (!fp) { skipped++; continue; } // titles, nested sequences, adjustment layers

                    // a linked partner left unselected would fall out of sync once gaps close
                    try {
                        var li = c.getLinkedItems ? c.getLinkedItems() : null;
                        for (var q = 0; li && q < li.numItems; q++) if (!ytSelected(li[q])) unlinked++;
                    } catch (e2) {}

                    var speed = 1, reversed = false;
                    try { speed = c.getSpeed() || 1; } catch (e3) {}
                    try { reversed = c.isSpeedReversed() ? true : false; } catch (e4) {}

                    items.push({
                        kind: kind, track: ti, filePath: fp,
                        seqStart: c.start.seconds, seqEnd: c.end.seconds,
                        inPoint: c.inPoint.seconds, outPoint: c.outPoint.seconds,
                        speed: Math.abs(speed), reversed: reversed
                    });
                }
            }
        }
        scan(seq.videoTracks, "video");
        scan(seq.audioTracks, "audio");

        var frame = 1 / 25;
        try { frame = seq.getSettings().videoFrameRate.seconds || frame; } catch (e5) {}
        return ytStr({ items: items, skipped: skipped, unlinked: unlinked, frame: frame });
    } catch (err) {
        return ytStr({ error: "Could not read the selection: " + err });
    }
}

/* Volume > Level of an audio track item; the first "Volume" component, not Channel Volume */
function ytVolumeLevel(clip) {
    var comps = clip.components;
    for (var i = 0; i < comps.numItems; i++) {
        var c = comps[i], mn = String(c.matchName || ""), dn = String(c.displayName || "");
        if (/channel/i.test(mn) || !(/volume/i.test(mn) || /^vol/i.test(dn))) continue;
        for (var j = 0; j < c.properties.numItems; j++) {
            if (/level|nivel|pegel|niveau/i.test(String(c.properties[j].displayName))) return c.properties[j];
        }
        if (c.properties.numItems > 1) return c.properties[1]; // [0] is Bypass
    }
    return null;
}

function ytSetClipGain(json) {
    if (ytIsAE()) return ytStr({ error: "Normalize is only available in Premiere Pro." });
    try {
        var seq = app.project.activeSequence;
        if (!seq) return ytStr({ error: "No active sequence." });
        var list = eval("(" + json + ")"), done = 0, failed = 0, capped = 0;
        for (var i = 0; i < list.length; i++) {
            var g = list[i], tr = seq.audioTracks[g.track], clip = null;
            for (var j = 0; tr && j < tr.clips.numItems; j++) {
                if (Math.abs(tr.clips[j].start.seconds - g.seqStart) < 0.01) { clip = tr.clips[j]; break; }
            }
            var prop = clip ? ytVolumeLevel(clip) : null;
            if (!prop) { failed++; continue; }
            var db = g.gain;
            if (db > 15) { db = 15; capped++; }
            // Premiere keeps Level as linear gain scaled so that 1.0 = +15 dB (its maximum)
            try { prop.setValue(Math.pow(10, (db - 15) / 20), true); done++; } catch (e) { failed++; }
        }
        return ytStr({ done: done, failed: failed, capped: capped });
    } catch (err) {
        return ytStr({ error: "Normalize failed: " + err });
    }
}

/* cuts: frame-aligned [{s, e}] in sequence seconds, ascending.
   video/audio: indices of the tracks holding the selection. */
function ytApplyRoughCut(dataJson) {
    if (ytIsAE()) return ytStr({ error: "Rough Cut is only available in Premiere Pro." });
    try {
        var seq = app.project.activeSequence;
        if (!seq) return ytStr({ error: "No active sequence." });
        var d = eval("(" + dataJson + ")");
        var tol = d.frame * 0.5 + 0.0005;
        var i, j, k;

        function targetTracks() {
            var s = app.project.activeSequence, out = [], n;
            for (n = 0; n < d.video.length; n++) out.push({ t: s.videoTracks[d.video[n]], v: true, idx: d.video[n] });
            for (n = 0; n < d.audio.length; n++) out.push({ t: s.audioTracks[d.audio[n]], v: false, idx: d.audio[n] });
            return out;
        }
        var tracks = targetTracks();

        // 1. Only cut where every target track holds nothing or selected material —
        //    otherwise closing the gap would drag unselected clips along or split them.
        var cuts = [], skipped = 0;
        for (k = 0; k < d.cuts.length; k++) {
            var c = d.cuts[k], ok = true;
            for (i = 0; i < tracks.length && ok; i++) {
                var cl = tracks[i].t.clips;
                for (j = 0; j < cl.numItems; j++) {
                    var it = cl[j];
                    if (it.end.seconds <= c.s + tol || it.start.seconds >= c.e - tol) continue;
                    if (!ytSelected(it)) { ok = false; break; }
                }
            }
            if (ok) cuts.push(c); else skipped++;
        }
        if (!cuts.length) {
            return ytStr({ error: "Every silent section overlaps unselected clips on the same tracks — select those too." });
        }

        // 2. Backup: the original stays the active sequence, an untouched copy lands in the project.
        var backup = "", id = seq.sequenceID, name = seq.name;
        try {
            if (seq.clone()) backup = name + " Copy";
            if (app.project.activeSequence.sequenceID !== id) app.project.openSequence(id);
        } catch (eB) {}
        seq = app.project.activeSequence;
        tracks = targetTracks();

        // 3. Razor. The QE DOM is the only razor Premiere exposes to scripts; it takes
        //    a timecode string, so every cut edge is already frame-aligned by the panel.
        app.enableQE();
        var qs = qe.project.getActiveSequence();
        var st = seq.getSettings();
        var zp = 0;
        try { zp = parseFloat(seq.zeroPoint) / 254016000000; } catch (eZ) {}

        function razorAll(sec, offset) {
            var t = new Time();
            t.seconds = sec + offset;
            var code = t.getFormatted(st.videoFrameRate, st.videoDisplayFormat);
            for (var n = 0; n < tracks.length; n++) {
                try {
                    (tracks[n].v ? qs.getVideoTrackAt(tracks[n].idx) : qs.getAudioTrackAt(tracks[n].idx)).razor(code);
                } catch (eR) {}
            }
        }
        function edgeAt(sec) {
            for (var n = 0; n < tracks.length; n++) {
                var cc = tracks[n].t.clips;
                for (var m = 0; m < cc.numItems; m++) {
                    if (Math.abs(cc[m].start.seconds - sec) < tol || Math.abs(cc[m].end.seconds - sec) < tol) return true;
                }
            }
            return false;
        }

        // Whether razor() wants timecode relative to the sequence's start timecode is not
        // documented; try it, and if the first edge didn't land, fall back to plain time.
        razorAll(cuts[0].s, zp);
        if (zp && !edgeAt(cuts[0].s)) { zp = 0; razorAll(cuts[0].s, 0); }
        razorAll(cuts[0].e, zp);
        for (k = 1; k < cuts.length; k++) { razorAll(cuts[k].s, zp); razorAll(cuts[k].e, zp); }

        // 4. Remove the silent pieces. A cut only counts if every overlapping piece on
        //    every target track now sits fully inside it — a razor that missed one track
        //    would otherwise leave that track out of step with the rest.
        var removed = 0, missed = 0, applied = [];
        for (k = 0; k < cuts.length; k++) {
            var cut = cuts[k], batch = [], bad = false;
            for (i = 0; i < tracks.length && !bad; i++) {
                var cl2 = tracks[i].t.clips;
                for (j = 0; j < cl2.numItems; j++) {
                    var p = cl2[j], ps = p.start.seconds, pe = p.end.seconds;
                    if (pe <= cut.s + tol || ps >= cut.e - tol) continue;
                    if (ps >= cut.s - tol && pe <= cut.e + tol) batch.push(p); else { bad = true; break; }
                }
            }
            if (bad || !batch.length) { missed++; continue; }
            for (j = 0; j < batch.length; j++) {
                try { batch[j].remove(false, false); removed++; } catch (eX) {}
            }
            applied.push(cut);
        }

        // Punch-in has to happen before the gaps close: the pieces are found by the
        // positions the selected clips had, and the TrackItem refs stay valid after moving.
        var punched = 0, pairs = [];
        if (d.punch && d.ranges && applied.length) {
            for (i = 0; i < d.video.length; i++) {
                var vt = seq.videoTracks[d.video[i]], pieces = [];
                for (j = 0; j < vt.clips.numItems; j++) {
                    var pc = vt.clips[j];
                    for (var r = 0; r < d.ranges.length; r++) {
                        var rg = d.ranges[r];
                        if (rg.track === d.video[i] && pc.start.seconds >= rg.s - tol && pc.end.seconds <= rg.e + tol) {
                            pieces.push(pc);
                            break;
                        }
                    }
                }
                punched += ytPunchPieces(pieces, d.punch, pairs);
            }
        }

        var saved = 0;
        for (k = 0; k < applied.length; k++) saved += applied[k].e - applied[k].s;
        var closed = d.close && applied.length ? ytCloseGaps(tracks, applied, tol) : false;

        // read the punch-in points only now: the pieces have moved, their refs followed
        var sfx = { placed: 0, noRoom: 0, points: 0 };
        if (d.sfx && pairs.length) sfx = ytPlaceSfx(seq, d.sfx, ytZoomInPoints(pairs, tol), tol);
        if (sfx.error) return ytStr({ error: sfx.error });

        return ytStr({ applied: applied.length, removed: removed, skipped: skipped, missed: missed,
                       saved: saved, closed: closed, backup: backup, punched: punched,
                       sfxPlaced: sfx.placed, sfxNoRoom: sfx.noRoom });
    } catch (err) {
        return ytStr({ error: "Rough cut failed: " + err });
    }
}

/* Motion > Scale of a video track item. Display names are localized, so match the
   component by matchName first; Scale is property [1] after Position. */
function ytMotionScale(clip) {
    var comps = clip.components;
    for (var i = 0; i < comps.numItems; i++) {
        var c = comps[i];
        if (!/motion/i.test(String(c.matchName || "")) &&
            !/^(motion|mi[sș]care|bewegung|trajectoire|movimiento)/i.test(String(c.displayName || ""))) continue;
        for (var j = 0; j < c.properties.numItems; j++) {
            if (/^(scale|scar[aă]|scalare|skalierung|[ée]chelle|escala)$/i.test(String(c.properties[j].displayName))) {
                return c.properties[j];
            }
        }
        if (c.properties.numItems > 1) return c.properties[1];
    }
    return null;
}

/* Every second piece is scaled up relative to the piece before it, so the edit
   alternates wide / close. Measuring from the preceding (un-zoomed) piece rather
   than the clip's own value keeps it right for footage that isn't at 100% to begin
   with, and makes a second run a no-op instead of zooming further. Keyframed
   Scale is left alone — overwriting it would destroy an animation.
   If `pairs` is given, each (previous piece, zoomed piece) is added to it — the
   join between them is where the picture punches in. */
function ytPunchPieces(pieces, zoom, pairs) {
    pieces.sort(function (a, b) { return a.start.seconds - b.start.seconds; });
    var base = null, done = 0;
    for (var i = 0; i < pieces.length; i++) {
        var p = ytMotionScale(pieces[i]);
        if (!p) continue;
        try { if (p.isTimeVarying()) continue; } catch (e) {}
        if (i % 2 === 0) { base = p.getValue(); continue; }
        if (base === null) continue;
        try {
            p.setValue(base * zoom / 100, true);
            done++;
            if (pairs) pairs.push({ a: pieces[i - 1], b: pieces[i] });
        } catch (e2) {}
    }
    return done;
}

/* Joins where the picture punches in — only where the two pieces actually touch */
function ytZoomInPoints(pairs, tol) {
    var pts = [];
    for (var i = 0; i < pairs.length; i++) {
        var t = pairs[i].b.start.seconds;
        if (Math.abs(pairs[i].a.end.seconds - t) < tol) pts.push(t);
    }
    pts.sort(function (x, y) { return x - y; });
    return pts;
}

/* d: { zoom, sfx: null | { file, dur, align } } */
function ytPunchIn(json) {
    if (ytIsAE()) return ytStr({ error: "Punch-in is only available in Premiere Pro." });
    try {
        var seq = app.project.activeSequence;
        if (!seq) return ytStr({ error: "No active sequence." });
        var d = eval("(" + json + ")"), zoom = d.zoom;
        var frame = 1 / 25;
        try { frame = seq.getSettings().videoFrameRate.seconds || frame; } catch (eF) {}
        var done = 0, seen = 0, pairs = [];
        for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            var cl = seq.videoTracks[t].clips, pieces = [];
            for (var j = 0; j < cl.numItems; j++) if (ytSelected(cl[j])) pieces.push(cl[j]);
            seen += pieces.length;
            if (pieces.length > 1) done += ytPunchPieces(pieces, zoom, pairs);
        }
        if (!seen) return ytStr({ error: "Select the video clips to punch in on." });
        if (seen === 1) return ytStr({ error: "Select at least two clips — punch-in alternates between them." });
        var sfx = { placed: 0, noRoom: 0, points: 0 };
        if (d.sfx && pairs.length) sfx = ytPlaceSfx(seq, d.sfx, ytZoomInPoints(pairs, frame * 0.5 + 0.0005), frame * 0.5 + 0.0005);
        if (sfx.error) return ytStr({ error: sfx.error });
        return ytStr({ done: done, seen: seen, sfxPlaced: sfx.placed, sfxNoRoom: sfx.noRoom, sfxPoints: sfx.points });
    } catch (err) {
        return ytStr({ error: "Punch-in failed: " + err });
    }
}

/* ---------- Dynamic Zoom (DaVinci-style slow push in / pull out) ---------- */

/* The un-zoomed scale of a clip. If Scale is already animated — typically by an
   earlier Dynamic Zoom — the smallest keyed value is the wide one, so running it
   again replaces the old animation instead of zooming from an already-zoomed frame. */
function ytBaseScale(p) {
    try {
        if (p.isTimeVarying()) {
            var keys = p.getKeys(), lo = null;
            for (var i = 0; keys && i < keys.length; i++) {
                var v = p.getValueAtKey(keys[i]);
                if (lo === null || v < lo) lo = v;
            }
            if (lo !== null) return lo;
        }
    } catch (e) {}
    return p.getValue();
}

/* Two Scale keyframes, first and last frame of the clip. Keyframe times on a track
   item are in source-media time, i.e. counted from the media start like inPoint —
   not sequence time — and a speed change stretches that range. */
function ytKeyScale(p, clip, from, to, ease, frame) {
    var speed = 1;
    try { speed = Math.abs(clip.getSpeed()) || 1; } catch (e) {}
    var dur = clip.end.seconds - clip.start.seconds;
    if (dur < frame * 2) return false;

    var t0 = new Time(), t1 = new Time(), tm = new Time();
    t0.seconds = clip.inPoint.seconds;
    t1.seconds = clip.inPoint.seconds + (dur - frame) * speed;
    tm.seconds = (t0.seconds + t1.seconds) / 2;
    try {
        p.setTimeVarying(false);   // drops any earlier keyframes
        p.setTimeVarying(true);
        p.addKey(t0);
        p.setValueAtKey(t0, from, true);
        p.addKey(t1);
        p.setValueAtKey(t1, to, true);
        if (ease) {
            // 5 = Bezier: eases out of the first key and into the last
            try { p.setInterpolationTypeAtKey(t0, 5, true); p.setInterpolationTypeAtKey(t1, 5, true); } catch (eI) {}
        }
        var mid = p.getValueAtTime(tm);
        return mid > Math.min(from, to) + 0.001 && mid < Math.max(from, to) - 0.001;
    } catch (err) {
        return false;
    }
}

function ytDynamicZoom(json) {
    if (ytIsAE()) return ytStr({ error: "Dynamic Zoom is only available in Premiere Pro." });
    try {
        var seq = app.project.activeSequence;
        if (!seq) return ytStr({ error: "No active sequence." });
        var d = eval("(" + json + ")");
        var frame = 1 / 25;
        try { frame = seq.getSettings().videoFrameRate.seconds || frame; } catch (eF) {}

        var clips = [];
        for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            var cl = seq.videoTracks[t].clips;
            for (var j = 0; j < cl.numItems; j++) if (ytSelected(cl[j])) clips.push(cl[j]);
        }
        if (!clips.length) return ytStr({ error: "Select the video clips to animate." });
        // "alternate" follows the order they play in, whatever track they're on
        clips.sort(function (a, b) { return a.start.seconds - b.start.seconds; });

        var done = 0, failed = 0;
        for (var n = 0; n < clips.length; n++) {
            var p = ytMotionScale(clips[n]);
            if (!p) { failed++; continue; }
            var base = ytBaseScale(p), zoomed = base * d.amount / 100;
            var zoomIn = d.dir === "in" || (d.dir === "alt" && n % 2 === 0);
            if (ytKeyScale(p, clips[n], zoomIn ? base : zoomed, zoomIn ? zoomed : base, d.ease, frame)) {
                done++;
            } else {
                // leave nothing half-made behind
                try { p.setTimeVarying(false); p.setValue(base, true); } catch (eR) {}
                failed++;
            }
        }
        return ytStr({ done: done, failed: failed, seen: clips.length });
    } catch (err) {
        return ytStr({ error: "Dynamic Zoom failed: " + err });
    }
}

/* ---------- SFX at cuts ---------- */

/* d: { file, dur (seconds, measured by the panel), align: "center" | "start" | "end" }
   A cut is any point where one selected clip ends and the next one starts. */
function ytSfxAtCuts(json) {
    if (ytIsAE()) return ytStr({ error: "SFX at cuts is only available in Premiere Pro." });
    try {
        var seq = app.project.activeSequence;
        if (!seq) return ytStr({ error: "No active sequence." });
        var d = eval("(" + json + ")");
        var frame = 1 / 25;
        try { frame = seq.getSettings().videoFrameRate.seconds || frame; } catch (eF) {}
        var tol = frame * 0.5 + 0.0005, i, j;

        // video clips define the cuts; audio only if no video is selected at all
        function selectedOn(tracks) {
            var out = [];
            for (var t = 0; t < tracks.numTracks; t++) {
                var cl = tracks[t].clips;
                for (var k = 0; k < cl.numItems; k++) {
                    if (ytSelected(cl[k])) out.push({ s: cl[k].start.seconds, e: cl[k].end.seconds });
                }
            }
            return out;
        }
        var clips = selectedOn(seq.videoTracks);
        if (!clips.length) clips = selectedOn(seq.audioTracks);
        clips.sort(function (a, b) { return a.s - b.s; });

        var points = [];
        for (i = 1; i < clips.length; i++) {
            var t = clips[i].s;
            if (Math.abs(clips[i - 1].e - t) > tol) continue;   // a gap, not a cut
            if (points.length && Math.abs(points[points.length - 1] - t) < tol) continue;
            points.push(t);
        }
        if (!points.length) return ytStr({ error: "Select two or more clips that meet at a cut." });
        return ytStr(ytPlaceSfx(seq, d, points, tol));
    } catch (err) {
        return ytStr({ error: "SFX at cuts failed: " + err });
    }
}

/* Put the sound d.file (d.dur seconds long) at each point, aligned per d.align. */
function ytPlaceSfx(seq, d, points, tol) {
    var i, j;
    try {
        // import once, into an SFX bin; reuse it if it's already in the project
        var bin = ytFindOrCreateBinPPro("SFX");
        var item = ytFindInBinByPath(bin, d.file);
        if (!item) {
            app.project.importFiles([d.file], true, bin, false);
            item = ytFindInBinByPath(bin, d.file);
        }
        if (!item) return { error: "Could not import the sound into the project." };

        var lead = d.align === "start" ? 0 : d.align === "end" ? d.dur : d.dur / 2;
        var at = seq.audioTracks, placed = 0, noRoom = 0;

        for (i = 0; i < points.length; i++) {
            var st = Math.max(0, points[i] - lead), en = st + d.dur, track = null;
            // first unlocked audio track with nothing in [st, en): the sound must not
            // cover dialogue, and overwrite would otherwise eat whatever is there
            for (j = 0; j < at.numTracks && !track; j++) {
                var locked = false;
                try { locked = at[j].isLocked(); } catch (eL) {}
                if (locked) continue;
                var free = true, cl2 = at[j].clips;
                for (var k2 = 0; k2 < cl2.numItems && free; k2++) {
                    if (cl2[k2].start.seconds < en - tol && cl2[k2].end.seconds > st + tol) free = false;
                }
                if (free) track = at[j];
            }
            if (!track) { noRoom++; continue; }
            var tm = new Time();
            tm.seconds = st;
            // overwrite, not insert: insertClip would push everything after it along
            try { track.overwriteClip(item, tm.ticks); placed++; } catch (eO) { noRoom++; }
        }
        return { placed: placed, noRoom: noRoom, points: points.length };
    } catch (err) {
        return { error: "Placing the sound failed: " + err };
    }
}

/* Slide everything after each removed section left, on the target tracks only.
   Done by hand rather than with ripple-delete because the API's ripple behaviour
   across linked, multi-track selections isn't documented; this way every track
   moves by exactly the same amount and stays in sync. */
function ytCloseGaps(tracks, cuts, tol) {
    function shiftAt(t) {
        var s = 0;
        for (var k = 0; k < cuts.length; k++) if (cuts[k].e <= t + tol) s += cuts[k].e - cuts[k].s;
        return s;
    }
    var plan = [], i, j;
    for (i = 0; i < tracks.length; i++) {
        var cl = tracks[i].t.clips;
        for (j = 0; j < cl.numItems; j++) {
            var st = cl[j].start.seconds, sh = shiftAt(st);
            if (sh > tol) plan.push({ ti: i, j: j, target: st - sh });
        }
    }
    // Leftmost destination first, so nothing is ever moved onto a clip that hasn't
    // moved yet. Each move aims at an absolute target: moving a clip may drag its
    // linked partner along, and then the partner's own turn is simply a no-op.
    plan.sort(function (a, b) { return a.target - b.target; });
    for (i = 0; i < plan.length; i++) {
        var it = tracks[plan[i].ti].t.clips[plan[i].j];
        if (!it) continue;
        var delta = plan[i].target - it.start.seconds;
        if (Math.abs(delta) < tol) continue;
        var t = new Time();
        t.seconds = delta;
        try { it.move(t); } catch (e) {}
    }
    for (i = 0; i < plan.length; i++) {
        var it2 = tracks[plan[i].ti].t.clips[plan[i].j];
        if (!it2 || Math.abs(it2.start.seconds - plan[i].target) > tol) return false;
    }
    return true;
}

/* ---------- Sort project items into bins by type ---------- */

var YT_VIDEO_EXT = " mp4 mov mxf avi m4v webm mkv mts m2ts mpg mpeg wmv flv r3d braw crm ari ";
var YT_AUDIO_EXT = " wav mp3 m4a aac aiff aif flac ogg wma opus caf ";
var YT_IMAGE_EXT = " jpg jpeg png tif tiff psd gif bmp webp ai eps svg tga exr dpx heic heif ";

function ytExtCategory(p) {
    if (!p) return "Other";
    var ext = String(p).split(".").pop().toLowerCase();
    if (YT_VIDEO_EXT.indexOf(" " + ext + " ") !== -1) return "Videos";
    if (YT_AUDIO_EXT.indexOf(" " + ext + " ") !== -1) return "Audio";
    if (YT_IMAGE_EXT.indexOf(" " + ext + " ") !== -1) return "Images";
    return "Other";
}

function ytSortSummary(moved, counts) {
    if (!moved) return "Nothing to sort.";
    var parts = [];
    for (var k in counts) parts.push(counts[k] + " " + k);
    return "Sorted " + moved + " item(s): " + parts.join(", ") + ".";
}

function ytSortProject() {
    try {
        return ytIsAE() ? ytSortAE() : ytSortPPro();
    } catch (e) {
        return "Sort failed: " + String(e);
    }
}

/* --- Premiere Pro --- */

function ytFindOrCreateBinPPro(name) {
    var root = app.project.rootItem;
    for (var i = 0; i < root.children.numItems; i++) {
        var it = root.children[i];
        if (it.type === ProjectItemType.BIN && it.name.toLowerCase() === name.toLowerCase()) return it;
    }
    return root.createBin(name);
}

function ytCategoryPPro(item) {
    try {
        if (typeof item.isSequence === "function" && item.isSequence()) return "Sequences";
    } catch (e) {}
    var mp = "";
    try { mp = item.getMediaPath() || ""; } catch (e2) {}
    if (!mp) return "Other";
    return ytExtCategory(mp);
}

function ytSortPPro() {
    // sortable: loose items in the project root + everything inside the "assets" bin;
    // user-made bins are left untouched
    var root = app.project.rootItem;
    var items = [];
    var i, j;
    for (i = 0; i < root.children.numItems; i++) {
        var it = root.children[i];
        if (it.type === ProjectItemType.BIN) {
            if (it.name.toLowerCase() === "assets") {
                for (j = 0; j < it.children.numItems; j++) {
                    if (it.children[j].type !== ProjectItemType.BIN) items.push(it.children[j]);
                }
            }
            continue;
        }
        items.push(it);
    }
    if (!items.length) return "Nothing to sort.";

    var counts = {};
    var bins = {};
    var moved = 0;
    for (i = 0; i < items.length; i++) {
        var cat = ytCategoryPPro(items[i]);
        if (!bins[cat]) bins[cat] = ytFindOrCreateBinPPro(cat);
        try {
            items[i].moveBin(bins[cat]);
            moved++;
            counts[cat] = (counts[cat] || 0) + 1;
        } catch (e3) {}
    }
    return ytSortSummary(moved, counts);
}

/* --- After Effects --- */

function ytFindOrCreateFolderAE(name) {
    for (var i = 1; i <= app.project.numItems; i++) {
        var it = app.project.item(i);
        if (it instanceof FolderItem && it.parentFolder === app.project.rootFolder &&
            it.name.toLowerCase() === name.toLowerCase()) return it;
    }
    return app.project.items.addFolder(name);
}

function ytCategoryAE(item) {
    if (item instanceof CompItem) return "Comps";
    if (item instanceof FootageItem) {
        try {
            if (item.mainSource instanceof SolidSource) return ""; // leave solids alone
            if (item.mainSource instanceof FileSource) {
                if (item.mainSource.isStill) return "Images";
                if (item.hasAudio && !item.hasVideo) return "Audio";
                return "Videos";
            }
            if (item.hasAudio && !item.hasVideo) return "Audio";
        } catch (e) {}
        return "Other";
    }
    return ""; // folders etc. — skip
}

function ytSortAE() {
    var root = app.project.rootFolder;
    var items = [];
    var assetsFolder = null;
    var i;
    for (i = 1; i <= app.project.numItems; i++) {
        var it = app.project.item(i);
        if (it instanceof FolderItem) {
            if (it.parentFolder === root && it.name.toLowerCase() === "assets") assetsFolder = it;
            continue;
        }
        if (it.parentFolder === root) items.push(it);
    }
    if (assetsFolder) {
        for (i = 1; i <= app.project.numItems; i++) {
            var it2 = app.project.item(i);
            if (!(it2 instanceof FolderItem) && it2.parentFolder === assetsFolder) items.push(it2);
        }
    }
    if (!items.length) return "Nothing to sort.";

    var counts = {};
    var folders = {};
    var moved = 0;
    for (i = 0; i < items.length; i++) {
        var cat = ytCategoryAE(items[i]);
        if (!cat) continue;
        if (!folders[cat]) folders[cat] = ytFindOrCreateFolderAE(cat);
        try {
            items[i].parentFolder = folders[cat];
            moved++;
            counts[cat] = (counts[cat] || 0) + 1;
        } catch (e2) {}
    }
    return ytSortSummary(moved, counts);
}
