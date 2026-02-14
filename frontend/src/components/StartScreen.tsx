import { useState } from "react";

interface StartScreenProps {
    onStart: () => void;
}

const StartScreen = ({ onStart }: StartScreenProps) => {
    const [isStarting, setIsStarting] = useState(false);

    const handleStart = async () => {
        if (isStarting) return;
        setIsStarting(true);

        try {
            
            const res = await fetch(
                "http://localhost:8000/elevenlabs/generatemusic?prompt=sadmusic%20piano%20arcade%20music&duration=3000"
            );

            const blob = await res.blob();
            
            const audioUrl = URL.createObjectURL(blob);
            
            const audio = new Audio(audioUrl);
            audio.loop = true;
            audio.play();
            

            onStart();
        } catch (err) {
            console.error("Music generation failed:", err);
            onStart();
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-background relative overflow-hidden">
            {/* Background grid */}
            <div
                className="absolute inset-0 opacity-[0.04]"
                style={{
                    backgroundImage:
                        "linear-gradient(hsl(var(--primary)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary)) 1px, transparent 1px)",
                    backgroundSize: "60px 60px",
                }}
            />

            <div className="relative z-10 flex flex-col items-center gap-10 animate-slide-up">
                <h1 className="font-display text-5xl md:text-7xl font-black tracking-wider text-foreground text-center">
                    PIANO
                    <span className="block text-primary">TILES</span>
                </h1>

                <p className="text-muted-foreground text-lg tracking-widest uppercase">
                    Tap the black tiles
                </p>

                <button
                    onClick={handleStart}
                    className="mt-6 px-12 py-4 rounded-lg font-display text-xl font-bold tracking-widest uppercase
            bg-primary text-primary-foreground
            hover:scale-105 active:scale-95 transition-all duration-200
            animate-pulse-glow cursor-pointer"
                >
                    START
                </button>
            </div>
        </div>
    );
};


export default StartScreen;
