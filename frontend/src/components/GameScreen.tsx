interface GameScreenProps {
  onBack: () => void;
}

const GameScreen = ({ onBack }: GameScreenProps) => {
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
      <div className="flex-1 relative bg-card flex items-center justify-center overflow-hidden">
        <span className="text-muted-foreground font-display text-sm tracking-widest">
          VIDEO PLACEHOLDER
        </span>

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
