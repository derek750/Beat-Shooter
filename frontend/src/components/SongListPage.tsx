import { useEffect, useState } from "react";

const API_BASE = "http://localhost:8000";

interface Song {
  id: string;
  url: string;
  prompt?: string;
  duration_ms?: number;
  beats?: number[];
}

interface SongListPageProps {
  onBack: () => void;
  onSelectSong: (songUrl: string) => void;
}

const SongListPage = ({ onBack, onSelectSong }: SongListPageProps) => {
  const [songs, setSongs] = useState<Song[]>([]);

  useEffect(() => {
    const fetchSongs = async () => {
      try {
        const res = await fetch("http://localhost:8000/songs/list");
        const data = await res.json();
        setSongs(data.songs || []);
      } catch (err) {
        console.error(err);
      }
    };
    fetchSongs();
  }, []);

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <button
          onClick={onBack}
          className="font-display text-sm tracking-wider text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          ← BACK
        </button>
        <span className="font-display text-sm tracking-wider text-muted-foreground">
          Saved Songs
        </span>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-2">
        {songs.map((song) => {
          const fullUrl = `${API_BASE}${song.url}`;
          return (
          <div
            key={song.id}
            className="flex items-center justify-between bg-card p-3 rounded-lg cursor-pointer hover:bg-card/80"
            onClick={() => onSelectSong(fullUrl)}
          >
            <span>{song.prompt || "Untitled"}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                const audio = new Audio(fullUrl);
                audio.play();
              }}
              className="px-2 py-1 bg-primary text-primary-foreground rounded-md text-sm"
            >
              Play
            </button>
          </div>
        );})}
      </div>
    </div>
  );
};

export default SongListPage;
