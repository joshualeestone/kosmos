import Foundation

/// kosmos#7954 (Josh 2026-11-04: "use our simple dots that go in a circle since they are smaller"): the board's Sweep
/// loader (web/index.html .spin-sweep, #2236), eight dots on a ring that light one after another, clockwise from the
/// top. This file is the arithmetic only, with no UIKit or SwiftUI, so ios/LogicTests/run-sweep.sh can run it on a Mac.
/// The numbers are the board's: a 1.2 s loop, dot i 0.15 s behind the one before it, each dot at opacity .2 and scale .6
/// at rest, rising to 1 and 1.08 at 20% of its loop and falling back by 72%, each step eased as CSS ease-in-out.
/// Reduce Motion is the board's calmPulse: every dot together, opacity .85 to .4 and back over 1.6 s, no change of size.
enum SweepLogic {
    static let count = 8
    static let loop = 1.2
    static let step = 0.15
    static let calmLoop = 1.6
    /// A dot's width as a share of the ring's side (the board's --dot: calc(var(--sz) * 0.19)).
    static let dotShare = 0.19

    struct Dot: Equatable {
        var x: Double        // centre, in the box's points
        var y: Double
        var diameter: Double // after scaling
        var opacity: Double
    }

    /// CSS ease-in-out, cubic-bezier(.42, 0, .58, 1): the y for a given x, by bisection on the curve's x.
    static func easeInOut(_ x: Double) -> Double {
        if x <= 0 { return 0 }
        if x >= 1 { return 1 }
        func bez(_ s: Double, _ p1: Double, _ p2: Double) -> Double {
            let u = 1 - s
            return 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s
        }
        var lo = 0.0, hi = 1.0
        for _ in 0..<40 {
            let mid = (lo + hi) / 2
            if bez(mid, 0.42, 0.58) < x { lo = mid } else { hi = mid }
        }
        return bez((lo + hi) / 2, 0, 1)
    }

    /// Opacity and scale of one dot at time t (seconds), as the board's @keyframes sweepLite.
    static func look(_ t: Double, dot i: Int) -> (opacity: Double, scale: Double) {
        var local = (t - Double(i) * step).truncatingRemainder(dividingBy: loop)
        if local < 0 { local += loop }
        let p = local / loop
        let rest = (opacity: 0.2, scale: 0.6), lit = (opacity: 1.0, scale: 1.08)
        func mix(_ a: (opacity: Double, scale: Double), _ b: (opacity: Double, scale: Double), _ k: Double) -> (opacity: Double, scale: Double) {
            (a.opacity + (b.opacity - a.opacity) * k, a.scale + (b.scale - a.scale) * k)
        }
        if p < 0.2 { return mix(rest, lit, easeInOut(p / 0.2)) }
        if p < 0.72 { return mix(lit, rest, easeInOut((p - 0.2) / 0.52)) }
        return rest
    }

    /// Every dot's opacity with Reduce Motion on (the board's calmPulse): all together, no movement and no growth.
    static func calmOpacity(_ t: Double) -> Double {
        var local = t.truncatingRemainder(dividingBy: calmLoop)
        if local < 0 { local += calmLoop }
        let p = local / calmLoop
        return p < 0.5 ? 0.85 + (0.4 - 0.85) * easeInOut(p / 0.5) : 0.4 + (0.85 - 0.4) * easeInOut((p - 0.5) / 0.5)
    }

    /// The eight dots in a box of the given side, dot 0 at the top and the rest clockwise, 45 degrees apart.
    static func dots(_ t: Double, side: Double, reduceMotion: Bool) -> [Dot] {
        let d = side * dotShare
        let r = side / 2 - d / 2
        return (0..<count).map { i in
            let a = Double(i) * 2 * .pi / Double(count)
            let (opacity, scale) = reduceMotion ? (calmOpacity(t), 1.0) : look(t, dot: i)
            return Dot(x: side / 2 + r * sin(a), y: side / 2 - r * cos(a), diameter: d * scale, opacity: opacity)
        }
    }
}
