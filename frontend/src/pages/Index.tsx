import { useState } from "react";
import StartScreen from "@/components/StartScreen";
import GameScreen from "@/components/GameScreen";

const Index = () => {
  const [started, setStarted] = useState(false);

  if (!started) {
    return <StartScreen onStart={() => setStarted(true)} />;
  }

  return <GameScreen onBack={() => setStarted(false)} />;
};

export default Index;
