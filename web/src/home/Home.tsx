import { useEffect, useRef } from "react";
import { copy } from "../copy/en";
import { startIntro } from "./intro";

// Landing home page: the full-screen intro animation.
export function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) throw new Error("intro canvas is not mounted");
    return startIntro(canvas, copy.home.driftingLabels);
  }, []);

  return (
    <main id="main-content" className="home" tabIndex={-1}>
      <h1 className="visually-hidden">{copy.home.title}</h1>
      <canvas ref={canvasRef} role="img" aria-label={copy.home.introLabel} />
    </main>
  );
}
