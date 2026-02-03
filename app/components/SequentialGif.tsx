"use client";
import React from "react";

type GifItem = { src: string; durationMs?: number };

export default function SequentialGif({
  gifs,
  loop = false,
  className,
  onComplete,
}: {
  gifs: GifItem[];
  loop?: boolean;
  className?: string;
  onComplete?: () => void;
}) {
  const [index, setIndex] = React.useState(0);
  const timerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!gifs || gifs.length === 0) return;
    const current = gifs[index];
    const dur = current.durationMs ?? 3000; // fallback
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const next = index + 1;
      if (next >= gifs.length) {
        if (loop) setIndex(0);
        else {
          if (onComplete) onComplete();
        }
      } else {
        setIndex(next);
      }
    }, dur);

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [index, gifs, loop, onComplete]);

  if (!gifs || gifs.length === 0) return null;

  return (
    <div className={className}>
      <img src={gifs[index].src} alt={`gif-${index}`} style={{ width: "100%", height: "auto", display: "block" }} />
    </div>
  );
}
