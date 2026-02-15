import { useEffect, useRef, useState } from "react";
import { Hands, Results } from "@mediapipe/hands";

interface GameScreenProps {
    audioUrl?: string;
    onBack: () => void;
}

const API_BASE = "http://localhost:8000";
const WS_URL = "ws://localhost:8000/esp32/ws";

const TILE_RADIUS = 70;
/** Tiles within this many before/after cannot overlap (passed to API). */
const TILE_WINDOW = 6;
/** Minimum pixel distance between tiles in the window (passed to API). */
const TILE_SPACING_RADIUS = 2 * TILE_RADIUS;
const TILE_FADE_IN_DURATION = 0.05;
const TILE_FADE_OUT_DURATION = 0.4;
const TILE_VISIBLE_DURATION = 4;
const ENERGY_RADIUS_SCALE = 0.6;
const TILE_BASE_OPACITY = 0.82;
const END_SCREEN_DELAY = 3;

type Tile = { x: number; y: number };
type Esp32Event =
    | { type: "PRESS" | "RELEASE"; button: number }
    | { type: "STATE"; buttons: number[] }
    | any;

export default function GameScreen({ audioUrl, onBack }: GameScreenProps) {
    const wsRef = useRef<WebSocket | null>(null);
    const lastPressAtRef = useRef<number>(0);

    const [hardwareConnected, setHardwareConnected] = useState(false);

    // ✅ make score real so you can SEE button working immediately
    const [score, setScore] = useState(0);

    const tilesRef = useRef<Tile[]>([]);
    const [tiles, setTiles] = useState<Tile[]>([]);
    const [countdown, setCountdown] = useState<number | null>(null);
    const [gameStarted, setGameStarted] = useState(false);
    const [gameEnded, setGameEnded] = useState(false);

    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);

    // ----------------------------
    // ESP32 WebSocket listener
    // ----------------------------
    useEffect(() => {
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
            setHardwareConnected(true);
            // keepalive ping every 10s so server loop stays alive
            const ping = setInterval(() => {
                try {
                    if (ws.readyState === WebSocket.OPEN) ws.send("ping");
                } catch {}
            }, 10000);

            (ws as any)._pingInterval = ping;
        };

        ws.onclose = () => {
            setHardwareConnected(false);
            const ping = (ws as any)._pingInterval as ReturnType<typeof setInterval> | undefined;
            if (ping) clearInterval(ping);
        };

        ws.onerror = () => {
            // onclose will handle state
        };

        ws.onmessage = (msg) => {
            let evt: Esp32Event | null = null;
            try {
                evt = JSON.parse(msg.data);
            } catch {
                return;
            }
            if (!evt) return;

            // Example: button 0 PRESS = "shoot"
            if (evt.type === "PRESS" && typeof (evt as any).button === "number") {
                const button = (evt as any).button as number;

                // simple debounce so holding the button doesn't spam
                const now = performance.now();
                if (now - lastPressAtRef.current < 80) return;
                lastPressAtRef.current = now;

                if (button === 0 || button === 1) {
                    // ✅ "does something in the app" — visible proof
                    // Most ESP32 button setups come through as button 0.
                    setScore((s) => s + 1);
                }

                // you can map other buttons here:
                // if (button === 1) pause, if (button === 2) back, etc.
            }
        };

        return () => {
            try {
                const ping = (ws as any)._pingInterval as ReturnType<typeof setInterval> | undefined;
                if (ping) clearInterval(ping);
                ws.close();
            } catch {}
            wsRef.current = null;
        };
    }, []);

    // --- rest of your file unchanged ---
    // (leaving everything else exactly as-is)

    return (
        <div className="w-full h-full relative overflow-hidden bg-black text-white">
            {/* Top HUD */}
            <div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4">
                <button
                    className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 transition"
                    onClick={onBack}
                >
                    Back
                </button>

                <div className="flex items-center gap-4">
                    <span className="text-sm text-white/70">
                        HW: {hardwareConnected ? "connected" : "disconnected"}
                    </span>
                    <span className="text-sm text-white/90">
                        SCORE: {score}
                    </span>
                </div>
            </div>

            {/* ...your existing JSX... */}
            <video ref={videoRef} className="hidden" />
            <canvas ref={canvasRef} className="w-full h-full" />

            {gameEnded && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-50">
                    <div className="text-center">
                        <h2 className="text-4xl font-bold mb-4">Game Over</h2>
                        <p className="text-xl text-white/90 mb-6">{score}</p>
                        <button
                            className="px-5 py-3 rounded-xl bg-white/10 hover:bg-white/20 transition"
                            onClick={onBack}
                        >
                            Back
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
