import librosa
import numpy as np

mp3_file = "songs/audio.mp3"

def detect_buildups_and_drops(mp3_file):
    # Load the audio file
    y, sr = librosa.load(mp3_file)
    duration = librosa.get_duration(y=y, sr=sr)

    # Detect onsets (sudden changes in energy - potential drops)
    onset_frames = librosa.onset.onset_detect(
        y=y, 
        sr=sr, 
        backtrack=True,
        units='frames'
    )
    onset_times = librosa.frames_to_time(onset_frames, sr=sr)
    
    # Calculate spectral features for buildup detection
    spectral_centroid = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
    rms = librosa.feature.rms(y=y)[0]
    
    # Detect buildups (increasing energy and spectral content)
    hop_length = 512
    frame_times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop_length)
    
    buildups = []
    drops = []
    
    # Simple buildup detection: look for sustained increases in energy
    window = 20  # frames
    for i in range(window, len(rms) - window):
        # Check if energy is increasing
        if np.mean(rms[i-window:i]) < np.mean(rms[i:i+window]) * 0.7:
            # Check if followed by a sudden drop (beat drop)
            if i + window < len(rms) and rms[i+window] > rms[i] * 1.3:
                buildups.append(frame_times[i])
                drops.append(frame_times[i+window])
    
    print("Duration: %s" %int(duration))
    return {
        'buildups': np.array(buildups),
        'drops': np.array(drops),
        'onsets': onset_times  # All beat onsets
    }

# Usage
timestamps = detect_buildups_and_drops(mp3_file)
print("Buildups at (seconds):", timestamps['buildups'])
print("Drops at (seconds):", timestamps['drops'])