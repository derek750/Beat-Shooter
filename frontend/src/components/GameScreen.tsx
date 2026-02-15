import { useEffect, useRef, useState } from "react";
import { Hands, Results } from "@mediapipe/hands";

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
/** Assumed hand distance (z) when MediaPipe doesn't provide it; ray origin uses hand's z. */
const ASSUMED_HAND_DISTANCE_Z = 1.0;
const CROSSHAIR_SIZE = 24;

type Tile = { x: number; y: number };

const GameScreen = ({ audioUrl, onBack }: GameScreenProps) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
    /** Hand orientation in degrees: rotation (roll in image plane), yaw (left/right), tilt (pitch). */
    const [orientation, setOrientation] = useState<{ rotation: number; yaw: number; tilt: number } | null>(null);
    /** Crosshair position (pixels) where hand orientation + position intersects plane z = CROSSHAIR_Z. */
    const [crosshair, setCrosshair] = useState<{ x: number; y: number } | null>(null);
    const handsRef = useRef<Hands | null>(null);
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

    // Initialize MediaPipe Hands
    useEffect(() => {
        const hands = new Hands({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
            },
        });

        hands.setOptions({
            maxNumHands: 1, // Only track one hand for lane detection
            modelComplexity: 1,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
        });

        hands.onResults((results: Results) => {
            if (!canvasRef.current) return;

            const canvas = canvasRef.current;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            // Clear canvas
            ctx.save();
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const { width: w, height: h } = canvas;
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
                    if (elapsed >= fadeOutStart + TILE_FADE_OUT_DURATION) continue; // done, don't draw
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

            // Draw bounding box around hand
            if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
                const landmarks = results.multiHandLandmarks[0];
                const { width: w, height: h } = canvas;

                // Bounding box from landmarks (x inverted for mirrored display)
                let minX = 1, maxX = 0, minY = 1, maxY = 0;
                for (const lm of landmarks) {
                    const x = 1 - lm.x;
                    minX = Math.min(minX, x);
                    maxX = Math.max(maxX, x);
                    minY = Math.min(minY, lm.y);
                    maxY = Math.max(maxY, lm.y);
                }
                const pad = 0.03;
                const left = (minX - pad) * w;
                const top = (minY - pad) * h;
                const boxW = (maxX - minX + pad * 2) * w;
                const boxH = (maxY - minY + pad * 2) * h;

                ctx.strokeStyle = "#00FF00";
                ctx.lineWidth = 4;
                ctx.strokeRect(w - left - boxW, top, boxW, boxH);

                // Wrist (landmark 0) position
                const wrist = landmarks[0];
                setPosition({
                    x: Math.round((1 - wrist.x) * w),
                    y: Math.round(wrist.y * h),
                });

                // Orientation from wrist (0) and middle MCP (9); MediaPipe gives x,y,z (z = relative depth)
                const middle = landmarks[9];
                const dx = middle.x - wrist.x;
                const dy = middle.y - wrist.y;
                const dz = (middle.z ?? 0) - (wrist.z ?? 0);
                const toDeg = (rad: number) => (rad * 180) / Math.PI;
                // Rotation (roll): in-screen angle of wrist→middle line (mirrored so hand-right = right)
                const rotation = toDeg(Math.atan2(dy, wrist.x - middle.x));
                // Yaw: hand turning left/right (x-z plane)
                const yaw = toDeg(Math.atan2(dz, dx));
                // Tilt: hand tilting forward/back (y-z plane)
                const tilt = toDeg(Math.atan2(dy, Math.hypot(dx, dz) || 1e-6));
                setOrientation({ rotation, yaw, tilt });

                // Crosshair: ray origin = hand position (x, y, z); z is hand's z (assumed distance if missing); direction from orientation; intersect with screen plane z=0
                const toRad = (deg: number) => (deg * Math.PI) / 180;
                const rotRad = toRad(rotation);
                const tiltRad = toRad(tilt);
                const cosTilt = Math.cos(tiltRad);
                const sinTilt = Math.sin(tiltRad);
                const dirX = Math.cos(rotRad) * cosTilt;
                const dirY = Math.sin(rotRad) * cosTilt;
                const dirZ = sinTilt;
                // Ray origin: hand position; z = hand's z (assumed distance where the person puts their hand, if missing)
                const ox = wrist.x;
                const oy = wrist.y;
                const oz = ASSUMED_HAND_DISTANCE_Z;
                // Intersect ray origin + t * dir with plane z = 0
                let crosshairNormX: number;
                let crosshairNormY: number;
                if (Math.abs(dirZ) > 1e-4) {
                    const t = (0 - oz) / dirZ;
                    crosshairNormX = ox + t * dirX;
                    crosshairNormY = oy + t * dirY;
                } else {
                    // Line parallel to screen: extend in xy only by fixed amount
                    const scale = 0.2;
                    const len = Math.hypot(dirX, dirY) || 1e-6;
                    crosshairNormX = ox + (dirX / len) * scale;
                    crosshairNormY = oy + (dirY / len) * scale;
                }
                const cx = Math.max(0, Math.min(w, crosshairNormX * w));
                const cy = Math.max(0, Math.min(h, crosshairNormY * h));
                setCrosshair({ x: Math.round(cx), y: Math.round(cy) });

                // Draw crosshair on canvas (mirrored coords: cx already in canvas space)
                const half = CROSSHAIR_SIZE / 2;
                ctx.strokeStyle = "rgba(255, 255, 0, 0.95)";
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(cx - half, cy);
                ctx.lineTo(cx + half, cy);
                ctx.moveTo(cx, cy - half);
                ctx.lineTo(cx, cy + half);
                ctx.stroke();
            } else {
                setPosition(null);
                setOrientation(null);
                setCrosshair(null);
            }

            ctx.restore();
        });

        handsRef.current = hands;

        return () => {
            hands.close();
        };
    }, []);

    // Process video frames
    useEffect(() => {
        if (!videoRef.current || !handsRef.current || !stream) return;

        let animationFrame: number;

        const detectHands = async () => {
            if (videoRef.current && videoRef.current.readyState === 4) {
                await handsRef.current!.send({ image: videoRef.current });
            }
            animationFrame = requestAnimationFrame(detectHands);
        };

        detectHands();

        return () => {
            if (animationFrame) {
                cancelAnimationFrame(animationFrame);
            }
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
                    {orientation != null && (
                        <>  ·  R: {Math.round(orientation.rotation)}°  Y: {Math.round(orientation.yaw)}°  T: {Math.round(orientation.tilt)}°</>
                    )}
                    {crosshair != null && (
                        <>  ·  Crosshair: {crosshair.x}, {crosshair.y}</>
                    )}
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