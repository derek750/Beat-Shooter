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
          onStart={() => setPage("game")}
          onSavedSongs={() => setPage("songs")}
        />
      )}
      {page === "game" && <GameScreen onBack={() => setPage("start")} />}
      {page === "songs" && (
        <SongListPage
          onBack={() => setPage("start")}
          onSelectSong={(songUrl: string) => {
            setCurrentSong(songUrl);
            setPage("game"); // optionally start game with selected song
          }}
        />
      )}
    </>
  );
}

export default App;
