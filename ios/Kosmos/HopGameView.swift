import SwiftUI

// kosmos#9091: Hop, drawn. Shown only under the offline screen's Try again (LoadFailureView, .offline). It draws
// HopLogic's state and nothing else: every rule lives there and is tested by ios/LogicTests/run-hop.sh.
//
// A rounded panel on the app icon's own gold gradient, the icon's K faint behind (one dot lit per cluster cleared,
// flying home on the icon's spring), a dotted ground, the score top left and the best top right. One tap hops. No blue
// anywhere (Josh 11-25). The best score stays on this phone (UserDefaults); the game sends nothing anywhere.
struct HopGameView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    // The world (1000 wide) is drawn into a panel 0.62 as tall as it is wide, with the ground near the foot.
    static let aspect = 0.62
    static let groundAt = 0.8          // the ground line, as a fraction of the panel's height
    static let ink = LoadFailureView.onGold   // the dark of Try again's words: readable on the gold in both appearances

    var body: some View {
        Group {
            if reduceMotion {
                // Reduce Motion: the K, still, and no game (a game is motion by nature). No model is made for it.
                Canvas { gc, size in HopDrawing.panel(&gc, size); HopDrawing.k(&gc, size, lit: [:], now: 0) }
                    .accessibilityHidden(true)
            } else {
                HopPlayView()
            }
        }
        .aspectRatio(1 / Self.aspect, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

/// The game itself, with its model: made only when it is played.
struct HopPlayView: View {
    @StateObject private var model = HopModel()
    @Environment(\.scenePhase) private var scenePhase
    @State private var pressed = false

    var body: some View {
        TimelineView(.animation(paused: !model.ticking)) { context in
            // The rules step here, before this frame's views are built, so the score and the drawing agree.
            let _ = model.advance(to: context.date)
            ZStack(alignment: .top) {
                Canvas { gc, size in
                    model.size = size
                    HopDrawing.panel(&gc, size)
                    HopDrawing.k(&gc, size, lit: model.litAt, now: model.frameClock)
                    HopDrawing.ground(&gc, size, scroll: model.logic.distance)
                    HopDrawing.clusters(&gc, size, model.logic.clusters)
                    HopDrawing.player(&gc, size, height: model.logic.height)
                }
                hud
                hint.frame(maxHeight: .infinity)
            }
        }
        .contentShape(Rectangle())
        // A hop on touch-down, not on lift (review 1: a tap gesture fires on lift, late for a reflex game). One hop per
        // touch: `pressed` holds until the finger lifts.
        .gesture(DragGesture(minimumDistance: 0)
            .onChanged { _ in if !pressed { pressed = true; model.tap() } }
            .onEnded { _ in pressed = false })
        // VoiceOver: one element, never a trap (no direct interaction, so a touch there is still VoiceOver's). It says
        // what it is and the best; a double-tap hops.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Offline game, best \(model.logic.best)")
        .accessibilityHint("Double-tap to hop")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { model.tap() }
        .onDisappear { model.keepBest() }
        .onChange(of: scenePhase) { phase in if phase != .active { model.keepBest() } }
    }

    private var hud: some View {
        HStack {
            Text(model.logic.score, format: .number).monospacedDigit()
            Spacer()
            Text("Best \(model.logic.best.formatted())").monospacedDigit()
        }
        .font(.subheadline.weight(.semibold))
        .foregroundColor(HopGameView.ink)
        .padding(.horizontal, 14).padding(.top, 10)
        .accessibilityHidden(true)
    }

    private var hintWords: String? {
        switch model.logic.phase {
        case .ready: return "Tap to hop over the drifting dots"
        case .over: return "Tap to play again"
        case .running: return nil
        }
    }

    @ViewBuilder private var hint: some View {
        if let words = hintWords {
            Text(words)
                .font(.footnote.weight(.medium))
                .foregroundColor(HopGameView.ink)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 12)
                .accessibilityHidden(true)
        }
    }
}

/// The running game: HopLogic, the clock that drives it, and when each K dot was lit (for its spring).
final class HopModel: ObservableObject {
    private(set) var logic: HopLogic
    /// When each lit K dot (by index into KDots.dots) started flying home, on `frameClock`, and where from.
    private(set) var litAt: [Int: (start: Double, from: CGPoint)] = [:]
    /// Seconds since the model was made, advanced only while ticking; the springs run on it.
    private(set) var frameClock = 0.0
    @Published private(set) var ticking = false
    /// The panel's size at the last drawing, to place a newly lit dot's start on screen.
    var size = CGSize.zero
    private var last: Date?
    private var pauseQueued = false
    private let order = HopLogic.lightingOrder(KDots.dots)

    init() {
        logic = HopLogic(seed: UInt64(Date().timeIntervalSince1970 * 1000), best: HopLogic.loadBest(.standard))
        #if DEBUG
        // KOSMOS_SAMPLE_HOP=<seed>,<frames>: a frozen mid-run frame for screenshots, its lit dots already home.
        if let raw = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_HOP"] {
            let p = raw.split(separator: ",").compactMap { Int($0) }
            logic = HopLogic(seed: UInt64(max(0, p.first ?? 1)), best: 2040)
            logic.autoplay(frames: p.count > 1 ? p[1] : 1800)
            for n in 0..<logic.lit(of: order.count) { litAt[order[n]] = (-100, .zero) }
        }
        #endif
    }

    func tap() {
        let wasOver = logic.phase == .over
        logic.tap()
        if wasOver && logic.phase == .running { litAt = [:] }   // a new run, not a tap the restart delay ignored
        if !ticking { last = nil; ticking = true }
        pauses += 1   // any pause already queued is now stale
    }

    /// Counts taps, so a pause queued before a tap never lands after it (review 1: a tap between the queue and the
    /// pause would otherwise freeze the new run mid-hop).
    private var pauses = 0

    /// Called once a frame: steps the rules by the time since the last frame.
    func advance(to now: Date) {
        guard ticking else { return }
        // A date earlier than the last frame's (a re-run of the same frame) moves nothing and never winds the clock back.
        let dt = max(0, last.map { now.timeIntervalSince($0) } ?? 0)
        if dt > 0 || last == nil { last = now }
        frameClock += min(dt, HopLogic.maxStep)
        let before = logic.lit(of: order.count)
        logic.step(dt)
        let after = logic.lit(of: order.count)
        if after > before {
            let from = HopDrawing.point(size, x: HopLogic.playerX, y: logic.playerY)
            for n in before..<after { litAt[order[n]] = (frameClock, from) }
        }
        let springsDone = litAt.values.allSatisfy { frameClock - $0.start >= Double(HopLogic.Spring.frames) / 30 }
        // Paused once the run is over, its springs are home and a restart is allowed (the delay needs the clock).
        if logic.canRestart && springsDone && !pauseQueued {
            keepBest()
            pauseQueued = true
            let asked = pauses
            // Not while SwiftUI is drawing: the change goes out on the next turn of the main queue, and only if no tap
            // came in between.
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.pauseQueued = false
                if self.pauses == asked && self.logic.phase == .over { self.ticking = false }
            }
        }
    }

    func keepBest() { HopLogic.saveBest(logic.best, .standard) }
}

/// The drawing, in the panel's own points. World x runs 0 to 1000 across; world y is height above the ground.
enum HopDrawing {
    static let cream = Color.white
    static let shade = Color.black.opacity(0.12)

    static func scale(_ size: CGSize) -> Double { size.width / HopLogic.worldWidth }
    static func point(_ size: CGSize, x: Double, y: Double) -> CGPoint {
        CGPoint(x: x * scale(size), y: size.height * HopGameView.groundAt - y * scale(size))
    }
    static func circle(_ c: CGPoint, _ r: Double) -> Path {
        Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r))
    }
    static func rgb(_ v: UInt32) -> Color {
        Color(red: Double(v >> 16 & 0xFF) / 255, green: Double(v >> 8 & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }

    static func panel(_ gc: inout GraphicsContext, _ size: CGSize) {
        gc.fill(Path(CGRect(origin: .zero, size: size)),
                with: .linearGradient(Gradient(colors: [rgb(KDots.top), rgb(KDots.bottom)]),
                                      startPoint: .zero, endPoint: CGPoint(x: 0, y: size.height)))
    }

    /// The K, faint, filling the panel's height; lit dots bright, a newly lit one on its way home.
    static func k(_ gc: inout GraphicsContext, _ size: CGSize, lit: [Int: (start: Double, from: CGPoint)], now: Double) {
        // The K's dots span y 207 to 809 of the icon's 1024 (x centred near 512). It stands ON the ground, between the
        // score line and the ground line, so a lit dot of its foot is never read as a cluster to hop over (the first
        // shots had its foot on and under the ground line).
        let top = size.height * 0.16, foot = size.height * HopGameView.groundAt - 26 * scale(size)
        let s = (foot - top) / 602
        let ox = size.width / 2 - 512 * s, oy = foot - 809 * s
        for (i, d) in KDots.dots.enumerated() {
            let home = CGPoint(x: ox + d.x * s, y: oy + d.y * s), r = d.r * s
            guard let l = lit[i] else { gc.fill(circle(home, r), with: .color(cream.opacity(0.16))); continue }
            let frame = Int((now - l.start) * 30)
            var at = home
            if frame >= 0 && frame < HopLogic.Spring.frames {
                let path = HopLogic.Spring.path(from: (l.from.x, l.from.y), home: (home.x, home.y))
                at = CGPoint(x: path[frame].x, y: path[frame].y)
            }
            gc.fill(circle(at, r), with: .color(cream.opacity(0.7)))   // bright, but under the clusters' 0.9: it is scenery
        }
    }

    static func ground(_ gc: inout GraphicsContext, _ size: CGSize, scroll: Double) {
        let step = 34.0, off = scroll.truncatingRemainder(dividingBy: step)
        var x = step / 2 - off
        while x < HopLogic.worldWidth + step {
            gc.fill(circle(point(size, x: x, y: -16), 4 * scale(size)), with: .color(cream.opacity(0.45)))
            x += step
        }
    }

    static func clusters(_ gc: inout GraphicsContext, _ size: CGSize, _ cs: [HopLogic.Cluster]) {
        let r = HopLogic.dotRadius * scale(size)
        for c in cs { for d in c.dots {
            let p = point(size, x: d.x, y: d.y)
            gc.fill(circle(CGPoint(x: p.x + r * 0.15, y: p.y + r * 0.22), r), with: .color(shade))
            gc.fill(circle(p, r), with: .color(cream.opacity(0.9)))
        } }
    }

    static func player(_ gc: inout GraphicsContext, _ size: CGSize, height: Double) {
        let p = point(size, x: HopLogic.playerX, y: HopLogic.playerRadius + height), r = HopLogic.playerRadius * scale(size)
        gc.fill(circle(p, r * 2.2), with: .color(cream.opacity(0.18)))
        gc.fill(circle(CGPoint(x: p.x + r * 0.17, y: p.y + r * 0.27), r), with: .color(shade))
        gc.fill(circle(p, r), with: .color(cream))
    }
}
