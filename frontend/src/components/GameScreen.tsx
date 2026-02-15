import { useEffect, useRef, useState } from "react";
import { Hands, Results } from "@mediapipe/hands";
import { drawConnectors, drawLandmarks } from "@mediapipe/drawing_utils";
import { HAND_CONNECTIONS } from "@mediapipe/hands";

interface GameScreenProps {
  audioUrl?: string;
  onBack: () => void;
}

const GameScreen = ({ audioUrl, onBack }: GameScreenProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const handsRef = useRef<Hands | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Play audio when provided
  useEffect(() => {
    if (!audioUrl) return;
    const audio = new Audio(audioUrl);
    audio.loop = true;
    audioRef.current = audio;
    audio.play().catch((err) => console.warn("Audio autoplay failed:", err));
    return () => {
      audio.pause();
      audioRef.current = null;
    };
  }, [audioUrl]);

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

      // Draw hand landmarks and connections
      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        
        // Draw connections (bones)
        drawConnectors(ctx, landmarks, HAND_CONNECTIONS, {
          color: "#00FF00",
          lineWidth: 4,
        });
        
        // Draw landmarks (joints)
        drawLandmarks(ctx, landmarks, {
          color: "#FF0000",
          lineWidth: 2,
          radius: 5,
        });

        // Wrist (landmark 0) position; x inverted so hand-right = right on mirrored screen
        const wrist = landmarks[0];
        setPosition({
          x: Math.round((1 - wrist.x) * canvas.width),
          y: Math.round(wrist.y * canvas.height),
        });
      } else {
        setPosition(null);
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
        </span>
        <span className="font-display text-sm tracking-wider text-white/90">
          SCORE: 0
        </span>
      </div>

      {/* Video/canvas area only below the bar, mirrored so hand-right = right */}
      <div className="flex-1 min-h-0 bg-card flex items-center justify-center overflow-hidden">
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