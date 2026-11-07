import SwiftUI

/// Josh 2026-11-06 18:18: "would also be cool if we had some animated free floating dots like we do on the desktop install".
/// The desktop first run's dot field (#fr-dots, frDots in web/index.html), ported with its mechanics: the same five golds
/// over grey, one dot per 8200 square points, radius 1.5 to 5.4, a random drift with soft walls and heavy damping, 60
/// steps a second. The desktop warms the field from grey to gold as its steps advance; sign-in has no steps, so it is drawn
/// at the ramp's half way (warmth 0.5, opacity 0.26), a pale texture behind the words and the white fields.
///
/// Cost: about 40 dots on a phone, five filled paths a frame, at most 30 frames a second, and no frames at all while the
/// app is not active. With Reduce Motion or Low Power Mode the field is settled once and drawn still, with no clock.
struct FloatingDots: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var phase
    @State private var field = DotField()
    /// Low Power Mode holds the field still too (review 3), read when the view is drawn and when the mode changes.
    @State private var lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled

    var body: some View {
        let still = reduceMotion || lowPower
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: still || phase != .active)) { context in
            Canvas { ctx, size in
                field.advance(to: context.date, size: size, still: still)
                field.draw(in: &ctx)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onReceive(NotificationCenter.default.publisher(for: .NSProcessInfoPowerStateDidChange)) { _ in
            lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
        }
    }
}

/// The field's state: a reference type, so a frame can move the dots without asking SwiftUI for another frame.
final class DotField {
    struct Dot { var x: CGFloat; var y: CGFloat; var vx: CGFloat; var vy: CGFloat; let r: CGFloat; let g: Int }

    static let golds: [(Double, Double, Double)] = [(214, 166, 46), (227, 179, 65), (198, 154, 50), (216, 182, 90), (184, 137, 32)]
    static let grey: (Double, Double, Double) = (138, 141, 147)
    static let warmth = 0.5
    static let perDot: CGFloat = 8200
    /// One colour per gold, the desktop's ramp at `warmth`.
    static let colours: [Color] = golds.map { g in
        let mix = { (a: Double, b: Double) in (a + (b - a) * warmth) / 255 }
        return Color(red: mix(grey.0, g.0), green: mix(grey.1, g.1), blue: mix(grey.2, g.2)).opacity(0.13 + 0.26 * warmth)
    }

    private(set) var dots: [Dot] = []
    private var size: CGSize = .zero
    private var last: Date?
    private var settled = false

    /// A new size moves every dot proportionally rather than scattering the field (the desktop's refit), and changes the count.
    func fit(_ s: CGSize) {
        guard s.width > 0, s.height > 0, s != size else { return }
        let old = size
        size = s
        let count = Int((s.width * s.height / Self.perDot).rounded())
        var next: [Dot] = []
        for i in 0..<count {
            if old.width > 0, i < dots.count {
                var d = dots[i]
                d.x *= s.width / old.width; d.y *= s.height / old.height
                next.append(d)
            } else {
                next.append(Dot(x: .random(in: 0...s.width), y: .random(in: 0...s.height), vx: .random(in: -0.3...0.3),
                                vy: .random(in: -0.3...0.3), r: .random(in: 1.5...5.4), g: i % Self.golds.count))
            }
        }
        dots = next
        if old == .zero { for _ in 0..<160 { step() } }   // the desktop's warm start, so the first frame is already drifting
    }

    func step() {
        let mx = size.width * 0.02, my = size.height * 0.03
        for i in dots.indices {
            var d = dots[i]
            d.vx += .random(in: -0.065...0.065); d.vy += .random(in: -0.065...0.065)
            if d.x < mx { d.vx += (mx - d.x) * 0.004 }
            if d.x > size.width - mx { d.vx -= (d.x - (size.width - mx)) * 0.004 }
            if d.y < my { d.vy += (my - d.y) * 0.004 }
            if d.y > size.height - my { d.vy -= (d.y - (size.height - my)) * 0.004 }
            d.vx *= 0.986; d.vy *= 0.986
            d.x += d.vx; d.y += d.vy
            dots[i] = d
        }
    }

    /// The desktop steps 60 times a second; a frame here runs as many steps as the time since the last one asks for
    /// (at most 4, so a long pause does not jump the field). Still: settled once, then never moved.
    func advance(to date: Date, size s: CGSize, still: Bool) {
        fit(s)
        if still {
            if !settled { for _ in 0..<400 { step() }; settled = true }
            last = nil
            return
        }
        let dt = last.map { date.timeIntervalSince($0) } ?? (1.0 / 60)
        last = date
        for _ in 0..<min(4, max(1, Int((dt * 60).rounded()))) { step() }
    }

    func draw(in ctx: inout GraphicsContext) {
        for g in Self.golds.indices {
            var path = Path()
            for d in dots where d.g == g { path.addEllipse(in: CGRect(x: d.x - d.r, y: d.y - d.r, width: d.r * 2, height: d.r * 2)) }
            ctx.fill(path, with: .color(Self.colours[g]))
        }
    }
}
