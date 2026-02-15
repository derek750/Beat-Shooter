import os
from urllib.parse import urlparse, unquote

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import librosa
import numpy as np
from scipy.signal import find_peaks

router = APIRouter(prefix="/beats", tags=["beats"])

SONGS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "songs")


class CreateBeatsBody(BaseModel):
    audio_url: str


def _url_to_local_path(audio_url: str) -> str:
    """Resolve frontend audio URL to local songs file path."""
    parsed = urlparse(audio_url)
    path = unquote(parsed.path)
    filename = os.path.basename(path)
    if not filename.lower().endswith((".mp3", ".wav", ".ogg")):
        raise HTTPException(status_code=400, detail="Unsupported audio format")
    local = os.path.join(SONGS_DIR, filename)
    if not os.path.isfile(local):
        raise HTTPException(status_code=404, detail=f"Audio file not found: {filename}")
    return local


def _create_beats_beat_track(y: np.ndarray, sr: int, duration: float, hop_length: int, debug: bool) -> list:
    """
    Tempo-aware beat detection via librosa.beat.beat_track.
    Uses dynamic programming to pick beats consistent with estimated tempo;
    more musically coherent than raw onset peaks.
    """
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop_length)
    tempo, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset_env,
        sr=sr,
        hop_length=hop_length,
        units="time",
    )
    # beat_track returns (tempo, beats); beats may be 1d array or 2d (bpm, beats)
    beat_times = np.atleast_1d(beat_frames)
    if beat_times.ndim > 1:
        beat_times = beat_times.flatten()
    beat_times = beat_times[beat_times >= 0]  # filter sentinel values
    beat_times = np.sort(beat_times)

    if debug:
        bpm = float(np.median(tempo)) if np.size(tempo) else float(tempo)
        print(f"Beat track: tempo ~{bpm:.1f} BPM, {len(beat_times)} beats")

    times = librosa.frames_to_time(np.arange(len(onset_env)), sr=sr, hop_length=hop_length)
    all_points = []
    for t in beat_times:
        # Sample onset strength at this beat (interpolate if needed)
        idx = np.searchsorted(times, t, side="left")
        idx = min(idx, len(onset_env) - 1)
        energy = float(onset_env[idx])
        all_points.append({"time": float(t), "type": "beat", "frame": idx, "energy": energy})

    # Classify as high (downbeat / strong) vs low (upbeat / weak) by onset strength
    if len(all_points) > 0:
        energies = [p["energy"] for p in all_points]
        median_e = float(np.median(energies))
        for p in all_points:
            p["type"] = "high" if p["energy"] >= median_e else "low"

    return all_points


def _create_beats_onset_peaks(
    y: np.ndarray, sr: int, duration: float, hop_length: int, debug: bool
) -> list:
    """
    Original onset-peak method: peaks in onset strength + low points before peaks.
    Good for bass-drop style detection; less tempo-coherent than beat_track.
    """
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop_length)
    threshold = np.percentile(onset_env, 85)
    peaks, _ = find_peaks(onset_env, height=threshold, distance=sr // hop_length * 2)
    search_window = int(4 * sr / hop_length)
    all_points = []
    for peak in peaks:
        if peak > 10:
            start_idx = max(0, peak - search_window)
            search_region = onset_env[start_idx:peak]
            if len(search_region) > 0:
                min_idx_absolute = start_idx + int(np.argmin(search_region))
                low_time = librosa.frames_to_time(min_idx_absolute, sr=sr, hop_length=hop_length)
                all_points.append({
                    "time": float(low_time),
                    "type": "low",
                    "frame": min_idx_absolute,
                    "energy": float(onset_env[min_idx_absolute]),
                })
        peak_time = librosa.frames_to_time(peak, sr=sr, hop_length=hop_length)
        all_points.append({
            "time": float(peak_time),
            "type": "high",
            "frame": int(peak),
            "energy": float(onset_env[peak]),
        })
    all_points.sort(key=lambda x: x["time"])
    return all_points


@router.post("/create_beats")
def create_beats(body: CreateBeatsBody, debug: bool = False, method: str = "beat_track"):
    """
    Analyze audio and return beat map as arrays (timestamps in seconds, types).

    method: "beat_track" (default) - tempo-aware beat grid, more musically accurate.
            "onset_peaks" - original peak-based detection, good for bass drops.
    """
    mp3_path = _url_to_local_path(body.audio_url)
    y, sr = librosa.load(mp3_path)
    duration = float(librosa.get_duration(y=y, sr=sr))
    hop_length = 512

    if debug:
        print(f"\nAudio loaded: {duration:.2f} seconds, Sample rate: {sr}, method={method}")

    if method == "onset_peaks":
        all_points = _create_beats_onset_peaks(y, sr, duration, hop_length, debug)
    else:
        all_points = _create_beats_beat_track(y, sr, duration, hop_length, debug)

    if debug:
        print(f"\nTotal points of interest: {len(all_points)}")
        for i, point in enumerate(all_points[:20]):
            print(f"  {i+1}. {float(point['time']):6.2f}s - {point['type'].upper():4s} (energy: {float(point['energy']):.4f})")
        if len(all_points) > 20:
            print(f"  ... and {len(all_points) - 20} more")

    all_points_json = [
        {"time": float(p["time"]), "type": str(p["type"]), "frame": int(p["frame"]), "energy": float(p["energy"])}
        for p in all_points
    ]
    timestamps = [p["time"] for p in all_points_json]
    types = [p["type"] for p in all_points_json]
    return {
        "all_points": all_points_json,
        "duration": float(duration),
        "timestamps": timestamps,
        "types": types,
    }