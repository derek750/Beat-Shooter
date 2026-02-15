import { useEffect, useRef, useState } from "react";

interface GameScreenProps {
    audioUrl?: string;
    onBack: () => void;
}

const API_BASE = "http://localhost:8000";
const TILE_RADIUS = 70;
/** Tiles within this many before/after cannot overlap (passed to API). */
const TILE_WINDOW = 6;
/** Minimum pixel distance between tiles in the window (passed to API). */
const TILE_SPACING_RADIUS = 2 * TILE_RADIUS;
const TILE_FADE_IN_DURATION = 0.05; // quick pop so circle appears right when beat hits
const TILE_FADE_OUT_DURATION = 0.4; // constant time to fade out
const TILE_VISIBLE_DURATION = 4; // full opacity before fade out
const ENERGY_RADIUS_SCALE = 0.6; // higher energy = up to 60% bigger
const TILE_BASE_OPACITY = 0.82;

type Tile = { x: number; y: number };

interface CVResult {
    center: [number, number];
    bbox: [number, number, number, number];
    projected_point?: [number, number];
    rotation_angle?: number;
}

const GameScreen = ({ audioUrl, onBack }: GameScreenProps) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
    const cvResultRef = useRef<CVResult | null>(null);
    const lastTrackTimeRef = useRef<number>(0);
    const TRACK_INTERVAL_MS = 66; // ~15 fps
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [countdown, setCountdown] = useState<number | null>(null);
    const tilesRef = useRef<Tile[]>([]);
    /** Seconds after audio start when each tile should appear (from beat map). */
    const tileDisplayTimesRef = useRef<number[]>([]);
    /** Beat point types from beat map ('low' | 'high'), same length as beat timestamps. */
    const beatTypesRef = useRef<string[]>([]);
    /** Energy values per beat (for circle size scaling), same length as timestamps. */
    const energiesRef = useRef<number[]>([]);
    const countdownRef = useRef<number | null>(null);
    const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const gameStartTimeRef = useRef<number | null>(null);
    countdownRef.current = countdown;

    // Before countdown: fetch tiles + placeholder API, then 5-second countdown
    useEffect(() => {
        if (!audioUrl) {
            setCountdown(null);
            tilesRef.current = [];
            tileDisplayTimesRef.current = [];
            beatTypesRef.current = [];
            energiesRef.current = [];
            return;
        }

        let cancelled = false;

        const runBeforeCountdown = async () => {
            const width = window.innerWidth;
            const height = window.innerHeight - 60;

            const beatMapRes = await fetch(`${API_BASE}/beats/create_beats`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ audio_url: audioUrl }),
            });
            if (cancelled) return;
            if (!beatMapRes.ok) {
                console.warn("Beat map failed, using placeholder times:", await beatMapRes.text());
            }
            const beatMap = beatMapRes.ok
                ? (await beatMapRes.json()) as { timestamps: number[]; types: string[]; all_points?: { energy: number }[]; duration?: number }
                : { timestamps: [] as number[], types: [] as string[], all_points: [] };
            const beatTimestamps = beatMap.timestamps ?? [];
            beatTypesRef.current = beatMap.types ?? [];
            energiesRef.current = (beatMap.all_points ?? []).map((p) => p.energy ?? 0);
            const count = Math.max(1, beatTimestamps.length);

            const tilesRes = await fetch(`${API_BASE}/tiles/generate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    width,
                    height,
                    count,
                    tile_window: TILE_WINDOW,
                    radius: TILE_SPACING_RADIUS,
                }),
            });
            if (cancelled) return;
            const tilesData = await tilesRes.json();
            const tiles: Tile[] = (tilesData.x as number[]).map((x: number, i: number) => ({
                x: x / width,
                y: (tilesData.y as number[])[i] / height,
            }));
            tilesRef.current = tiles;
            tileDisplayTimesRef.current =
                beatTimestamps.length > 0
                    ? [...beatTimestamps]
                    : Array.from({ length: count }, (_, i) => i * 0.5);

            if (cancelled) return;
            setCountdown(5);
            const interval = setInterval(() => {
                setCountdown((prev) => {
                    if (prev == null || prev <= 1) {
                        clearInterval(interval);
                        countdownIntervalRef.current = null;
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
            countdownIntervalRef.current = interval;
        };

        runBeforeCountdown();

        return () => {
            cancelled = true;
            if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current);
                countdownIntervalRef.current = null;
            }
        };
    }, [audioUrl]);

    useEffect(() => {
        if (!audioUrl || countdown !== 0) return;
        gameStartTimeRef.current = performance.now();
        const audio = new Audio(audioUrl);
        audio.loop = true;
        audioRef.current = audio;
        audio.play().catch((err) => console.warn("Audio autoplay failed:", err));
        return () => {
            audio.pause();
            audioRef.current = null;
            gameStartTimeRef.current = null;
        };
    }, [audioUrl, countdown]);

    // Draw loop: tiles + CV bbox + crosshair at projected point
    useEffect(() => {
        if (!canvasRef.current || !stream) return;

        let animationFrame: number;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const draw = () => {
            if (!canvasRef.current) return;
            const c = canvasRef.current;
            const w = c.width;
            const h = c.height;
            ctx.clearRect(0, 0, w, h);

            if (countdownRef.current === 0 && tilesRef.current.length > 0 && gameStartTimeRef.current != null) {
                const elapsed = (performance.now() - gameStartTimeRef.current) / 1000;
                const times = tileDisplayTimesRef.current;
                const tiles = tilesRef.current;
                const beatTypes = beatTypesRef.current;
                const energies = energiesRef.current;
                const minE = energies.length > 0 ? Math.min(...energies) : 0;
                const maxE = energies.length > 0 ? Math.max(...energies) : 1;
                const energyRange = maxE - minE || 1;
                for (let i = 0; i < tiles.length; i++) {
                    const displayAt = times[i] ?? 0;
                    if (elapsed < displayAt) continue;
                    const fadeOutStart = displayAt + TILE_FADE_IN_DURATION + TILE_VISIBLE_DURATION;
                    if (elapsed >= fadeOutStart + TILE_FADE_OUT_DURATION) continue;
                    let opacity: number;
                    if (elapsed < displayAt + TILE_FADE_IN_DURATION) {
                        const fadeProgress = (elapsed - displayAt) / TILE_FADE_IN_DURATION;
                        opacity = TILE_BASE_OPACITY * fadeProgress;
                    } else if (elapsed >= fadeOutStart) {
                        const fadeOutProgress = (elapsed - fadeOutStart) / TILE_FADE_OUT_DURATION;
                        opacity = TILE_BASE_OPACITY * (1 - Math.min(1, fadeOutProgress));
                    } else {
                        opacity = TILE_BASE_OPACITY;
                    }
                    const cx = (1 - tiles[i].x) * w;
                    const cy = tiles[i].y * h;
                    const energyNorm = energies[i] != null ? (energies[i] - minE) / energyRange : 0.5;
                    const radius = TILE_RADIUS * (1 + energyNorm * ENERGY_RADIUS_SCALE);
                    const isHigh = beatTypes[i] === "high";
                    const fillColor = isHigh ? "rgba(239, 68, 68, 0.88)" : "rgba(99, 102, 241, 0.88)";
                    ctx.save();
                    ctx.globalAlpha = opacity;
                    ctx.fillStyle = fillColor;
                    ctx.beginPath();
                    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
                    ctx.lineWidth = 2;
                    ctx.stroke();
                    ctx.restore();
                }
            }

            const cvResult = cvResultRef.current;
            if (cvResult) {
                const [bx, by, bw, bh] = cvResult.bbox;
                // Invert bbox x coordinate
                const invBx = w - bx - bw;
                ctx.strokeStyle = "#00FF00";
                ctx.lineWidth = 4;
                ctx.strokeRect(invBx, by, bw, bh);

                // Draw crosshair at projected point if available
                if (cvResult.projected_point) {
                    const [px, py] = cvResult.projected_point;
                    // Invert x-coordinate to match the mirrored video display
                    const invPx = w - px;
                    const crosshairSize = 20;
                    const lineWidth = 2;

                    ctx.strokeStyle = "#FF00FF";
                    ctx.lineWidth = lineWidth;
                    ctx.globalAlpha = 0.8;

                    // Horizontal line
                    ctx.beginPath();
                    ctx.moveTo(invPx - crosshairSize, py);
                    ctx.lineTo(invPx + crosshairSize, py);
                    ctx.stroke();

                    // Vertical line
                    ctx.beginPath();
                    ctx.moveTo(invPx, py - crosshairSize);
                    ctx.lineTo(invPx, py + crosshairSize);
                    ctx.stroke();

                    // Center circle
                    ctx.fillStyle = "#FF00FF";
                    ctx.globalAlpha = 0.6;
                    ctx.beginPath();
                    ctx.arc(invPx, py, 4, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            animationFrame = requestAnimationFrame(draw);
        };

        draw();

        return () => {
            if (animationFrame) cancelAnimationFrame(animationFrame);
        };
    }, [stream]);

    // Capture video frames and send to CV API for colour tracking
    useEffect(() => {
        if (!videoRef.current || !stream || !canvasRef.current) return;

        const video = videoRef.current;
        const captureCanvas = document.createElement("canvas");
        let cancelled = false;

        const tick = async () => {
            if (cancelled || !videoRef.current || !canvasRef.current) return;
            const now = performance.now();
            if (now - lastTrackTimeRef.current < TRACK_INTERVAL_MS) {
                setTimeout(tick, TRACK_INTERVAL_MS - (now - lastTrackTimeRef.current));
                return;
            }
            if (video.readyState < 2) {
                setTimeout(tick, 50);
                return;
            }

            const w = canvasRef.current.width;
            const h = canvasRef.current.height;
            const vw = video.videoWidth;
            const vh = video.videoHeight;
            captureCanvas.width = vw;
            captureCanvas.height = vh;
            const capCtx = captureCanvas.getContext("2d");
            if (!capCtx) {
                setTimeout(tick, TRACK_INTERVAL_MS);
                return;
            }
            capCtx.drawImage(video, 0, 0);
            const dataUrl = captureCanvas.toDataURL("image/jpeg", 0.85);

            lastTrackTimeRef.current = now;
            try {
                const res = await fetch(`${API_BASE}/cv/track`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ image: dataUrl }),
                });
                if (cancelled) return;
                const data = (await res.json()) as {
                    found: boolean;
                    center: [number, number] | null;
                    bbox: [number, number, number, number] | null;
                    projected_point?: [number, number] | null;
                    rotation_angle?: number | null;
                };
                if (data.found && data.center && data.bbox) {
                    const [cx, cy] = data.center;
                    const [bx, by, bw, bh] = data.bbox;
                    const scaleX = w / vw;
                    const scaleY = h / vh;
                    const dispCx = cx * scaleX;
                    const dispCy = cy * scaleY;
                    const dispBx = bx * scaleX;
                    const dispBy = by * scaleY;
                    const dispBw = bw * scaleX;
                    const dispBh = bh * scaleY;
                    
                    let projPoint: [number, number] | undefined;
                    if (data.projected_point) {
                        const [ppx, ppy] = data.projected_point;
                        projPoint = [ppx * scaleX, ppy * scaleY];
                    }

                    setPosition({ x: Math.round(w - dispCx), y: Math.round(dispCy) });
                    cvResultRef.current = {
                        center: [w - dispCx, dispCy],
                        bbox: [w - dispBx - dispBw, dispBy, dispBw, dispBh],
                        projected_point: projPoint,
                        rotation_angle: data.rotation_angle ?? undefined,
                    };
                } else {
                    setPosition(null);
                    cvResultRef.current = null;
                }
            } catch {
                if (!cancelled) {
                    setPosition(null);
                    cvResultRef.current = null;
                }
            }
            setTimeout(tick, TRACK_INTERVAL_MS);
        };

        tick();

        return () => {
            cancelled = true;
        };
    }, [stream]);

    useEffect(() => {
        let activeStream: MediaStream | null = null;

        const startCamera = async () => {
            try {
                setError(null);
                setLoading(true);
                const mediaStream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: "user" },
                });
                activeStream = mediaStream;
                setStream(mediaStream);
            } catch (err) {
                const message =
                    err instanceof Error ? err.message : "Could not access camera";
                if (err instanceof Error && err.name === "NotAllowedError") {
                    setError("Camera access was denied. Allow camera in your browser to play.");
                } else if (err instanceof Error && err.name === "NotFoundError") {
                    setError("No camera found.");
                } else {
                    setError(message);
                }
            } finally {
                setLoading(false);
            }
        };

        startCamera();

        return () => {
            if (activeStream) {
                activeStream.getTracks().forEach((track) => track.stop());
            }
        };
    }, []);

    useEffect(() => {
        if (!videoRef.current || !stream) return;
        videoRef.current.srcObject = stream;

        // Set canvas size to match video element's rendered dimensions
        const updateCanvasSize = () => {
            if (videoRef.current && canvasRef.current) {
                const rect = videoRef.current.getBoundingClientRect();
                canvasRef.current.width = rect.width;
                canvasRef.current.height = rect.height;
            }
        };

        const handleLoadedMetadata = () => {
            updateCanvasSize();
        };

        videoRef.current.addEventListener("loadedmetadata", handleLoadedMetadata);
        window.addEventListener("resize", updateCanvasSize);

        return () => {
            videoRef.current?.removeEventListener("loadedmetadata", handleLoadedMetadata);
            window.removeEventListener("resize", updateCanvasSize);
        };
    }, [stream]);

    return (
        <div className="relative h-screen w-screen bg-background overflow-hidden flex flex-col">
            {/* Top bar: no video, fixed height */}
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 bg-black/90 z-10">
                <button
                    onClick={onBack}
                    className="font-display text-sm tracking-wider text-white/90 hover:text-white transition-colors cursor-pointer"
                >
                    ← BACK
                </button>
                <span className="font-display text-sm tracking-wider text-white/70">
                    {position != null ? `X: ${position.x}  Y: ${position.y}` : "X: —  Y: —"}
                </span>
                <span className="font-display text-sm tracking-wider text-white/90">
                    SCORE: 0
                </span>
            </div>

            {/* Video/canvas area only below the bar, mirrored so hand-right = right */}
            <div className="flex-1 min-h-0 bg-card flex items-center justify-center overflow-hidden relative">
                {countdown != null && countdown > 0 && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70">
                        <span className="font-display text-9xl font-black text-white tabular-nums animate-pulse">
                            {countdown}
                        </span>
                    </div>
                )}
                {loading && (
                    <span className="text-muted-foreground font-display text-sm tracking-widest animate-pulse">
                        Requesting camera access…
                    </span>
                )}

                {error && (
                    <div className="text-center max-w-sm px-4">
                        <p className="text-muted-foreground font-display text-sm tracking-wide">
                            {error}
                        </p>
                        <p className="text-muted-foreground/80 font-body text-xs mt-2">
                            Check site permissions or try another browser.
                        </p>
                    </div>
                )}

                {stream && !error && (
                    <div className="relative w-full h-full" style={{ transform: "scaleX(-1)" }}>
                        <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            className="block w-full h-full object-cover"
                        />
                        <canvas
                            ref={canvasRef}
                            className="absolute top-0 left-0 w-full h-full pointer-events-none"
                        />
                    </div>
                )}
            </div>
        </div>
    );
};

export default GameScreen;