interface StartScreenProps {
  onStart: () => void;
}

const StartScreen = ({ onStart }: StartScreenProps) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background relative overflow-hidden">
      {/* Background grid effect */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--primary)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary)) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-10 animate-slide-up">
        <h1
          className="font-display text-5xl md:text-7xl font-black tracking-wider text-foreground text-center"
          style={{ textShadow: "var(--glow-primary)" }}
        >
          PIANO
          <span className="block text-primary">TILES</span>
        </h1>

        <p className="text-muted-foreground text-lg tracking-widest uppercase">
          Tap the black tiles
        </p>

        <button
          onClick={onStart}
          className="mt-6 px-12 py-4 rounded-lg font-display text-xl font-bold tracking-widest uppercase
            bg-primary text-primary-foreground
            hover:scale-105 active:scale-95 transition-all duration-200
            animate-pulse-glow cursor-pointer"
          style={{ boxShadow: "var(--glow-primary)" }}
        >
          START
        </button>
      </div>
    </div>
  );
};

export default StartScreen;
