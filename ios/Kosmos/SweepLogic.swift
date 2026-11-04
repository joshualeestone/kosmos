import Foundation

/// kosmos#7954 (Josh 2026-11-04: "use our simple dots that go in a circle since they are smaller"): a port of the board's
/// Sweep loader as its CSS defines it (web/index.html .spin-sweep and @keyframes sweepLite, #2236): eight dots on a ring
/// that light one after another, clockwise from the top. Since #7896 the board draws its orb over those dots once its
/// script runs, so the live board shows the orb; this follows the CSS, not what the board shows today.
/// This file is the arithmetic only, with no UIKit or SwiftUI, so ios/LogicTests/run-sweep.sh can run it on a Mac and
/// pin every constant below to the board's CSS text.
enum SweepLogic {
    static let count = 8
    /// sweepLite's loop in seconds, and how far each dot runs behind the one before (the board's animation-delay steps).
    static let loop = 1.2
    static let step = 0.15
    /// sweepLite's keyframes: at rest, lit at `peakAt` of the loop, back at rest from `restFrom` on.
    static let restOpacity = 0.2
    static let restScale = 0.6
    static let litOpacity = 1.0
    static let litScale = 1.08
    static let peakAt = 0.2
    static let restFrom = 0.72
    /// calmPulse (Reduce Motion): every dot together, `calmHigh` to `calmLow` and back over `calmLoop`, no change of size.
    static let calmLoop = 1.6
    static let calmHigh = 0.85
    static let calmLow = 0.4
    /// A dot's width as a share of the ring's side (the board's --dot: calc(var(--sz)*0.19)).
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

    /// Opacity and scale of one dot at time t (seconds), as sweepLite.
    static func look(_ t: Double, dot i: Int) -> (opacity: Double, scale: Double) {
        var local = (t - Double(i) * step).truncatingRemainder(dividingBy: loop)
        if local < 0 { local += loop }
        let p = local / loop
        let rest = (opacity: restOpacity, scale: restScale), lit = (opacity: litOpacity, scale: litScale)
        func mix(_ a: (opacity: Double, scale: Double), _ b: (opacity: Double, scale: Double), _ k: Double) -> (opacity: Double, scale: Double) {
            (a.opacity + (b.opacity - a.opacity) * k, a.scale + (b.scale - a.scale) * k)
        }
        if p < peakAt { return mix(rest, lit, easeInOut(p / peakAt)) }
        if p < restFrom { return mix(lit, rest, easeInOut((p - peakAt) / (restFrom - peakAt))) }
        return rest
    }

    /// Every dot's opacity with Reduce Motion on (calmPulse).
    static func calmOpacity(_ t: Double) -> Double {
        var local = t.truncatingRemainder(dividingBy: calmLoop)
        if local < 0 { local += calmLoop }
        let p = local / calmLoop
        return p < 0.5 ? calmHigh + (calmLow - calmHigh) * easeInOut(p / 0.5) : calmLow + (calmHigh - calmLow) * easeInOut((p - 0.5) / 0.5)
    }

    /// The eight dots in a box of the given side, dot 0 at the top and the rest clockwise, 45 degrees apart. The ring is
    /// drawn so a lit dot (the largest) still fits inside the box: a view may clip at its edge, where the board's span
    /// does not.
    static func dots(_ t: Double, side: Double, reduceMotion: Bool) -> [Dot] {
        let d = side * dotShare
        let r = side / 2 - d * litScale / 2
        return (0..<count).map { i in
            let a = Double(i) * 2 * .pi / Double(count)
            let (opacity, scale) = reduceMotion ? (calmOpacity(t), 1.0) : look(t, dot: i)
            return Dot(x: side / 2 + r * sin(a), y: side / 2 - r * cos(a), diameter: d * scale, opacity: opacity)
        }
    }
}
