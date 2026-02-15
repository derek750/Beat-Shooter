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


@router.post("/create_beats")
def create_beats(body: CreateBeatsBody, debug: bool = False):
    """Analyze audio and return beat map as arrays (timestamps in seconds, types)."""
    mp3_path = _url_to_local_path(body.audio_url)
    y, sr = librosa.load(mp3_path)
    duration = librosa.get_duration(y=y, sr=sr)
    
    if debug:
        print(f"\nAudio loaded: {duration:.2f} seconds, Sample rate: {sr}")
    
    # Compute RMS energy
    hop_length = 512
    rms = librosa.feature.rms(y=y, hop_length=hop_length)[0]
    times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop_length)
    
    if debug:
        print(f"RMS frames: {len(rms)}")
        print(f"RMS mean: {np.mean(rms):.4f}, max: {np.max(rms):.4f}, min: {np.min(rms):.4f}")
    
    # Detect onset strength (beat energy)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop_length)
    
    if debug:
        print(f"Onset strength mean: {np.mean(onset_env):.4f}, max: {np.max(onset_env):.4f}")
    
    # Find peaks in onset strength (potential drops)
    threshold = np.percentile(onset_env, 85)  # Top 15% of energy
    peaks, properties = find_peaks(onset_env, height=threshold, distance=sr//hop_length*2)
    
    if debug:
        print(f"Threshold used: {threshold:.4f}")
        print(f"Peaks found: {len(peaks)}")
    
    # Combined list to store all points of interest
    all_points = []
    
    # Find low points before each peak and add both to the list
    search_window = int(4 * sr / hop_length)  # Look back 4 seconds max
    
    for peak in peaks:
        if peak > 10:  # Need some frames to look back
            # Define search range
            start_idx = max(0, peak - search_window)
            
            # Find the minimum in the window before this peak
            search_region = onset_env[start_idx:peak]
            if len(search_region) > 0:
                min_idx_relative = np.argmin(search_region)
                min_idx_absolute = start_idx + min_idx_relative
                
                # Add low point
                low_time = librosa.frames_to_time(min_idx_absolute, sr=sr, hop_length=hop_length)
                all_points.append({
                    'time': low_time,
                    'type': 'low',
                    'frame': min_idx_absolute,
                    'energy': onset_env[min_idx_absolute]
                })
        
        # Add high point (peak/drop)
        peak_time = librosa.frames_to_time(peak, sr=sr, hop_length=hop_length)
        all_points.append({
            'time': peak_time,
            'type': 'high',
            'frame': peak,
            'energy': onset_env[peak]
        })
    
    # Sort all points by time
    all_points.sort(key=lambda x: float(x["time"]))

    if debug:
        print(f"\nTotal points of interest: {len(all_points)}")
        print("\n=== All Points of Interest (chronological) ===")
        for i, point in enumerate(all_points):
            print(f"  {i+1}. {float(point['time']):6.2f}s - {point['type'].upper():4s} (energy: {float(point['energy']):.4f})")

    # Ensure all values are JSON-serializable (no numpy scalars)
    all_points_json = [
        {
            "time": float(p["time"]),
            "type": str(p["type"]),
            "frame": int(p["frame"]),
            "energy": float(p["energy"]),
        }
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