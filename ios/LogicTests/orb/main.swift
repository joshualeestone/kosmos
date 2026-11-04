import Foundation

// kosmos#7896: the KOSMOS orb's geometry (OrbLogic), run on a Mac. Each test can fail: the cut test has a control
// that runs the same assertion against the wrong letter and must find dots there.
var failures = 0
func check(_ ok: Bool, _ what: String) { if ok { print("ok   " + what) } else { failures += 1; print("FAIL " + what) } }

// The same orb as the desktop: same count, and the first dot equals the desktop generator's (computed in Node:
// seed 7, Lehmer 16807, the same acceptance rule).
check(OrbLogic.built.dots.count == 2200, "2200 dots")
let d0 = OrbLogic.built.dots[0]
check(abs(d0.x - (-0.57889815307171)) < 1e-12 && abs(d0.y - 0.458741323770369) < 1e-12 && abs(d0.z - 0.06542860859326494) < 1e-12,
      "the first dot is the desktop's (\(d0.x), \(d0.y), \(d0.z))")

// The whole motion matches the desktop's place(), not only the seed: counts and one dot at two times, from the
// desktop's KORB (branch korb-7896) run in Node. A wrong current, skin or rotation would change these.
for (t, count, five) in [(0.0, 1627, [0.8452063859136033, -0.2728998140258443, -0.3439671173454015, 1.1352657144587792, 1.0]),
                         (13.37, 1389, [0.6960424796649778, 0.1062143718928468, 0.6938759658644579, 1.2628409269558456, 1.0])] {
    let p = OrbLogic.place(t)
    let q = p.count > 5 ? [p[5].x, p[5].y, p[5].z, p[5].r, p[5].vis] : []
    check(p.count == count && q.count == 5 && zip(q, five).allSatisfy { abs($0 - $1) < 1e-9 },
          "t = \(t): \(p.count) dots and dot 5 as the desktop's (\(count))")
}

// K O S M O S, one letter per half turn (4.5 s), back to K at 27 s.
let seq = (0..<7).map { OrbLogic.letter(at: Double($0) * 4.5) }
check(seq == [0, 1, 2, 3, 4, 5, 0], "letters at each facing: \(seq)")

// With the K facing (t = 0), no dot shows inside the K's cut, front or back (the cut goes all the way through).
let still = OrbLogic.place(0)
check(still.count > 1000, "\(still.count) dots placed at t = 0")
let insideK = still.filter { OrbLogic.gap(0, $0.x, $0.y) < 0 }.count
check(insideK == 0, "no dot inside the K at t = 0 (\(insideK))")
// CONTROL: the same rule against the S's cut (not being cut at t = 0) finds dots, so the K result is not vacuous.
let insideS = still.filter { OrbLogic.gap(2, $0.x, $0.y) < 0 }.count
check(insideS > 20, "CONTROL: \(insideS) dots sit where the S would be cut")

// The loop is seamless: 27 s is the same frame as 0.
let later = OrbLogic.place(27)
let same = later.count == still.count && zip(later, still).allSatisfy { abs($0.x - $1.x) < 1e-9 && abs($0.y - $1.y) < 1e-9 }
check(same, "t = 27 s draws the same frame as t = 0")

// The shared placing is main-actor isolated; this test's top level is not, so it asks on the main actor (it is on it).
let (a1, a2) = MainActor.assumeIsolated { (OrbLogic.placeShared(5.001), OrbLogic.placeShared(5.004)) }
let b = OrbLogic.place((5.001 * 15).rounded() / 15)
check(a1.count == b.count && zip(a1, b).allSatisfy { $0.x == $1.x && $0.y == $1.y }, "the shared placing equals a fresh one at the same frame")
check(a2.count == a1.count && zip(a2, a1).allSatisfy { $0.x == $1.x }, "two asks within one 15th of a second get the same frame")
let c1 = MainActor.assumeIsolated { OrbLogic.placeShared(6.5) }
check(!(c1.count == a1.count && zip(c1, a1).allSatisfy { $0.x == $1.x }), "a later frame is placed afresh")

// Painting: grouped into 8 strengths, never more circles than dots, every radius at or above the floor.
let groups = OrbLogic.groups(still, side: 16, scale: 2)
let circles = groups.reduce(0) { $0 + $1.count }
check(groups.count == OrbLogic.steps && circles > 0 && circles <= still.count, "\(circles) circles in \(groups.count) groups")
check(groups.joined().allSatisfy { $0.radius >= 0.35 / 2 - 1e-12 } && groups.joined().contains { abs($0.radius - 0.35 / 2) < 1e-12 },
      "every radius at or above the 0.35 px floor, and some at it (a 16 pt orb at 2x)")

print(failures == 0 ? "VERDICT: PASS (orb)" : "VERDICT: FAIL (orb: \(failures) failed)")
exit(failures == 0 ? 0 : 1)
