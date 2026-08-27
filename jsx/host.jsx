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

/* ---------- Rough Cut ---------- */

function ytGetSelectedClips() {
    if (ytIsAE()) return "[]";
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "[]";
        var result = [];
        var i, j, track, clip, fp;
        for (i = 0; i < seq.videoTracks.numTracks; i++) {
            track = seq.videoTracks[i];
            for (j = 0; j < track.clips.numItems; j++) {
                clip = track.clips[j];
                try {
                    if (!clip.selected) continue;
                    fp = clip.projectItem.getMediaPath();
                    if (!fp) continue;
                    result.push({
                        filePath: fp,
                        seqStart:  clip.start.seconds,
                        seqEnd:    clip.end.seconds,
                        inPoint:   clip.inPoint.seconds,
                        outPoint:  clip.outPoint.seconds,
                        videoTrackIndex: i
                    });
                } catch (e) {}
            }
        }
        return JSON.stringify(result);
    } catch (e2) { return "[]"; }
}

function ytApplyRoughCut(dataJson) {
    if (ytIsAE()) return "Rough Cut is only available in Premiere Pro.";
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "No active sequence.";

        var data = eval("(" + dataJson + ")");
        var silences = data.silences;
        var clips    = data.clips;

        if (!silences || !silences.length) return "No silence detected — nothing to cut.";
        if (!clips    || !clips.length)    return "No clip data received.";

        // Which video track indices hold the selected clips
        var trackSet = {};
        var ci, si;
        for (ci = 0; ci < clips.length; ci++) trackSet[clips[ci].videoTrackIndex] = true;

        // Map source-file silence intervals to sequence time for each selected clip
        var cutIntervals = [];
        var clip, sil, srcIn, srcOut, seqIn, seqOut;
        for (ci = 0; ci < clips.length; ci++) {
            clip = clips[ci];
            for (si = 0; si < silences.length; si++) {
                sil    = silences[si];
                srcIn  = Math.max(sil.start, clip.inPoint);
                srcOut = Math.min(sil.end,   clip.outPoint);
                if (srcOut - srcIn < 0.05) continue; // skip trivially short silences
                seqIn  = clip.seqStart + (srcIn  - clip.inPoint);
                seqOut = clip.seqStart + (srcOut - clip.inPoint);
                seqIn  = Math.max(seqIn,  clip.seqStart);
                seqOut = Math.min(seqOut, clip.seqEnd);
                if (seqOut - seqIn < 0.05) continue;
                cutIntervals.push({ start: seqIn, end: seqOut });
            }
        }
        if (!cutIntervals.length) return "No silence found within the selected clip's range.";

        // Razor-cut the involved video + audio tracks at every silence boundary
        var i, j, t;
        var targetTracks = [];
        for (i = 0; i < seq.videoTracks.numTracks; i++) {
            if (trackSet[i]) targetTracks.push(seq.videoTracks[i]);
        }
        for (i = 0; i < seq.audioTracks.numTracks; i++) {
            if (trackSet[i]) targetTracks.push(seq.audioTracks[i]);
        }

        for (i = 0; i < cutIntervals.length; i++) {
            t = new Time(); t.seconds = cutIntervals[i].start;
            try { seq.razorAtTime(t, targetTracks); } catch (re) {}
            t = new Time(); t.seconds = cutIntervals[i].end;
            try { seq.razorAtTime(t, targetTracks); } catch (re) {}
        }

        // Identify clips that now fall entirely inside a silence zone
        function inSilenceZone(cs, ce) {
            for (var k = 0; k < cutIntervals.length; k++) {
                if (cs >= cutIntervals[k].start - 0.02 && ce <= cutIntervals[k].end + 0.02) return true;
            }
            return false;
        }

        var toRemove = [];
        var track, clip2;
        for (i = 0; i < seq.videoTracks.numTracks; i++) {
            if (!trackSet[i]) continue;
            track = seq.videoTracks[i];
            for (j = 0; j < track.clips.numItems; j++) {
                clip2 = track.clips[j];
                try { if (inSilenceZone(clip2.start.seconds, clip2.end.seconds)) toRemove.push(clip2); } catch (e) {}
            }
        }
        for (i = 0; i < seq.audioTracks.numTracks; i++) {
            if (!trackSet[i]) continue;
            track = seq.audioTracks[i];
            for (j = 0; j < track.clips.numItems; j++) {
                clip2 = track.clips[j];
                try { if (inSilenceZone(clip2.start.seconds, clip2.end.seconds)) toRemove.push(clip2); } catch (e) {}
            }
        }

        var removed = 0;
        // remove(ripple=false, alignToVideo=false) — leaves gaps so nothing else shifts
        for (i = 0; i < toRemove.length; i++) {
            try { toRemove[i].remove(false, false); removed++; } catch (e) {}
        }

        return "✔ Rough cut: removed " + removed + " silent segment(s) from " +
               cutIntervals.length + " silence interval(s). Gaps left in place — use Edit > Ripple Delete to close them.";
    } catch (e) {
        return "Rough cut failed: " + String(e);
    }
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
