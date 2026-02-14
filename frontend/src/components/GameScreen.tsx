import { useEffect, useRef, useState } from "react";

interface GameScreenProps {
  onBack: () => void;
}

const GameScreen = ({ onBack }: GameScreenProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
