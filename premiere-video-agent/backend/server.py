"""
Beat-detection backend for Premiere Video Agent.
Run: python server.py  (listens on localhost:7720)
"""
import json
import struct
import wave
import math
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = 7720


# ── Audio helpers ────────────────────────────────────────────────────────────

def read_wav_samples(path: str) -> tuple[list[float], int]:
    """Return (mono_samples_float, sample_rate) for a WAV file."""
    with wave.open(path, "rb") as wf:
        sr       = wf.getframerate()
        n_ch     = wf.getnchannels()
        sw       = wf.getsampwidth()
        n_frames = wf.getnframes()
        raw      = wf.readframes(n_frames)

    fmt  = {1: "b", 2: "h", 4: "i"}[sw]
    data = struct.unpack(f"<{n_frames * n_ch}{fmt}", raw)
    max_val = 2 ** (8 * sw - 1)

    # Downmix to mono
    samples = []
    for i in range(0, len(data), n_ch):
        s = sum(data[i:i + n_ch]) / n_ch
        samples.append(s / max_val)
    return samples, sr


def energy_envelope(samples: list[float], sr: int, hop_ms: int = 10) -> list[float]:
    hop = int(sr * hop_ms / 1000)
    env = []
    for i in range(0, len(samples) - hop, hop):
        chunk = samples[i:i + hop]
        rms   = math.sqrt(sum(x * x for x in chunk) / len(chunk))
        env.append(rms)
    return env


def detect_beats(path: str, sensitivity: float = 0.5) -> dict:
    """
    Lightweight beat detector using onset energy flux.
    Returns {beats: [seconds], bpm: float, duration: float}.
    """
    ext = os.path.splitext(path)[1].lower()

    # For non-WAV files we need a conversion step.
    # If librosa is available, use it; otherwise fall back to a basic estimate.
    try:
        import librosa  # optional fast path
        y, sr   = librosa.load(path, sr=None, mono=True)
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()
        duration   = float(len(y) / sr)
        return {"beats": beat_times, "bpm": float(tempo), "duration": duration}
    except ImportError:
        pass

    # Pure-stdlib path (WAV only)
    if ext != ".wav":
        raise ValueError(
            f"Backend requires librosa for {ext} files. "
            "Install it: pip install librosa"
        )

    samples, sr = read_wav_samples(path)
    duration    = len(samples) / sr
    env         = energy_envelope(samples, sr)

    # Onset detection: diff of energy envelope, threshold by sensitivity
    threshold = (1.0 - sensitivity) * 0.05 + 0.005
    beats     = []
    prev      = 0.0
    hop_sec   = 0.010  # 10 ms per hop
    min_gap   = 0.25   # minimum 250 ms between beats

    last_beat = -1.0
    for i, val in enumerate(env):
        flux = max(0.0, val - prev)
        if flux > threshold and (i * hop_sec - last_beat) > min_gap:
            beats.append(round(i * hop_sec, 4))
            last_beat = i * hop_sec
        prev = val

    # Estimate BPM from median inter-beat interval
    bpm = 120.0
    if len(beats) > 2:
        intervals = [beats[i + 1] - beats[i] for i in range(len(beats) - 1)]
        med       = sorted(intervals)[len(intervals) // 2]
        if med > 0:
            bpm = round(60.0 / med, 1)

    return {"beats": beats, "bpm": bpm, "duration": round(duration, 3)}


# ── HTTP handler ─────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):  # suppress noisy access log
        pass

    def _send_json(self, code: int, obj: dict):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/ping":
            self._send_json(200, {"status": "ok"})
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body   = json.loads(self.rfile.read(length)) if length else {}

        if self.path == "/analyze_beats":
            path        = body.get("path", "")
            sensitivity = float(body.get("sensitivity", 0.5))
            if not path or not os.path.isfile(path):
                self._send_json(400, {"error": f"File not found: {path}"})
                return
            try:
                result = detect_beats(path, sensitivity)
                self._send_json(200, result)
            except Exception as exc:
                self._send_json(500, {"error": str(exc)})

        else:
            self._send_json(404, {"error": "unknown endpoint"})


if __name__ == "__main__":
    srv = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Premiere Video Agent backend — http://127.0.0.1:{PORT}")
    print("Press Ctrl+C to stop.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
