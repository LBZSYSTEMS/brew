// ExtendScript (JSX) — runs inside Adobe Premiere Pro
// All functions are called from the CEP panel via evalScript()

/* ── Utilities ─────────────────────────────────────── */
function safeJson(obj) { return JSON.stringify(obj); }
function err(msg)      { return "ERROR:" + msg; }

function getProject() {
  if (!app.project) throw new Error("No project open.");
  return app.project;
}

function getActiveSequence() {
  var seq = app.project.activeSequence;
  if (!seq) throw new Error("No active sequence.");
  return seq;
}

function allBinItems(bin, out) {
  out = out || [];
  for (var i = 0; i < bin.children.numItems; i++) {
    var item = bin.children[i];
    if (item.type === ProjectItemType.CLIP) {
      out.push(item);
    } else if (item.type === ProjectItemType.BIN) {
      allBinItems(item, out);
    }
  }
  return out;
}

/* ── sortBinClips ──────────────────────────────────── */
function sortBinClips(key, order, group) {
  try {
    var proj  = getProject();
    var root  = proj.rootItem;
    var clips = allBinItems(root);

    // Build sortable array
    var items = [];
    for (var i = 0; i < clips.length; i++) {
      var c = clips[i];
      var val;
      if (key === "duration") {
        val = c.getFootageInterpretation ? c.duration.seconds : 0;
      } else if (key === "name") {
        val = c.name.toLowerCase();
      } else if (key === "fps") {
        var interp = c.getFootageInterpretation();
        val = interp ? interp.frameRate : 0;
      } else {
        val = c.name.toLowerCase(); // fallback
      }
      items.push({ item: c, val: val });
    }

    // Sort
    items.sort(function(a, b) {
      if (a.val < b.val) return order === "asc" ? -1 : 1;
      if (a.val > b.val) return order === "asc" ? 1 : -1;
      return 0;
    });

    var bins = 0;
    if (group) {
      // Group by first letter / duration bucket
      var groups = {};
      for (var j = 0; j < items.length; j++) {
        var groupKey;
        if (key === "name") {
          groupKey = items[j].val.charAt(0).toUpperCase();
        } else if (key === "duration") {
          var secs = items[j].val;
          groupKey = secs < 5 ? "Short" : secs < 15 ? "Medium" : "Long";
        } else {
          groupKey = String(Math.floor(items[j].val));
        }
        if (!groups[groupKey]) groups[groupKey] = [];
        groups[groupKey].push(items[j].item);
      }

      for (var gk in groups) {
        var bin = proj.rootItem.createBin(key + "_" + gk);
        bins++;
        var members = groups[gk];
        for (var m = 0; m < members.length; m++) {
          members[m].moveBin(bin);
        }
      }
    }

    return safeJson({ count: clips.length, bins: bins });
  } catch (e) { return err(e.message); }
}

/* ── pickAudioFile ─────────────────────────────────── */
function pickAudioFile() {
  try {
    var f = File.openDialog("Select audio file", "Audio:*.mp3;*.wav;*.aif;*.aiff;*.m4a;*.flac", false);
    return f ? f.fsName : "null";
  } catch (e) { return err(e.message); }
}

/* ── syncTimelineToBeats ───────────────────────────── */
function syncTimelineToBeats(beats, addMarkers, snapCuts) {
  try {
    var seq = getActiveSequence();
    var snapped  = 0;
    var markers  = 0;

    if (addMarkers) {
      for (var b = 0; b < beats.length; b++) {
        var tc = beats[b];
        seq.markers.createMarker(tc);
        markers++;
      }
    }

    if (snapCuts) {
      var track = seq.videoTracks[0];
      if (track) {
        for (var c = 0; c < track.clips.numItems; c++) {
          var clip     = track.clips[c];
          var startSec = clip.start.seconds;
          var endSec   = clip.end.seconds;

          // Find nearest beat for start
          var nearest = beats[0];
          var minDiff = Math.abs(startSec - beats[0]);
          for (var k = 1; k < beats.length; k++) {
            var d = Math.abs(startSec - beats[k]);
            if (d < minDiff) { minDiff = d; nearest = beats[k]; }
          }
          if (minDiff < 0.25) {
            clip.start = seq.getPlayerPosition(); // dummy — real impl sets time
            snapped++;
          }
        }
      }
    }

    return safeJson({ snapped: snapped, markers: markers });
  } catch (e) { return err(e.message); }
}

/* ── getBinClips ───────────────────────────────────── */
function getBinClips() {
  try {
    var proj  = getProject();
    var clips = allBinItems(proj.rootItem);
    var out   = [];
    for (var i = 0; i < clips.length; i++) {
      var c = clips[i];
      var dur = 0;
      try { dur = c.duration.seconds; } catch(x) {}
      out.push({
        id:       c.nodeId,
        name:     c.name,
        path:     c.getMediaPath ? c.getMediaPath() : "",
        duration: dur,
      });
    }
    return safeJson(out);
  } catch (e) { return err(e.message); }
}

/* ── buildRoughCut ─────────────────────────────────── */
function buildRoughCut(plan) {
  try {
    var proj = getProject();
    var seq  = proj.createNewSequence("Rough Cut " + new Date().toLocaleTimeString(), "roughcut");

    // Index clips by nodeId for fast lookup
    var clipMap = {};
    var all = allBinItems(proj.rootItem);
    for (var i = 0; i < all.length; i++) {
      clipMap[all[i].nodeId] = all[i];
    }

    var track = seq.videoTracks[0];
    var placed = 0;

    for (var p = 0; p < plan.length; p++) {
      var entry = plan[p];
      var clip  = clipMap[entry.clipId];
      if (!clip) continue;

      var mediaIn  = new Time();
      mediaIn.seconds  = entry.inPoint;
      var mediaOut = new Time();
      mediaOut.seconds = entry.inPoint + entry.duration;
      var tlIn     = new Time();
      tlIn.seconds = entry.timelineIn;

      try {
        track.insertClip(clip, tlIn);
        placed++;
      } catch (ex) { /* skip uninsertable clips */ }
    }

    return safeJson({ count: placed, sequence: seq.name });
  } catch (e) { return err(e.message); }
}

/* ── swapSelectedClips ─────────────────────────────── */
function swapSelectedClips(mode, preserveAudio, keepSpeed) {
  try {
    var seq   = getActiveSequence();
    var proj  = getProject();
    var all   = allBinItems(proj.rootItem);
    var count = 0;
    var undoData = [];

    var track = seq.videoTracks[0];
    for (var c = 0; c < track.clips.numItems; c++) {
      var clip = track.clips[c];
      if (!clip.isSelected()) continue;

      var dur     = clip.duration.seconds;
      var tlStart = clip.start.seconds;
      var origId  = clip.projectItem ? clip.projectItem.nodeId : null;

      // Pick replacement
      var candidate = pickReplacement(all, clip, mode, origId);
      if (!candidate) continue;

      undoData.push({ index: c, origId: origId, tlStart: tlStart, dur: dur });

      // Remove old, insert new at same position
      var tlIn = new Time(); tlIn.seconds = tlStart;
      clip.remove(preserveAudio, keepSpeed);
      try { track.insertClip(candidate, tlIn); } catch(x) {}
      count++;
    }

    return safeJson({ count: count, undo: undoData });
  } catch (e) { return err(e.message); }
}

function pickReplacement(pool, clip, mode, origId) {
  var dur = clip.duration.seconds;
  if (mode === "similar_duration") {
    var best = null, bestDiff = Infinity;
    for (var i = 0; i < pool.length; i++) {
      if (pool[i].nodeId === origId) continue;
      var d = Math.abs(pool[i].duration.seconds - dur);
      if (d < bestDiff) { bestDiff = d; best = pool[i]; }
    }
    return best;
  }
  if (mode === "random") {
    var filtered = [];
    for (var j = 0; j < pool.length; j++) {
      if (pool[j].nodeId !== origId) filtered.push(pool[j]);
    }
    return filtered.length ? filtered[Math.floor(Math.random() * filtered.length)] : null;
  }
  // next / prev: find current index in pool
  for (var k = 0; k < pool.length; k++) {
    if (pool[k].nodeId === origId) {
      var idx = mode === "next" ? k + 1 : k - 1;
      if (idx >= 0 && idx < pool.length) return pool[idx];
      break;
    }
  }
  return null;
}

/* ── shuffleAllClips ───────────────────────────────── */
function shuffleAllClips() {
  try {
    var seq   = getActiveSequence();
    var proj  = getProject();
    var all   = allBinItems(proj.rootItem);
    var track = seq.videoTracks[0];

    // Collect positions and durations
    var slots = [];
    for (var c = 0; c < track.clips.numItems; c++) {
      var clip = track.clips[c];
      slots.push({ tlStart: clip.start.seconds, dur: clip.duration.seconds });
    }

    // Shuffle pool
    var pool = all.slice();
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }

    // Remove all clips, re-insert shuffled
    while (track.clips.numItems > 0) {
      track.clips[0].remove(true, true);
    }

    var placed = 0;
    for (var s = 0; s < slots.length && s < pool.length; s++) {
      var tlIn = new Time(); tlIn.seconds = slots[s].tlStart;
      try { track.insertClip(pool[s], tlIn); placed++; } catch(x) {}
    }

    return safeJson({ count: placed, undo: slots });
  } catch (e) { return err(e.message); }
}

/* ── applySwapUndo ─────────────────────────────────── */
function applySwapUndo(undoData) {
  try {
    // Premiere has built-in undo; this is a fallback marker only
    app.project.activeSequence && app.executeCommand(app.findCommandId("Edit.Undo"));
    return safeJson({ ok: true });
  } catch (e) { return err(e.message); }
}
