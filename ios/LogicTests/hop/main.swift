import Foundation

// kosmos#9091: Hop's rules (HopLogic), run on a Mac. Each test can fail: the collision and clearing tests each carry a
// control run against the opposite case, so a rule that never fires (or always fires) shows as a FAIL.
var failures = 0
func check(_ ok: Bool, _ what: String) { if ok { print("ok   " + what) } else { failures += 1; print("FAIL " + what) } }
let frame = 1.0 / 60

// The hop: one tap rises to the apex and lands back on the ground in about 0.6 s.
var g = HopLogic(seed: 1)
check(g.phase == .ready && !g.airborne, "a new game waits for its first tap, on the ground")
g.step(1); check(g.phase == .ready && g.clusters.isEmpty && g.time == 0, "nothing moves before the first tap")
g.tap()
check(g.phase == .running && g.airborne, "the first tap starts the run with a hop")
var peak = 0.0, t = 0.0
while g.airborne && t < 2 { g.step(frame); t += frame; peak = max(peak, g.height) }
check(abs(peak - HopLogic.apex) < 1, "the hop peaks at the apex (\(Int(peak)) of \(Int(HopLogic.apex)))")
check(abs(t - 2 * HopLogic.timeToApex) < 0.05, "it lands after about 0.6 s (\(String(format: "%.3f", t)) s)")
check(g.height == 0 && g.velocity == 0, "it lands exactly on the ground")

// No hop in the air: a second tap mid-hop changes nothing; a tap on the ground hops again.
var h = HopLogic(seed: 1); h.tap(); for _ in 0..<6 { h.step(frame) }
let before = (h.height, h.velocity); h.tap()
check(h.height == before.0 && h.velocity == before.1, "a tap in the air does not hop again")
while h.airborne { h.step(frame) }
h.tap(); check(h.velocity == HopLogic.hopSpeed, "CONTROL: a tap on the ground does hop")

// Collision, both ways, for every shape: a dot under a grounded player ends the run; the same dot far below a player at
// the apex does not. A graze inside the forgiveness does not count.
for s in HopLogic.shapes.indices {
    let c = HopLogic.Cluster(x: HopLogic.playerX, shape: s)
    check(HopLogic.touches(playerX: HopLogic.playerX, playerY: HopLogic.playerRadius, c), "shape \(s): touching on the ground ends the run")
    check(!HopLogic.touches(playerX: HopLogic.playerX, playerY: HopLogic.playerRadius + HopLogic.apex, c), "CONTROL shape \(s): at the apex it is clear")
}
let graze = HopLogic.Cluster(x: HopLogic.playerX + (HopLogic.playerRadius + HopLogic.dotRadius) * 0.9, shape: 0)
check(!HopLogic.touches(playerX: HopLogic.playerX, playerY: HopLogic.playerRadius, graze), "a graze (90% of the radii apart) is forgiven")

// Score, pace and the end of a run: a player who never taps after the first hop meets the first cluster and the run
// ends with score 0; the best is not lowered.
var idle = HopLogic(seed: 7, best: 12); idle.tap()
var steps = 0
while idle.phase == .running && steps < 60 * 30 { idle.step(frame); steps += 1 }
check(idle.phase == .over && idle.score == 0, "a player who stops tapping is caught by the first cluster (after \(steps) frames)")
check(idle.best == 12, "a short run keeps the earlier best (\(idle.best))")
idle.step(1); check(idle.phase == .over, "nothing moves once the run is over")
idle.tap(); check(idle.phase == .running && idle.score == 0 && idle.clusters.isEmpty && idle.airborne, "a tap after the end starts a fresh run")

check(HopLogic.speed(forScore: 0) == HopLogic.baseSpeed && HopLogic.speed(forScore: 10) > HopLogic.speed(forScore: 0),
      "the pace rises with the score")
check(HopLogic.speed(forScore: 10_000) == HopLogic.maxSpeed, "and stops rising at its ceiling")

// Every run can be won: a player that taps when the next cluster is a fixed lead ahead clears 300 clusters at every
// pace, for several seeds. This also proves each shape is clearable at the top speed. CONTROL: the same player tapping
// too late is caught, so the autopilot's success is the rules', not a game that cannot end.
func autopilot(seed: UInt64, lead: Double, until target: Int) -> HopLogic {
    var a = HopLogic(seed: seed); a.tap()
    var n = 0
    while a.phase == .running && a.score < target && n < 60 * 60 * 20 {
        if !a.airborne, let next = a.clusters.first(where: { !$0.cleared && $0.x > HopLogic.playerX - HopLogic.dotRadius }) {
            let distance = next.x - HopLogic.dotRadius - (HopLogic.playerX + HopLogic.playerRadius)
            if distance < lead * a.speed / HopLogic.baseSpeed { a.tap() }
        }
        a.step(frame); n += 1
    }
    return a
}
for seed: UInt64 in [1, 2, 3, 42, 9091] {
    let a = autopilot(seed: seed, lead: 40, until: 300)
    check(a.phase == .running && a.score >= 300 && a.speed == HopLogic.maxSpeed, "seed \(seed): a well-timed player clears 300 at full pace (score \(a.score))")
}
let late = autopilot(seed: 1, lead: -60, until: 300)
check(late.phase == .over && late.score < 5, "CONTROL: tapping too late is caught early (score \(late.score))")
check(autopilot(seed: 1, lead: 40, until: 300).best >= 300, "the best follows a long run")

// Seeded spawns are deterministic and depend on the seed; all three shapes appear.
func spawns(_ seed: UInt64) -> [Int] {
    var a = HopLogic(seed: seed); a.tap(); var seen: [Int] = []; var lastCount = 0
    for _ in 0..<(60 * 40) {
        if !a.airborne { a.tap() }      // hop forever; a death just restarts, the spawn stream carries on
        if a.phase == .over { a.tap() }
        a.step(frame)
        if a.clusters.count > lastCount, let c = a.clusters.last { seen.append(c.shape) }
        lastCount = a.clusters.count
    }
    return seen
}
let s1 = spawns(5), s2 = spawns(5), s3 = spawns(6)
check(s1.count > 10 && s1 == s2, "the same seed spawns the same clusters (\(s1.count))")
check(s1 != s3, "CONTROL: another seed spawns other clusters")
check(Set(s1) == Set(HopLogic.shapes.indices), "all three shapes appear (\(Set(s1).sorted()))")

// The gap gives about the same reaction time at every pace.
for sp in [HopLogic.baseSpeed, HopLogic.maxSpeed] {
    let lo = (HopLogic.gap(speed: sp, unit: 0) - 160) / sp, hi = (HopLogic.gap(speed: sp, unit: 0.999) - 160) / sp
    check(abs(lo - 0.9) < 1e-9 && abs(hi - 1.6) < 0.001, "at \(Int(sp)) a second, 0.9 s to 1.6 s between clusters")
}

// A long frame (the app was away) is cut, so a stall never jumps a run.
var stall = HopLogic(seed: 3); stall.tap(); stall.step(30)
check(abs(stall.time - HopLogic.maxStep) < 1e-12, "a 30 s frame advances only \(HopLogic.maxStep) s")

// The K lights one dot per cluster cleared, never past whole.
var lit = HopLogic(seed: 1); check(lit.lit(of: 153) == 0, "no dot lit before a cluster is cleared")
let far = autopilot(seed: 2, lead: 40, until: 200)
check(far.lit(of: 153) == 153 && autopilot(seed: 2, lead: 40, until: 20).lit(of: 153) == 20, "one dot per cluster, capped at the whole K")

// The lighting order: every dot once, from the ground up.
let ks: [(x: Double, y: Double, r: Double)] = [(10, 100, 5), (5, 300, 5), (50, 300, 5), (20, 200, 5), (1, 101, 5)]
let order = HopLogic.lightingOrder(ks)
check(order == [1, 2, 3, 4, 0], "bottom row first, left to right within a row (4 and 0 share one), then upward (\(order))")
check(Set(order).count == ks.count, "every dot exactly once")

// The spring: lands exactly home, moves smoothly (no frame jumps more than a fifth of the way), and overshoots little.
let from = (x: 0.0, y: 0.0), home = (x: 400.0, y: -300.0)
let path = HopLogic.Spring.path(from: from, home: home)
check(path.count == HopLogic.Spring.frames, "\(path.count) frames (2.8 s at 30 fps)")
check(path.last!.x == home.x && path.last!.y == home.y, "the last frame is exactly home")
var prev = from, maxJump = 0.0
for p in path { maxJump = max(maxJump, hypot(p.x - prev.x, p.y - prev.y)); prev = p }
check(maxJump < 100, "no frame jumps more than 100 of 500 (\(Int(maxJump)))")
check(hypot(path[10].x - from.x, path[10].y - from.y) > 1, "CONTROL: the dot has started moving by frame 10")

// The best score: kept only when higher, in its own key, on this device.
let suite = "kosmos.hop.tests.\(getpid())"
let d = UserDefaults(suiteName: suite)!
d.removePersistentDomain(forName: suite)
check(HopLogic.loadBest(d) == 0, "no best yet")
HopLogic.saveBest(40, d); HopLogic.saveBest(12, d)
check(HopLogic.loadBest(d) == 40, "a lower score never replaces the best (\(HopLogic.loadBest(d)))")
HopLogic.saveBest(41, d); check(HopLogic.loadBest(d) == 41, "CONTROL: a higher score does")
d.set(-5, forKey: HopLogic.bestKey); check(HopLogic.loadBest(d) == 0, "a bad stored value reads as 0")
d.removePersistentDomain(forName: suite)

print(failures == 0 ? "VERDICT: PASS (hop)" : "VERDICT: FAIL (hop: \(failures) failed)")
exit(failures == 0 ? 0 : 1)
