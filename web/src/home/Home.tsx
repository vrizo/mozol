import { type CSSProperties, useLayoutEffect, useRef } from "react";
import { copy } from "../copy/en";
import { fixedIntroTime, startIntro, T_TEXT } from "./intro";

// Landing home page: the full-screen intro animation, then a short text about MOZOL.
export function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const fixed = fixedIntroTime();
  const t = copy.home.about;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const content = contentRef.current;
    if (!canvas || !content) throw new Error("home page is not mounted");
    return startIntro(canvas, copy.home.driftingLabels, (wordBottom) => {
      content.style.setProperty("--word-bottom", `${wordBottom}px`);
    });
  }, []);

  const timing = { "--text-at": `${T_TEXT - (fixed ?? 0)}s` } as CSSProperties;

  return (
    <main id="main-content" className="home" tabIndex={-1} data-frozen={fixed !== null || undefined}>
      <h1 className="visually-hidden">{copy.home.title}</h1>
      <canvas ref={canvasRef} role="img" aria-label={copy.home.introLabel} />
      <div ref={contentRef} className="home-content" style={timing}>
        <section className="about" aria-label={t.label}>
          <div>
            <p className="about-kicker reveal" style={{ "--i": 0 } as CSSProperties}>
              {t.kicker}
            </p>
            <p className="about-text reveal" style={{ "--i": 1 } as CSSProperties}>
              {t.description}
            </p>
            <div className="about-actions reveal" style={{ "--i": 2 } as CSSProperties}>
              <a className="about-button" href="/signup">
                {t.signUp}
                <span aria-hidden="true"> -&gt;</span>
              </a>
              <a className="about-link" href="/signin">
                {t.signIn}
              </a>
            </div>
          </div>
          <div className="about-side reveal" style={{ "--i": 3 } as CSSProperties}>
            <p className="about-side-label">{t.hackathonLabel}</p>
            <div className="about-logos">
              <img src="/images/jamie-logo.svg" alt={t.jamieAlt} width="40" height="40" />
              <img src="/images/tech-europe-logo.svg" alt={t.techEuropeAlt} width="40" height="40" />
            </div>
            <p className="about-side-text">{t.hackathon}</p>
          </div>
        </section>
      </div>
    </main>
  );
}
