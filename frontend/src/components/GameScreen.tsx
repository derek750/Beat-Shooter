import { useEffect, useRef, useState } from "react";
import { Hands, Results } from "@mediapipe/hands";
import { drawConnectors, drawLandmarks } from "@mediapipe/drawing_utils";
import { HAND_CONNECTIONS } from "@mediapipe/hands";

interface GameScreenProps {
  onBack: () => void;
}

const GameScreen = ({ onBack }: GameScreenProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeLane, setActiveLane] = useState<number | null>(null);
  const handsRef = useRef<Hands | null>(null);

  // Detect which lane (1-4) the hand is in based on x-coordinate
  const detectLane = (landmarks: any[]): number | null => {
    if (!landmarks || landmarks.length === 0) return null;

    // Use wrist position (landmark 0) to determine lane
    const handLandmarks = landmarks[0];
    const wristX = handLandmarks[0].x; // x is normalized between 0 and 1
    
    // Divide into 4 equal lanes
    if (wristX < 0.25) return 1;
    if (wristX < 0.5) return 2;
    if (wristX < 0.75) return 3;
    return 4;
  };

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

        // Detect and set active lane
        const lane = detectLane(results.multiHandLandmarks);
        setActiveLane(lane);
      } else {
        setActiveLane(null);
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
    <div className="relative h-screen w-screen bg-background overflow-hidden">
      {/* Video area - CENTERED AND CONSTRAINED */}
      <div className="absolute inset-0 bg-card flex items-center justify-center overflow-hidden">
        {/* Video container with max dimensions */}
        <div className="relative max-w-[75vw] max-h-[75vh] w-full h-full flex items-center justify-center">
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
          <div className="relative w-full h-full flex items-center justify-center">
            <div className="relative">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="block max-w-full max-h-[75vh] object-contain"
              />
              
              {/* Canvas overlay for hand landmarks */}
              <canvas
                ref={canvasRef}
                className="absolute top-0 left-0 w-full h-full pointer-events-none"
              />

              {/* Lane divider lines with highlighting */}
              <div className="absolute inset-0 flex pointer-events-none">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className={`flex-1 ${
                      i < 3 ? "border-r" : ""
                    } transition-all duration-200 ${
                      activeLane === i + 1
                        ? "bg-green-500/20 border-green-500"
                        : "border-foreground/10"
                    }`}
                  />
                ))}
              </div>

              {/* Lane indicator display */}
              {activeLane && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/70 px-6 py-3 rounded-lg backdrop-blur-sm z-20">
                  <p className="text-white font-display text-lg tracking-wider">
                    LANE {activeLane}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Header overlay */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent z-10">
        <button
          onClick={onBack}
          className="font-display text-sm tracking-wider text-white/90 hover:text-white transition-colors cursor-pointer"
        >
          ← BACK
        </button>
        <span className="font-display text-sm tracking-wider text-white/90">
          SCORE: 0
        </span>
      </div>

      {/* Video area with tile lane lines */}
      <div className="flex-1 relative bg-card flex items-center justify-center overflow-hidden min-h-0">
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
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="max-h-full max-w-full w-full h-full object-contain absolute inset-0 m-auto"
            style={{ aspectRatio: "auto" }}
          />
        )}

        {/* Lane divider lines */}
        <div className="absolute inset-0 flex pointer-events-none">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex-1 border-r border-foreground/10"
            />
          ))}
          <div className="flex-1" />
        </div>
      </div>
    </div>
  );
};

export default GameScreen;