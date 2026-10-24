// Intro animation: an ASCII field draws the Jamie mark, then the same characters fly into the word MOZOL.

const J_PATH =
  "M284.718 24H297.202C297.202 39.7544 295.965 49.5641 287.925 49.5641C285.741 49.5641 284.098 48.4352 282.884 46.8982C281.615 50.5693 279.595 53.1901 276.416 53.1901C269.043 53.1901 268.121 40.9737 268.012 38.683H279.829C279.829 39.649 280.594 43.9994 282.884 46.8982C285.851 38.3178 284.718 24 284.718 24Z";
const J_BOX = { x: 268.012, y: 24, w: 29.19, h: 29.19 };
const INK = "#111111";
const BG = "#f3f2ee";
const MUTED = "#8a8a86";
const FONT = 'ui-monospace, "SF Mono", Menlo, monospace';
const LETTER_FONT = '"Arial Black", "Helvetica Neue", Arial, sans-serif';
const T_MORPH = 3.4;
const DUR_IN = 1.5;
const DUR_MORPH = 1.7;
const T_DONE = 6.4;
const ASCII = ["+", "|", "/", "\\", "-", "'"] as const;

type Glyph = (typeof ASCII)[number] | "J";
type Sprite = { img: HTMLCanvasElement; w: number; h: number };
type Point = { x: number; y: number; shape: boolean };
type Particle = {
  ax: number;
  ay: number;
  aShape: boolean;
  bx: number;
  by: number;
  bShape: boolean;
  sx: number;
  sy: number;
  d1: number;
  d2: number;
  arc: number;
  tick: Glyph;
  jitter: number;
};
type Label = { text: string; x: number; y: number; vx: number; vy: number };
type Scene = {
  W: number;
  H: number;
  DPR: number;
  cw: number;
  ch: number;
  sprites: Record<Glyph, Sprite>;
  particles: Particle[];
  labels: Label[];
};

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let r = Math.imul(s ^ (s >>> 15), 1 | s);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

function context2d(c: HTMLCanvasElement, opts?: CanvasRenderingContext2DSettings) {
  const ctx = c.getContext("2d", opts);
  if (!ctx) throw new Error("2D canvas context is not available");
  return ctx;
}

function sampleShape(
  W: number,
  H: number,
  cw: number,
  ch: number,
  draw: (o: CanvasRenderingContext2D) => void,
) {
  const cols = Math.ceil(W / cw);
  const rows = Math.ceil(H / ch);
  const off = document.createElement("canvas");
  off.width = cols;
  off.height = rows;
  const o = context2d(off, { willReadFrequently: true });
  o.scale(1 / cw, 1 / ch);
  o.fillStyle = "#000";
  draw(o);
  const data = o.getImageData(0, 0, cols, rows).data;
  const pts: Point[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if ((data[(r * cols + c) * 4 + 3] ?? 0) > 120)
        pts.push({ x: (c + 0.5) * cw, y: (r + 0.5) * ch, shape: true });
  return pts;
}

function makeSprite(DPR: number, w: number, h: number, paint: (o: CanvasRenderingContext2D) => void): Sprite {
  const img = document.createElement("canvas");
  img.width = Math.ceil(w * DPR);
  img.height = Math.ceil(h * DPR);
  const o = context2d(img);
  o.scale(DPR, DPR);
  paint(o);
  return { img, w, h };
}

function buildSprites(DPR: number, cw: number, ch: number) {
  const sprites = {} as Record<Glyph, Sprite>;
  for (const chr of ASCII) {
    sprites[chr] = makeSprite(DPR, cw, ch, (o) => {
      o.fillStyle = INK;
      o.font = `${ch * 0.95}px ${FONT}`;
      o.textAlign = "center";
      o.textBaseline = "middle";
      o.fillText(chr, cw / 2, ch / 2);
    });
  }
  const js = cw * 0.92;
  const jPath = new Path2D(J_PATH);
  sprites.J = makeSprite(DPR, js, js, (o) => {
    o.fillStyle = INK;
    o.scale(js / J_BOX.w, js / J_BOX.h);
    o.translate(-J_BOX.x, -J_BOX.y);
    o.fill(jPath);
  });
  return sprites;
}

function buildScene(canvas: HTMLCanvasElement, labelTexts: readonly string[]): Scene {
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  const cw = Math.max(6, Math.min(12, W / 140));
  const ch = cw * 1.3;
  const rand = rng(24102026);
  const jPath = new Path2D(J_PATH);

  // Stage 1 target: the Jamie mark, centered.
  const S = Math.min(W * 0.62, H * 0.72);
  const jPts = sampleShape(W, H, cw, ch, (o) => {
    o.translate(W / 2 - S / 2, H / 2 - S / 2);
    o.scale(S / J_BOX.w, S / J_BOX.h);
    o.translate(-J_BOX.x, -J_BOX.y);
    o.fill(jPath);
  });

  // Stage 2 target: the word MOZOL, centered.
  const mPts = sampleShape(W, H, cw, ch, (o) => {
    o.font = `900 100px ${LETTER_FONT}`;
    const size = Math.min((100 * W * 0.86) / o.measureText("MOZOL").width, H * 0.55);
    o.font = `900 ${size}px ${LETTER_FONT}`;
    o.textAlign = "center";
    o.textBaseline = "alphabetic";
    const m = o.measureText("MOZOL");
    o.fillText("MOZOL", W / 2, H / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  });

  // Pad both lists to one size with scattered background ticks, then pair by x.
  const bgCount = Math.round((W / cw) * (H / ch) * 0.025);
  const N = Math.max(jPts.length, mPts.length) + bgCount;
  const pad = (pts: Point[]) => {
    const list = pts.map((p) => ({ ...p, key: p.x + rand() * cw * 2 }));
    while (list.length < N) list.push({ x: rand() * W, y: rand() * H, shape: false, key: rand() * W });
    return list.sort((a, b) => a.key - b.key);
  };
  const A = pad(jPts);
  const B = pad(mPts);
  const maxD = Math.hypot(W, H) / 2;

  const particles = A.map((a, i): Particle => {
    const bi = B[i];
    if (!bi) throw new Error("intro target lists differ in length");
    const b = !a.shape && !bi.shape ? a : bi;
    const ang = rand() * Math.PI * 2;
    const rad = maxD * (0.6 + rand() * 0.7);
    return {
      ax: a.x,
      ay: a.y,
      aShape: a.shape,
      bx: b.x,
      by: b.y,
      bShape: b.shape,
      sx: W / 2 + Math.cos(ang) * rad,
      sy: H / 2 + Math.sin(ang) * rad,
      d1: 0.15 + rand() * 0.45 + (Math.hypot(a.x - W / 2, a.y - H / 2) / maxD) * 0.6,
      d2: T_MORPH + (b.x / W) * 0.9 + rand() * 0.35,
      arc: (rand() - 0.5) * H * 0.35,
      tick: rand() < 0.7 ? "'" : "/",
      jitter: rand() * 0.8,
    };
  });

  const labels = Array.from({ length: Math.max(5, Math.round(W / 160)) }, (_, i) => ({
    text: labelTexts[i % labelTexts.length] ?? "",
    x: rand() * W,
    y: rand() * H,
    vx: 4 + rand() * 6,
    vy: (rand() - 0.5) * 3,
  }));

  return { W, H, DPR, cw, ch, sprites: buildSprites(DPR, cw, ch), particles, labels };
}

function slash(dx: number, dy: number): Glyph {
  let a = Math.atan2(dy, dx);
  if (a < 0) a += Math.PI;
  if (a < Math.PI / 8 || a > (7 * Math.PI) / 8) return "-";
  if (a < (3 * Math.PI) / 8) return "\\";
  if (a < (5 * Math.PI) / 8) return "|";
  return "/";
}

function glyphFor(p: Particle, t: number, raw1: number, raw2: number, e2: number): Glyph {
  if (raw2 > 0 && raw2 < 0.9 && (p.aShape || p.bShape))
    return slash(p.bx - p.ax, p.by - p.ay + Math.cos(Math.PI * e2) * p.arc * 3);
  if (raw2 >= 0.9 && p.bShape) return Math.sin(p.bx * 0.018 - p.by * 0.006 - t * 2.2) > 0.94 ? "+" : "J";
  if (raw1 < 0.95 && p.aShape) return slash(p.ax - p.sx, p.ay - p.sy);
  if (p.aShape && raw2 <= 0) {
    const n = Math.sin(p.ax * 0.03 + t * 1.3) + Math.sin(p.ay * 0.04 - t * 0.9) + p.jitter;
    return n > 1.1 ? "|" : "+";
  }
  return p.tick;
}

function draw(ctx: CanvasRenderingContext2D, s: Scene, t: number) {
  const { W, H, DPR, cw, ch } = s;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // Drifting labels, as on the hackathon poster.
  ctx.font = `${Math.max(10, cw * 1.2)}px ${FONT}`;
  ctx.fillStyle = MUTED;
  ctx.globalAlpha = 0.55 * clamp((t - 0.4) / 1.2);
  for (const l of s.labels) {
    const x = ((l.x + l.vx * t) % (W + 160)) - 80;
    const y = (((l.y + l.vy * t) % H) + H) % H;
    ctx.fillText(l.text, x, y);
  }

  for (const p of s.particles) {
    const raw1 = (t - p.d1) / DUR_IN;
    const raw2 = (t - p.d2) / DUR_MORPH;
    if (raw1 <= 0) continue;
    const e1 = ease(clamp(raw1));
    const e2 = ease(clamp(raw2));

    // Stage 1: fly in and wave like a flag.
    const flag = p.aShape ? Math.sin((p.ay / H) * 7 + t * 1.1) * cw * 0.7 * e1 * (1 - e2) : 0;
    const x1 = lerp(p.sx, p.ax, e1) + flag;
    const y1 = lerp(p.sy, p.ay, e1);

    // Stage 2: arc over to MOZOL, then a soft wave along the word.
    const wave = p.bShape ? Math.sin((p.bx / W) * 9 - t * 1.6) * ch * 0.3 * e2 : 0;
    const x = lerp(x1, p.bx, e2);
    const y = lerp(y1, p.by, e2) + wave + (p.bShape || p.aShape ? Math.sin(Math.PI * e2) * p.arc : 0);

    const alphaA = (p.aShape ? 1 : 0.3) * clamp(raw1 / 0.5);
    const sprite = s.sprites[glyphFor(p, t, raw1, raw2, e2)];
    ctx.globalAlpha = lerp(alphaA, p.bShape ? 1 : 0.3, e2);
    ctx.drawImage(sprite.img, x - sprite.w / 2, y - sprite.h / 2, sprite.w, sprite.h);
  }
  ctx.globalAlpha = 1;
}

// Starts the loop on the canvas; returns the cleanup. `?t=4.5` freezes it at that second, for still frames.
export function startIntro(canvas: HTMLCanvasElement, labelTexts: readonly string[]): () => void {
  const ctx = context2d(canvas);
  const fixed = new URLSearchParams(window.location.search).get("t");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const t0 = performance.now() - (reduceMotion ? T_DONE * 1000 : 0);
  let scene = buildScene(canvas, labelTexts);
  let frameId = 0;

  const frame = (now: number) => {
    draw(ctx, scene, fixed !== null ? Number(fixed) : (now - t0) / 1000);
    frameId = requestAnimationFrame(frame);
  };
  const onResize = () => {
    scene = buildScene(canvas, labelTexts);
  };

  window.addEventListener("resize", onResize);
  frameId = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(frameId);
    window.removeEventListener("resize", onResize);
  };
}
