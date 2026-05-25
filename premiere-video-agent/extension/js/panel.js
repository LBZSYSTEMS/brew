"use strict";

const cs = new CSInterface();
const BACKEND = "http://127.0.0.1:7720";

/* ── State ─────────────────────────────────────────── */
let beatData = null;   // { beats: [...seconds], bpm: number }
let swapHistory = [];  // for undo

/* ── Helpers ────────────────────────────────────────── */
function log(el, msg, cls = "") {
  const line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function evalScript(script) {
  return new Promise((resolve, reject) => {
    cs.evalScript(script, (result) => {
      if (result && result.startsWith("ERROR:")) reject(new Error(result.slice(6)));
      else resolve(result);
    });
  });
}

async function callBackend(path, body) {
  const res = await fetch(`${BACKEND}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Backend ${res.status}: ${await res.text()}`);
  return res.json();
}

/* ── Backend health check ───────────────────────────── */
async function checkBackend() {
  const dot = document.getElementById("statusDot");
  try {
    const res = await fetch(`${BACKEND}/ping`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) { dot.className = "status-dot online"; return true; }
  } catch (_) {}
  dot.className = "status-dot error";
  return false;
}

/* ── Tab navigation ─────────────────────────────────── */
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab, .tab-panel").forEach(el => el.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
  });
});

/* ── SORT ────────────────────────────────────────────── */
document.getElementById("btnSort").addEventListener("click", async () => {
  const logEl = document.getElementById("sortLog");
  logEl.innerHTML = "";
  const key    = document.getElementById("sortKey").value;
  const order  = document.getElementById("sortOrder").value;
  const group  = document.getElementById("groupBins").checked;
  log(logEl, `Sorting clips by ${key} (${order})…`, "info");
  try {
    const result = await evalScript(
      `sortBinClips(${JSON.stringify(key)}, ${JSON.stringify(order)}, ${group})`
    );
    const r = JSON.parse(result);
    log(logEl, `Sorted ${r.count} clips.${group ? ` Created ${r.bins} sub-bins.` : ""}`, "ok");
  } catch (e) {
    log(logEl, e.message, "err");
  }
});

/* ── BEAT SYNC ───────────────────────────────────────── */
document.getElementById("sensitivity").addEventListener("input", e => {
  document.getElementById("sensitivityVal").textContent = e.target.value;
});

document.getElementById("btnPickMusic").addEventListener("click", async () => {
  try {
    const path = await evalScript("pickAudioFile()");
    if (path && path !== "null") document.getElementById("musicPath").value = path;
  } catch (e) { console.error(e); }
});

document.getElementById("btnAnalyzeBeat").addEventListener("click", async () => {
  const logEl  = document.getElementById("beatLog");
  const canvas = document.getElementById("beatCanvas");
  const path   = document.getElementById("musicPath").value;
  const sens   = parseFloat(document.getElementById("sensitivity").value);
  logEl.innerHTML = "";

  if (!path) { log(logEl, "Select a music file first.", "err"); return; }
  if (!await checkBackend()) { log(logEl, "Backend not running. See docs.", "err"); return; }

  log(logEl, "Analyzing audio…", "info");
  try {
    const data = await callBackend("/analyze_beats", { path, sensitivity: sens });
    beatData = data;
    log(logEl, `Detected ${data.beats.length} beats at ~${data.bpm.toFixed(1)} BPM`, "ok");
    drawBeats(canvas, data.beats, data.duration);
    document.getElementById("btnSyncToBeats").disabled = false;
  } catch (e) {
    log(logEl, `Analysis failed: ${e.message}`, "err");
  }
});

document.getElementById("btnSyncToBeats").addEventListener("click", async () => {
  const logEl = document.getElementById("beatLog");
  if (!beatData) return;
  const addMarkers = document.getElementById("addMarkers").checked;
  const snapCuts   = document.getElementById("snapCuts").checked;
  log(logEl, "Syncing timeline to beats…", "info");
  try {
    const result = await evalScript(
      `syncTimelineToBeats(${JSON.stringify(beatData.beats)}, ${addMarkers}, ${snapCuts})`
    );
    const r = JSON.parse(result);
    log(logEl, `Snapped ${r.snapped} cuts. Added ${r.markers} markers.`, "ok");
  } catch (e) {
    log(logEl, e.message, "err");
  }
});

function drawBeats(canvas, beats, duration) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#2e2e3d";
  ctx.fillRect(0, 0, w, h);
  beats.forEach(t => {
    const x = (t / duration) * w;
    ctx.fillStyle = "#7c6af7";
    ctx.fillRect(x - 1, 0, 2, h);
  });
}

/* ── AUTO CUT ────────────────────────────────────────── */
document.getElementById("btnBuildCut").addEventListener("click", async () => {
  const logEl    = document.getElementById("cutLog");
  const progress = document.getElementById("cutProgress");
  const fill     = document.getElementById("cutFill");
  logEl.innerHTML = "";
  progress.style.display = "block";
  fill.style.width = "0%";

  const params = {
    targetDuration: parseFloat(document.getElementById("targetDuration").value),
    minClipLen:     parseFloat(document.getElementById("minClipLen").value),
    maxClipLen:     parseFloat(document.getElementById("maxClipLen").value),
    cutRhythm:      document.getElementById("cutRhythm").value,
    useAll:         document.getElementById("useAll").checked,
    skipDupes:      document.getElementById("skipDupes").checked,
    beats:          beatData ? beatData.beats : [],
  };

  log(logEl, "Fetching clips from bin…", "info");
  try {
    const clipsJson = await evalScript("getBinClips()");
    const clips = JSON.parse(clipsJson);
    log(logEl, `Found ${clips.length} clips. Planning cut…`, "info");
    fill.style.width = "25%";

    const plan = buildCutPlan(clips, params);
    fill.style.width = "50%";
    log(logEl, `Planned ${plan.length} edits. Writing to timeline…`, "info");

    const result = await evalScript(`buildRoughCut(${JSON.stringify(plan)})`);
    const r = JSON.parse(result);
    fill.style.width = "100%";
    log(logEl, `Done! ${r.count} clips placed. Sequence: "${r.sequence}"`, "ok");
  } catch (e) {
    log(logEl, e.message, "err");
    fill.style.width = "0%";
  }
});

function buildCutPlan(clips, params) {
  const { targetDuration, minClipLen, maxClipLen, cutRhythm, useAll, skipDupes, beats } = params;
  const available = [...clips].filter(c => c.duration > 0);
  if (available.length === 0) return [];

  const plan = [];
  let time = 0;
  const used = new Set();

  // If beat-locked and beats available, use beat intervals as durations
  const beatIntervals = (cutRhythm === "beat" && beats.length > 1)
    ? beats.slice(1).map((b, i) => b - beats[i])
    : null;
  let beatIdx = 0;

  while (time < targetDuration) {
    // Pick clip
    let pool = skipDupes ? available.filter(c => !used.has(c.id)) : available;
    if (pool.length === 0) {
      if (!useAll) break;
      pool = available; // re-use all when exhausted
    }

    const clip = pool[Math.floor(Math.random() * pool.length)];
    used.add(clip.id);

    // Pick duration
    let dur;
    if (beatIntervals && beatIdx < beatIntervals.length) {
      // snap to 1 or 2 beats
      const beats_per_cut = Math.random() < 0.6 ? 1 : 2;
      dur = beatIntervals[beatIdx % beatIntervals.length] * beats_per_cut;
      beatIdx++;
    } else {
      dur = minClipLen + Math.random() * (maxClipLen - minClipLen);
    }
    dur = Math.min(dur, clip.duration, targetDuration - time);
    if (dur < 0.5) break;

    const inPoint = Math.max(0, Math.random() * Math.max(0, clip.duration - dur));
    plan.push({ clipId: clip.id, inPoint, duration: dur, timelineIn: time });
    time += dur;
  }

  return plan;
}

/* ── SWAP ────────────────────────────────────────────── */
document.getElementById("btnSwapSelected").addEventListener("click", async () => {
  const logEl = document.getElementById("swapLog");
  logEl.innerHTML = "";
  const mode         = document.getElementById("swapMode").value;
  const preserveAudio = document.getElementById("preserveAudio").checked;
  const keepSpeed     = document.getElementById("keepSpeed").checked;
  log(logEl, "Swapping selected clips…", "info");
  try {
    const result = await evalScript(
      `swapSelectedClips(${JSON.stringify(mode)}, ${preserveAudio}, ${keepSpeed})`
    );
    const r = JSON.parse(result);
    swapHistory.push(r.undo);
    log(logEl, `Swapped ${r.count} clip(s).`, "ok");
  } catch (e) {
    log(logEl, e.message, "err");
  }
});

document.getElementById("btnShuffleAll").addEventListener("click", async () => {
  const logEl = document.getElementById("swapLog");
  logEl.innerHTML = "";
  log(logEl, "Shuffling all timeline clips…", "info");
  try {
    const result = await evalScript("shuffleAllClips()");
    const r = JSON.parse(result);
    swapHistory.push(r.undo);
    log(logEl, `Shuffled ${r.count} clips.`, "ok");
  } catch (e) {
    log(logEl, e.message, "err");
  }
});

document.getElementById("btnUndo").addEventListener("click", async () => {
  const logEl = document.getElementById("swapLog");
  if (swapHistory.length === 0) { log(logEl, "Nothing to undo.", "err"); return; }
  const undo = swapHistory.pop();
  log(logEl, "Undoing last swap…", "info");
  try {
    await evalScript(`applySwapUndo(${JSON.stringify(undo)})`);
    log(logEl, "Undo complete.", "ok");
  } catch (e) {
    log(logEl, e.message, "err");
  }
});

/* ── Init ────────────────────────────────────────────── */
checkBackend();
setInterval(checkBackend, 10000);
