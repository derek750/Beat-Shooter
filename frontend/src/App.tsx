import { useState } from "react";
import StartScreen from "./components/StartScreen";
import GameScreen from "./components/GameScreen";
import SongListPage from "./components/SongListPage";

function App() {
  const [currentSong, setCurrentSong] = useState<string | null>(null); // optional: track selected song

  const [page, setPage] = useState<"start" | "game" | "songs">("start");

  return (
    <>
      {page === "start" && (
        <StartScreen
          onStart={(audioUrl) => {
            setCurrentSong(audioUrl ?? null);
            setPage("game");
          }}
          onSavedSongs={() => setPage("songs")}
        />
      )}
      {page === "game" && (
        <GameScreen
          audioUrl={currentSong ?? undefined}
          onBack={() => setPage("start")}
        />
      )}
      {page === "songs" && (
        <SongListPage
          onBack={() => setPage("start")}
          onSelectSong={(songUrl: string) => {
            setCurrentSong(songUrl);
            setPage("game");
          }}
        />
      )}
    </>
  );
}

export default App;
