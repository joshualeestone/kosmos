import Foundation

// kosmos#7954: the iPhone's Sweep loader (SweepLogic). Two halves: its constants are pinned to the board's CSS text
// (web/index.html .spin-sweep, @keyframes sweepLite and calmPulse, read from KOSMOS_REPO), and its motion is checked
// against those constants. Each check can fail: the CSS pins have a control that runs them on a page with one keyframe
// moved and must find it missing, and the order check has a control that reverses the dots and must find it false.
var failures = 0, total = 0
func check(_ ok: Bool, _ what: String) { total += 1; if ok { print("ok   " + what) } else { failures += 1; print("FAIL " + what) } }
func near(_ a: Double, _ b: Double, _ e: Double = 1e-9) -> Bool { abs(a - b) < e }

let repo = URL(fileURLWithPath: ProcessInfo.processInfo.environment["KOSMOS_REPO"] ?? FileManager.default.currentDirectoryPath)
func repoText(_ path: String) -> String { (try? String(contentsOf: repo.appendingPathComponent(path), encoding: .utf8)) ?? "" }

// A number as the board's CSS writes it: whole numbers bare, others without a leading zero (.2, 1.08).
func css(_ x: Double) -> String {
    if x == x.rounded() { return String(Int(x)) }
    let s = String(x)
    return s.hasPrefix("0.") ? String(s.dropFirst()) : s
}
func pct(_ x: Double) -> String { String(Int((x * 100).rounded())) }

// Every rule of the board's Sweep that SweepLogic copies, written from SweepLogic's constants. Returns the ones missing.
func missingPins(_ page: String) -> [String] {
    var want = [
        "--dot: calc(var(--sz)*\(SweepLogic.dotShare))",
        ".spin-sweep i::before { animation: sweepLite \(css(SweepLogic.loop))s ease-in-out infinite; opacity: \(css(SweepLogic.restOpacity)); }",
        "@keyframes sweepLite { 0%, \(pct(SweepLogic.restFrom))%, 100% { opacity: \(css(SweepLogic.restOpacity)); transform: scale(\(css(SweepLogic.restScale))); } "
            + "\(pct(SweepLogic.peakAt))% { opacity: \(css(SweepLogic.litOpacity)); transform: scale(\(css(SweepLogic.litScale))); } }",
        "animation: calmPulse \(css(SweepLogic.calmLoop))s ease-in-out infinite",
        "@keyframes calmPulse { 0%, 100% { opacity: \(css(SweepLogic.calmHigh)); } 50% { opacity: \(css(SweepLogic.calmLow)); } }",
    ]
    for i in 0..<SweepLogic.count {
        want.append(".spin i:nth-child(\(i + 1)) { transform: rotate(\(i * 360 / SweepLogic.count)deg); }")
        var delay = String(format: "%.3f", SweepLogic.loop - SweepLogic.step * Double(i))
        if delay.hasPrefix("0.") { delay.removeFirst() }
        want.append(".spin-sweep i:nth-child(\(i + 1))::before { animation-delay: -\(delay)s; }")
    }
    return want.filter { !page.contains($0) }
}

let page = repoText("web/index.html")
check(!page.isEmpty, "the board's page was read (KOSMOS_REPO)")
let missing = missingPins(page)
check(missing.isEmpty, "every Sweep rule SweepLogic copies is on the board's page as written" + (missing.isEmpty ? "" : ": missing \(missing)"))
check(!missingPins(page.replacingOccurrences(of: "0%, 72%, 100%", with: "0%, 70%, 100%")).isEmpty,
      "control: a page with the rest keyframe moved fails the same pins")

// The easing is CSS ease-in-out: its ends, its midpoint, and one value of cubic-bezier(.42,0,.58,1).
check(near(SweepLogic.easeInOut(0), 0) && near(SweepLogic.easeInOut(1), 1) && near(SweepLogic.easeInOut(0.5), 0.5, 1e-6),
      "ease-in-out holds 0, 0.5 and 1")
check(near(SweepLogic.easeInOut(0.25), 0.129161, 1e-4), "ease-in-out(0.25) is the CSS curve's (\(SweepLogic.easeInOut(0.25)))")

// The keyframes: at rest, lit at 20% of the loop, falling until 72% and at rest from there on.
let L = SweepLogic.loop
let rest = SweepLogic.look(0, dot: 0), lit = SweepLogic.look(0.2 * L, dot: 0)
check(near(rest.opacity, 0.2) && near(rest.scale, 0.6), "dot 0 at rest at t = 0")
check(near(lit.opacity, 1) && near(lit.scale, 1.08), "dot 0 lit at 20% of its loop")
let falling = SweepLogic.look(0.715 * L, dot: 0), landed = SweepLogic.look(0.72 * L, dot: 0), late = SweepLogic.look(0.8 * L, dot: 0)
check(falling.opacity > 0.2 + 1e-6 && falling.opacity < 0.21, "dot 0 still falling just before 72% (\(falling.opacity))")
check(near(landed.opacity, 0.2) && near(landed.scale, 0.6) && near(late.opacity, 0.2) && near(late.scale, 0.6), "dot 0 at rest at 72% and after")
check(near(SweepLogic.look(0.37, dot: 3).opacity, SweepLogic.look(0.37 + L * 7, dot: 3).opacity), "the loop repeats every 1.2 s")

// Each dot lights 0.15 s after the one before, so the light goes clockwise (dot 0 at the top, dot 2 at the right). The
// gap is read around the loop (dot 7's peak can land early in the next 1.2 s).
func peak(_ i: Int) -> Double { stride(from: 0.0, to: L, by: 0.001).max { SweepLogic.look($0, dot: i).opacity < SweepLogic.look($1, dot: i).opacity }! }
func gapsOk(_ ps: [Double]) -> Bool { zip(ps, ps.dropFirst()).allSatisfy { a, b in var g = (b - a).truncatingRemainder(dividingBy: L); if g < 0 { g += L }; return near(g, 0.15, 0.002) } }
let peaks = (0..<8).map(peak)
check(gapsOk(peaks), "each dot peaks 0.15 s after the one before: \(peaks)")
check(!gapsOk(Array(peaks.reversed())), "control: the reversed order fails the same check")

// Geometry: eight dots a share of .19 of the side wide, dot 0 at the top centre and dot 2 at the right, with the ring
// pulled in so a lit dot touches the edge and never crosses it.
let side = 20.0, edge = side * 0.19 * 1.08 / 2, ds = SweepLogic.dots(0, side: side, reduceMotion: false)
check(ds.count == 8, "eight dots")
check(near(ds[0].x, 10) && near(ds[0].y, edge), "dot 0 at the top centre (\(ds[0].x), \(ds[0].y))")
check(near(ds[2].x, side - edge) && near(ds[2].y, 10), "dot 2 at the right (\(ds[2].x), \(ds[2].y))")
let big = SweepLogic.dots(0.24, side: side, reduceMotion: false)[0]
check(near(big.diameter, side * 0.19 * 1.08), "a lit dot is 1.08 times its width (\(big.diameter))")
check(stride(from: 0.0, to: L, by: 0.005).allSatisfy { t in SweepLogic.dots(t, side: side, reduceMotion: false).allSatisfy {
    $0.x - $0.diameter / 2 >= -1e-9 && $0.x + $0.diameter / 2 <= side + 1e-9 && $0.y - $0.diameter / 2 >= -1e-9 && $0.y + $0.diameter / 2 <= side + 1e-9 } },
      "every dot stays inside the box at every moment of the loop")

// Reduce Motion: every dot the same, full size, pulsing .85 to .4 over 1.6 s, never moving.
let calm0 = SweepLogic.dots(0, side: side, reduceMotion: true), calmMid = SweepLogic.dots(0.8, side: side, reduceMotion: true)
check(calm0.allSatisfy { near($0.opacity, 0.85) && near($0.diameter, side * 0.19) }, "Reduce Motion: all at .85, full size, at t = 0")
check(calmMid.allSatisfy { near($0.opacity, 0.4) }, "Reduce Motion: all at .4 halfway through 1.6 s")
check(zip(calm0, calmMid).allSatisfy { near($0.x, $1.x) && near($0.y, $1.y) && near($0.diameter, $1.diameter) }, "Reduce Motion: nothing moves or grows")

// The view wraps the clock at 24 s, a whole number of both loops, so the wrap shows no jump.
check(near(SweepLogic.look(24, dot: 5).opacity, SweepLogic.look(0, dot: 5).opacity) && near(SweepLogic.calmOpacity(24), SweepLogic.calmOpacity(0)),
      "24 s is a whole number of both loops")

print(failures == 0 ? "VERDICT: PASS \(total)/\(total)" : "VERDICT: FAIL \(total - failures)/\(total)")
exit(failures == 0 ? 0 : 1)
