import Foundation

// kosmos#7954: the iPhone's Sweep loader (SweepLogic) against the board's numbers (web/index.html .spin-sweep and
// @keyframes sweepLite / calmPulse). Each check can fail: the order check has a control that runs the same question
// with the dots reversed and must find it false.
var failures = 0
func check(_ ok: Bool, _ what: String) { if ok { print("ok   " + what) } else { failures += 1; print("FAIL " + what) } }
func near(_ a: Double, _ b: Double, _ e: Double = 1e-9) -> Bool { abs(a - b) < e }

// The easing is CSS ease-in-out: its ends, its midpoint, and one value computed from cubic-bezier(.42,0,.58,1).
check(near(SweepLogic.easeInOut(0), 0) && near(SweepLogic.easeInOut(1), 1) && near(SweepLogic.easeInOut(0.5), 0.5, 1e-6),
      "ease-in-out holds 0, 0.5 and 1")
check(near(SweepLogic.easeInOut(0.25), 0.129161, 1e-4), "ease-in-out(0.25) is the CSS curve's (\(SweepLogic.easeInOut(0.25)))")

// The keyframes: at rest .2 and .6, lit 1 and 1.08 at 20% of the loop, back at rest from 72% on.
let rest = SweepLogic.look(0, dot: 0), lit = SweepLogic.look(0.2 * 1.2, dot: 0), late = SweepLogic.look(0.8 * 1.2, dot: 0)
check(near(rest.opacity, 0.2) && near(rest.scale, 0.6), "dot 0 at rest at t = 0")
check(near(lit.opacity, 1) && near(lit.scale, 1.08), "dot 0 lit at 20% of its loop")
check(near(late.opacity, 0.2) && near(late.scale, 0.6), "dot 0 back at rest at 80% of its loop")
check(near(SweepLogic.look(0.37, dot: 3).opacity, SweepLogic.look(0.37 + 1.2 * 7, dot: 3).opacity), "the loop repeats every 1.2 s")

// Each dot lights 0.15 s after the one before, so the light goes clockwise (dot 0 at the top, dot 2 at the right).
func peak(_ i: Int) -> Double { stride(from: 0.0, to: 1.2, by: 0.001).max { SweepLogic.look($0, dot: i).opacity < SweepLogic.look($1, dot: i).opacity }! }
// The gap is read around the loop (dot 7's peak can land early in the next 1.2 s), so a gap of 0.15 after wrapping.
func gapsOk(_ ps: [Double]) -> Bool { zip(ps, ps.dropFirst()).allSatisfy { a, b in var g = (b - a).truncatingRemainder(dividingBy: 1.2); if g < 0 { g += 1.2 }; return near(g, 0.15, 0.002) } }
let peaks = (0..<8).map(peak)
check(gapsOk(peaks), "each dot peaks 0.15 s after the one before: \(peaks)")
check(!gapsOk(Array(peaks.reversed())), "control: the reversed order fails the same check")

// Geometry: eight dots, a share of .19 of the side, inside the box, dot 0 at the top centre and dot 2 at the right.
let side = 20.0, ds = SweepLogic.dots(0, side: side, reduceMotion: false)
check(ds.count == 8, "eight dots")
check(near(ds[0].x, 10) && near(ds[0].y, side * 0.19 / 2), "dot 0 at the top centre (\(ds[0].x), \(ds[0].y))")
check(near(ds[2].x, side - side * 0.19 / 2) && near(ds[2].y, 10), "dot 2 at the right (\(ds[2].x), \(ds[2].y))")
let big = SweepLogic.dots(0.24, side: side, reduceMotion: false)[0]
check(near(big.diameter, side * 0.19 * 1.08), "a lit dot is 1.08 times its width (\(big.diameter))")
check(stride(from: 0.0, to: 1.2, by: 0.01).allSatisfy { t in SweepLogic.dots(t, side: side, reduceMotion: false).allSatisfy {
    $0.x - $0.diameter / 2 > -0.2 && $0.x + $0.diameter / 2 < side + 0.2 && $0.y - $0.diameter / 2 > -0.2 && $0.y + $0.diameter / 2 < side + 0.2 } },
      "every dot stays within the box (a lit dot overhangs by at most 0.2 pt, as the board's does)")

// Reduce Motion: every dot the same, full size, pulsing .85 to .4 over 1.6 s, never moving.
let calm0 = SweepLogic.dots(0, side: side, reduceMotion: true), calmMid = SweepLogic.dots(0.8, side: side, reduceMotion: true)
check(calm0.allSatisfy { near($0.opacity, 0.85) && near($0.diameter, side * 0.19) }, "Reduce Motion: all at .85, full size, at t = 0")
check(calmMid.allSatisfy { near($0.opacity, 0.4) }, "Reduce Motion: all at .4 halfway through 1.6 s")
check(zip(calm0, calmMid).allSatisfy { near($0.x, $1.x) && near($0.y, $1.y) && near($0.diameter, $1.diameter) }, "Reduce Motion: nothing moves or grows")

// The view wraps the clock at 24 s; a whole number of both loops, so the wrap shows no jump.
check(near(SweepLogic.look(24, dot: 5).opacity, SweepLogic.look(0, dot: 5).opacity) && near(SweepLogic.calmOpacity(24), SweepLogic.calmOpacity(0)),
      "24 s is a whole number of both loops")

print(failures == 0 ? "VERDICT: PASS (sweep)" : "VERDICT: FAIL (sweep: \(failures) failed)")
exit(failures == 0 ? 0 : 1)
