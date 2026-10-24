import SwiftUI
import UIKit

/// Launch splash in the style of the landing page (web/src/home/intro.ts): the word MOZOL drawn with
/// Jamie "J" marks floats on paper, then its characters scatter to the screen edges while the app fades in.
struct LaunchSplash<Content: View>: View {
    @ViewBuilder var content: Content
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var start = Date.now
    @State private var scatterAt: Date?
    @State private var appVisible = false
    @State private var done = false

    var body: some View {
        ZStack {
            content
                .opacity(appVisible ? 1 : 0)
            if !done {
                SplashCanvas(start: start, scatterAt: scatterAt, reduceMotion: reduceMotion)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
        .task {
            do {
                try await Task.sleep(for: SplashTiming.hold)
                scatterAt = .now
                withAnimation(.easeOut(duration: SplashTiming.appFade).delay(SplashTiming.appFadeDelay)) {
                    appVisible = true
                }
                try await Task.sleep(for: .seconds(SplashTiming.scatter + SplashTiming.scatterSpread))
                done = true
            } catch {
                return
            }
        }
    }
}

private enum SplashTiming {
    static let hold = Duration.seconds(1.4)
    static let scatter = 0.9
    static let scatterSpread = 0.25
    static let appFade = 0.7
    static let appFadeDelay = 0.15
}

private struct SplashCanvas: View {
    let start: Date
    let scatterAt: Date?
    let reduceMotion: Bool
    @State private var cache = SceneCache()

    var body: some View {
        TimelineView(.animation) { timeline in
            Canvas { context, size in
                let now = timeline.date
                let t = reduceMotion ? 0 : now.timeIntervalSince(start)
                let s = scatterAt.map { now.timeIntervalSince($0) } ?? -1
                cache.scene(for: size).draw(in: &context, t: t, scatter: s, reduceMotion: reduceMotion)
            }
        }
    }
}

/// Keeps the sampled scene between frames; rebuilds it only when the canvas size changes.
private final class SceneCache {
    private var scene: SplashScene?

    func scene(for size: CGSize) -> SplashScene {
        if let scene, scene.size == size { return scene }
        let built = SplashScene(size: size)
        scene = built
        return built
    }
}

private struct SplashScene {
    struct Particle {
        let x: CGFloat
        let y: CGFloat
        let shape: Bool
        let dx: CGFloat
        let dy: CGFloat
        let delay: Double
        let tick: String
        let glyphInFlight: String
    }

    struct Label {
        let text: String
        let x: CGFloat
        let y: CGFloat
        let vx: CGFloat
        let vy: CGFloat
    }

    let size: CGSize
    let cw: CGFloat
    let ch: CGFloat
    let particles: [Particle]
    let labels: [Label]
    let jPath: Path

    init(size: CGSize) {
        self.size = size
        let W = size.width
        let H = size.height
        cw = max(6, min(12, W / 140))
        ch = cw * 1.3
        var rand = SplashRandom(seed: 24_102_026)

        let cx = W / 2
        let cy = H / 2
        let maxD = hypot(W, H) / 2
        let word = Self.sampleWord(size: size, cw: cw, ch: ch).map { (x: $0.x, y: $0.y, shape: true) }
        let bgCount = Int(((W / cw) * (H / ch) * 0.025).rounded())
        let ticks = (0..<bgCount).map { _ in (x: rand.next() * W, y: rand.next() * H, shape: false) }

        particles = (word + ticks).map { p in
            let away = atan2(p.y - cy, p.x - cx) + (rand.next() - 0.5) * 1.2
            let dist = maxD * (1.05 + rand.next() * 0.6)
            let dx = cos(away) * dist
            let dy = sin(away) * dist
            return Particle(
                x: p.x,
                y: p.y,
                shape: p.shape,
                dx: dx,
                dy: dy,
                delay: rand.next() * SplashTiming.scatterSpread,
                tick: rand.next() < 0.7 ? "'" : "/",
                glyphInFlight: Self.slash(dx: dx, dy: dy)
            )
        }

        let texts = ["Jamie AI Hack", "Jamie AI Hack", "MOZOL"]
        labels = (0..<max(5, Int((W / 160).rounded()))).map { i in
            Label(text: texts[i % texts.count], x: rand.next() * W, y: rand.next() * H, vx: 4 + rand.next() * 6, vy: (rand.next() - 0.5) * 3)
        }

        let js = cw * 0.92
        jPath = Self.jamieJ.applying(CGAffineTransform(scaleX: js, y: js).translatedBy(x: -0.5, y: -0.5))
    }

    // Steps: background, drifting labels, then every character at its floating or scattering position.
    func draw(in context: inout GraphicsContext, t: Double, scatter s: Double, reduceMotion: Bool) {
        let W = size.width
        let H = size.height
        let fade = s < 0 ? 0 : clamp(s / (SplashTiming.scatter + SplashTiming.scatterSpread))
        let bgAlpha = 1 - ease(fade)
        if bgAlpha > 0 {
            context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Color.paper.opacity(bgAlpha)))
        }

        let labelFont = Font.system(size: max(10, cw * 1.2), design: .monospaced)
        for l in labels {
            let x = (l.x + l.vx * t).truncatingRemainder(dividingBy: W + 160) - 80
            let y = ((l.y + l.vy * t).truncatingRemainder(dividingBy: H) + H).truncatingRemainder(dividingBy: H)
            var c = context
            c.opacity = 0.55 * clamp((t - 0.2) / 0.6 + (reduceMotion ? 1 : 0)) * bgAlpha
            c.draw(Text(l.text).font(labelFont).foregroundStyle(Color.muted), at: CGPoint(x: x, y: y), anchor: .leading)
        }

        let glyphFont = Font.system(size: ch * 0.95, design: .monospaced)
        var resolved: [String: GraphicsContext.ResolvedText] = [:]
        func glyph(_ chr: String) -> GraphicsContext.ResolvedText {
            if let r = resolved[chr] { return r }
            let r = context.resolve(Text(chr).font(glyphFont).foregroundStyle(Color.ink))
            resolved[chr] = r
            return r
        }

        let float = sin(t * 1.4) * ch * 1.2
        for p in particles {
            let raw = s < 0 ? 0 : (s - p.delay) / SplashTiming.scatter
            let e = reduceMotion ? 0 : easeOut(clamp(raw))
            let wave = p.shape ? sin(p.x / W * 9 - t * 1.6) * ch * 0.3 + float : 0
            let x = p.x + p.dx * e
            let y = p.y + wave + p.dy * e
            let base: CGFloat = p.shape ? 1 : 0.3
            var c = context
            c.opacity = base * (1 - clamp(raw))
            guard c.opacity > 0 else { continue }

            if raw > 0 && !reduceMotion {
                c.draw(glyph(p.glyphInFlight), at: CGPoint(x: x, y: y))
            } else if !p.shape {
                c.draw(glyph(p.tick), at: CGPoint(x: x, y: y))
            } else if sin(p.x * 0.018 - p.y * 0.006 - t * 2.2) > 0.94 {
                c.draw(glyph("+"), at: CGPoint(x: x, y: y))
            } else {
                c.fill(jPath.offsetBy(dx: x, dy: y), with: .color(.ink))
            }
        }
    }

    /// Grid cells, one character apart, that fall inside the word MOZOL centered on the screen.
    private static func sampleWord(size: CGSize, cw: CGFloat, ch: CGFloat) -> [CGPoint] {
        let cols = Int((size.width / cw).rounded(.up))
        let rows = Int((size.height / ch).rounded(.up))
        guard let ctx = CGContext(
            data: nil, width: cols, height: rows, bitsPerComponent: 8, bytesPerRow: cols,
            space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue
        ) else {
            fatalError("splash: could not create a \(cols)x\(rows) bitmap")
        }
        guard let bold = UIFont(name: "HelveticaNeue-Bold", size: 100) else {
            fatalError("splash: HelveticaNeue-Bold is missing")
        }
        let probe = NSAttributedString(string: "MOZOL", attributes: [.font: bold]).size().width
        let font = bold.withSize(min(100 * size.width * 0.92 / probe, size.height * 0.3))
        let text = NSAttributedString(string: "MOZOL", attributes: [.font: font, .foregroundColor: UIColor.white])
        let origin = CGPoint(
            x: size.width / 2 - text.size().width / 2,
            y: size.height / 2 + font.capHeight / 2 - font.ascender
        )

        UIGraphicsPushContext(ctx)
        ctx.translateBy(x: 0, y: CGFloat(rows))
        ctx.scaleBy(x: 1 / cw, y: -1 / ch)
        text.draw(at: origin)
        UIGraphicsPopContext()

        guard let data = ctx.data else { fatalError("splash: bitmap has no data") }
        let pixels = data.bindMemory(to: UInt8.self, capacity: cols * rows)
        var points: [CGPoint] = []
        for r in 0..<rows {
            for c in 0..<cols where pixels[r * cols + c] > 120 {
                points.append(CGPoint(x: (CGFloat(c) + 0.5) * cw, y: (CGFloat(r) + 0.5) * ch))
            }
        }
        return points
    }

    private static func slash(dx: CGFloat, dy: CGFloat) -> String {
        var a = atan2(dy, dx)
        if a < 0 { a += .pi }
        if a < .pi / 8 || a > 7 * .pi / 8 { return "-" }
        if a < 3 * .pi / 8 { return "\\" }
        if a < 5 * .pi / 8 { return "|" }
        return "/"
    }

    /// The Jamie "J" mark from the landing page, in a unit square.
    private static let jamieJ: Path = {
        var p = Path()
        func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: (x - 268.012) / 29.19, y: (y - 24) / 29.19)
        }
        p.move(to: pt(284.718, 24))
        p.addLine(to: pt(297.202, 24))
        p.addCurve(to: pt(287.925, 49.5641), control1: pt(297.202, 39.7544), control2: pt(295.965, 49.5641))
        p.addCurve(to: pt(282.884, 46.8982), control1: pt(285.741, 49.5641), control2: pt(284.098, 48.4352))
        p.addCurve(to: pt(276.416, 53.1901), control1: pt(281.615, 50.5693), control2: pt(279.595, 53.1901))
        p.addCurve(to: pt(268.012, 38.683), control1: pt(269.043, 53.1901), control2: pt(268.121, 40.9737))
        p.addLine(to: pt(279.829, 38.683))
        p.addCurve(to: pt(282.884, 46.8982), control1: pt(279.829, 39.649), control2: pt(280.594, 43.9994))
        p.addCurve(to: pt(284.718, 24), control1: pt(285.851, 38.3178), control2: pt(284.718, 24))
        p.closeSubpath()
        return p
    }()
}

/// The landing page's seeded random generator, so the splash field matches it run after run.
private struct SplashRandom {
    private var s: Int32

    init(seed: Int32) { s = seed }

    mutating func next() -> CGFloat {
        s = s &+ 0x6D2B_79F5
        let u = UInt32(bitPattern: s)
        var r = (u ^ (u >> 15)) &* (1 | u)
        r = (r &+ ((r ^ (r >> 7)) &* (61 | r))) ^ r
        return CGFloat(r ^ (r >> 14)) / 4_294_967_296
    }
}

private func clamp(_ v: Double) -> Double { v < 0 ? 0 : v > 1 ? 1 : v }
private func ease(_ p: Double) -> Double { p < 0.5 ? 4 * p * p * p : 1 - pow(-2 * p + 2, 3) / 2 }
private func easeOut(_ p: Double) -> Double { 1 - pow(1 - p, 3) }
