# Premiere Video Agent — Usage Guide

## Quick Start

```bash
# 1. Install extension + backend deps
./install.sh

# 2. Start beat-detection backend
python3 backend/server.py

# 3. Open Adobe Premiere Pro
#    Window → Extensions → Video Agent
```

---

## Features

### Sort (Tab 1)
Auto-organizes every clip in your Project panel with zero manual folder work.

| Control | What it does |
|---|---|
| Sort by | Duration / File name / Date / FPS / Resolution |
| Order | Ascending or descending |
| Group into sub-bins | Creates named bins (e.g. `duration_Short`, `name_A`) |

**Click "Sort Clips"** — done in seconds regardless of bin size.

---

### Beat Sync (Tab 2)
Detects every beat in your music track and aligns your timeline to them.

1. **Browse** — pick your music file (WAV works without librosa; MP3/AAC/FLAC need `librosa`)
2. **Beat sensitivity** — higher = more beats detected (good for fast edits)
3. **Analyze Beats** — waveform preview appears with beat positions marked in purple
4. **Sync Timeline to Beats** — snaps all existing edit points to the nearest beat; optionally adds sequence markers at every beat

> The status dot in the top-right turns **green** when the backend is running.

---

### Auto Cut (Tab 3)
Builds a complete rough cut sequence from scratch — no timeline dragging needed.

| Setting | Description |
|---|---|
| Target duration | How long the final sequence should be (seconds) |
| Min / Max clip length | Controls pacing — tight (2–4 s) for high-energy, loose (4–10 s) for cinematic |
| Cut rhythm | **Beat-locked** uses analyzed beats; **Random** varies within your range; **Energy** drives cuts from audio loudness |
| Use every clip at least once | Ensures no footage is left on the floor |
| Skip duplicate clips | Prevents the same shot from appearing back-to-back |

**Click "Build Rough Cut"** — a new sequence called `Rough Cut HH:MM:SS` is created.

---

### Swap (Tab 4)
Replace clips on the timeline without touching the edit or moving anything else.

| Button | Action |
|---|---|
| **Swap Selected** | Replaces highlighted timeline clips using the chosen mode |
| **Shuffle All** | Randomizes every clip on track 1 while keeping all timings |
| **Undo Last Swap** | Reverts the most recent swap operation |

**Swap modes:**
- *Match duration* — picks the bin clip whose length is closest to the original
- *Random* — picks any other bin clip
- *Next / Previous* — walks through the bin in order

---

## Requirements

| Component | Minimum version |
|---|---|
| Adobe Premiere Pro | 2020 (v14.0) |
| Python | 3.8+ |
| librosa *(optional)* | 0.10+ — enables MP3/AAC/FLAC beat analysis |

---

## Troubleshooting

**Status dot is red / gray**
→ Start `python3 backend/server.py` in a terminal.

**Extension not visible in Window → Extensions**
→ Re-run `install.sh`; check that `PlayerDebugMode` was set (macOS: `defaults read com.adobe.CSXS.12 PlayerDebugMode`).

**Beat analysis fails on MP3**
→ `pip install librosa soundfile`

**"No active sequence" error**
→ Open or create a sequence before using Beat Sync or Auto Cut.
