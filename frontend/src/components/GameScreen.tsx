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
  const [detectedGesture, setDetectedGesture] = useState<string>("");
  const handsRef = useRef<Hands | null>(null);

  // Detect gesture based on hand landmarks
  const detectGesture = (landmarks: any[]): string => {
    if (!landmarks || landmarks.length === 0) return "";

    // Simple finger counting gesture detection
    const handLandmarks = landmarks[0];
    
    // Count extended fingers by comparing y-coordinates
    let fingersUp = 0;
    
    // Thumb (compare x-coordinate for left/right hand)
    if (Math.abs(handLandmarks[4].x - handLandmarks[3].x) > 0.05) fingersUp++;
    
    // Index finger
    if (handLandmarks[8].y < handLandmarks[6].y) fingersUp++;
    
    // Middle finger
    if (handLandmarks[12].y < handLandmarks[10].y) fingersUp++;
    
    // Ring finger
    if (handLandmarks[16].y < handLandmarks[14].y) fingersUp++;
    
    // Pinky
    if (handLandmarks[20].y < handLandmarks[18].y) fingersUp++;

    // Detect specific gestures
    if (fingersUp === 0) return "✊ Fist";
    if (fingersUp === 1) return "☝️ One";
    if (fingersUp === 2) return "✌️ Two";
    if (fingersUp === 3) return "🤟 Three";
    if (fingersUp === 4) return "🖖 Four";
    if (fingersUp === 5) return "🖐️ Open Hand";
    
    return `${fingersUp} fingers`;
  };

  // Initialize MediaPipe Hands
  useEffect(() => {
    const hands = new Hands({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
      },
    });

    hands.setOptions({
      maxNumHands: 2,
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
      if (results.multiHandLandmarks) {
        for (const landmarks of results.multiHandLandmarks) {
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
        }

        // Detect and display gesture
        const gesture = detectGesture(results.multiHandLandmarks);
        setDetectedGesture(gesture);
      } else {
        setDetectedGesture("");
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

    // Set canvas size to match video
    const handleLoadedMetadata = () => {
      if (videoRef.current && canvasRef.current) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
      }
    };

    videoRef.current.addEventListener("loadedmetadata", handleLoadedMetadata);

    return () => {
      videoRef.current?.removeEventListener("loadedmetadata", handleLoadedMetadata);
    };
  }, [stream]);

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <button
          onClick={onBack}
          className="font-display text-sm tracking-wider text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          ← BACK
        </button>
        <span className="font-display text-sm tracking-wider text-muted-foreground">
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
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="max-h-full max-w-full w-full h-full object-contain absolute inset-0 m-auto"
              style={{ aspectRatio: "auto" }}
            />
            
            {/* Canvas overlay for hand landmarks */}
            <canvas
              ref={canvasRef}
              className="max-h-full max-w-full w-full h-full object-contain absolute inset-0 m-auto"
              style={{ aspectRatio: "auto" }}
            />

            {/* Gesture display */}
            {detectedGesture && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/70 px-6 py-3 rounded-lg backdrop-blur-sm">
                <p className="text-white font-display text-lg tracking-wider">
                  {detectedGesture}
                </p>
              </div>
            )}
          </>
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