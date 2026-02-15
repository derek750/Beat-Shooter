import { useState } from "react";

interface StartScreenProps {
    onStart: (audioUrl?: string) => void;
    onSavedSongs: () => void;
}

const API_BASE = "http://localhost:8000";

const StartScreen = ({ onStart, onSavedSongs }: StartScreenProps) => {
    const [isStarting, setIsStarting] = useState(false);
    const [prompt, setPrompt] = useState("");
    const [durationSeconds, setDurationSeconds] = useState("3");
    const [error, setError] = useState<string | null>(null);

    const handleGenerateSong = async () => {
        if (isStarting) return;
        setIsStarting(true);
        setError(null);

        const userPrompt = prompt.trim();
        const durationMs = Math.max(1000, Math.min(120000, Math.round(Number(durationSeconds) || 3) * 1000));

        try {
            const geminiRes = await fetch(`${API_BASE}/gemini/generate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ input: userPrompt }),
            });
            const geminiData = await geminiRes.json();
            const elevenLabsPrompt = geminiRes.ok
                ? (geminiData?.response || userPrompt.replace(/\s+/g, " "))
                : userPrompt.replace(/\s+/g, " ");

            const res = await fetch(
                `${API_BASE}/elevenlabs/generatemusic?prompt=${encodeURIComponent(elevenLabsPrompt)}&duration=${durationMs}`
            );
            const blob = await res.blob();

            const form = new FormData();
            form.append("file", blob, "mysong.mp3");
            form.append("prompt", elevenLabsPrompt);
            form.append("duration_ms", String(durationMs));

            const saveres = await fetch(`${API_BASE}/songs/save`, {
                method: "POST",
                body: form,
            });

            const data = await saveres.json();
            const savedAudioUrl = data.url ? `${API_BASE}${data.url}` : undefined;
            onStart(savedAudioUrl);
        } catch (err: unknown) {
            console.error("Music generation failed:", err);
            setError("Music generation failed. Please try again.");
        } finally {
            setIsStarting(false);
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-background relative overflow-hidden">
            <div
                className="absolute inset-0 opacity-[0.04]"
                style={{
                    backgroundImage:
                        "linear-gradient(hsl(var(--primary)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary)) 1px, transparent 1px)",
                    backgroundSize: "60px 60px",
                }}
            />
            <div className="relative z-10 flex flex-col items-center gap-6 animate-slide-up">
                <h1 className="font-display text-5xl md:text-7xl font-black tracking-wider text-foreground text-center">
                    PIANO
                    <span className="block text-primary">TILES</span>
                </h1>

                <p className="text-muted-foreground text-lg tracking-widest uppercase">
                    Tap the black tiles
                </p>

                <div className="flex flex-col gap-4 mt-6 w-full max-w-sm">
                    <input
                        type="text"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="e.g. sad piano arcade music"
                        className="w-full px-4 py-3 rounded-lg bg-secondary/50 border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <input
                        type="number"
                        min={1}
                        max={120}
                        value={durationSeconds}
                        onChange={(e) => setDurationSeconds(e.target.value)}
                        placeholder="Duration (seconds)"
                        className="w-full px-4 py-3 rounded-lg bg-secondary/50 border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    {error && (
                        <p className="text-destructive text-sm text-center">
                            {error}
                        </p>
                    )}
                    <button
                        onClick={handleGenerateSong}
                        disabled={isStarting}
                        className="px-12 py-4 rounded-lg font-display text-xl font-bold tracking-widest uppercase
          bg-primary text-primary-foreground
          hover:scale-105 active:scale-95 transition-all duration-200
          animate-pulse-glow cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                        {isStarting ? "Generating…" : "Generate Song"}
                    </button>

                    <button
                        onClick={onSavedSongs}
                        className="px-12 py-4 rounded-lg font-display text-xl font-bold tracking-widest uppercase
          bg-secondary text-secondary-foreground
          hover:scale-105 active:scale-95 transition-all duration-200
          cursor-pointer"
                    >
                        Saved Songs
                    </button>
                </div>
            </div>
        </div>
    );
};

export default StartScreen;
