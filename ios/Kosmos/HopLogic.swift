import Foundation

// kosmos#9091: "Hop", the one-tap game under the iPhone's offline screen. Every rule lives here, with no SwiftUI, so
// ios/LogicTests/run-hop.sh can compile and run it on a Mac: the hop, collision, scoring, the pace, cluster spawning
// from an injected seed, the order the K lights in and the spring a lit dot flies home on. HopGameView only draws it.
//
// The world is 1000 wide in its own units, with the ground at y = 0 and y growing UPWARD. The view scales it into the
// panel. Time is in seconds; step(dt) clamps a long frame so a stall (the app in the background) never jumps a run.

/// A small deterministic generator (SplitMix64). The game takes a seed so a test, and a screenshot, can replay a run.
struct HopRandom {
    private var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
    /// A double in [0, 1).
    mutating func unit() -> Double { Double(next() >> 11) / Double(1 << 53) }
    /// An integer in lo...hi.
    mutating func int(_ lo: Int, _ hi: Int) -> Int { lo + Int(next() % UInt64(hi - lo + 1)) }
}

struct HopLogic {
    // The numbers, in one place. The hop's shape comes from the mock (B-hop.png): a 230 high apex, about 0.6 s in air.
    static let worldWidth = 1000.0
    static let playerX = 150.0
    static let playerRadius = 30.0
    static let dotRadius = 26.0
    static let apex = 230.0
    static let timeToApex = 0.3
    static let gravity = 2 * apex / (timeToApex * timeToApex)    // so that a hop rises exactly `apex`
    static let hopSpeed = gravity * timeToApex
    static let baseSpeed = 360.0          // world units a second at score 0
    static let speedPerPoint = 8.0
    static let maxSpeed = 720.0           // the pace stops rising here (at score 45)
    static let maxStep = 1.0 / 20         // a longer frame is cut to this
    /// Collision forgives a little: two circles must overlap by this fraction of their radii before a run ends, so a
    /// graze that looks clear on screen never counts.
    static let forgiveness = 0.85

    /// The three cluster shapes from the mock, as dot centres relative to the cluster's bottom-left dot, y up.
    static let shapes: [[(x: Double, y: Double)]] = [
        [(0, 0)],
        [(0, 0), (0, 56)],
        [(0, 0), (52, 0), (26, 46)],
    ]

    enum Phase: Equatable { case ready, running, over }

    struct Cluster: Equatable {
        var x: Double           // the left dot's centre
        var shape: Int
        var cleared = false
        var dots: [(x: Double, y: Double)] {
            HopLogic.shapes[shape].map { (x + $0.x, HopLogic.dotRadius + $0.y) }
        }
        var rightEdge: Double { (HopLogic.shapes[shape].map { $0.x }.max() ?? 0) + x + HopLogic.dotRadius }
        static func == (a: Cluster, b: Cluster) -> Bool { a.x == b.x && a.shape == b.shape && a.cleared == b.cleared }
    }

    private(set) var phase: Phase = .ready
    private(set) var score = 0
    private(set) var best: Int
    /// The player's height above resting on the ground (0 = on the ground) and its upward speed.
    private(set) var height = 0.0
    private(set) var velocity = 0.0
    private(set) var clusters: [Cluster] = []
    /// The distance still to travel before the next cluster enters at the right edge.
    private(set) var untilNext = 0.0
    private(set) var time = 0.0
    /// How far the dots have drifted this run, so the ground line can scroll with them.
    private(set) var distance = 0.0
    private var rng: HopRandom

    init(seed: UInt64, best: Int = 0) {
        self.best = max(0, best)
        rng = HopRandom(seed: seed)
        untilNext = HopLogic.worldWidth * 0.4
    }

    var airborne: Bool { height > 0 || velocity > 0 }
    var playerY: Double { HopLogic.playerRadius + height }
    var speed: Double { HopLogic.speed(forScore: score) }
    /// How many dots of the K are lit: one per cluster cleared, until the K is whole.
    func lit(of total: Int) -> Int { min(score, total) }

    static func speed(forScore s: Int) -> Double { min(maxSpeed, baseSpeed + speedPerPoint * Double(max(0, s))) }

    /// The gap before the next cluster, in world units. It grows with the pace, so the time a player has to react
    /// stays about the same as the dots speed up (0.9 s to 1.6 s of travel, plus one cluster's width).
    static func gap(speed: Double, unit: Double) -> Double { speed * (0.9 + 0.7 * unit) + 160 }

    /// One tap. Ready: the run starts with a hop. Running: a hop, only from the ground (no hop in the air). Over: a
    /// fresh run from the same rules (the seed carries on, so the next run's dots are new ones).
    mutating func tap() {
        switch phase {
        case .ready:
            phase = .running
            hop()
        case .running:
            if !airborne { hop() }
        case .over:
            phase = .running
            score = 0
            height = 0; velocity = 0
            clusters = []
            distance = 0
            untilNext = HopLogic.worldWidth * 0.4
            hop()
        }
    }

    private mutating func hop() { velocity = HopLogic.hopSpeed }

    /// Advance the run by dt seconds. Does nothing unless a run is going.
    mutating func step(_ rawDt: Double) {
        guard phase == .running, rawDt > 0 else { return }
        let dt = min(rawDt, HopLogic.maxStep)
        time += dt
        // The hop: constant gravity, landing exactly on the ground.
        if airborne {
            // The exact step for constant gravity, so the hop reaches the same apex at any frame rate.
            height += velocity * dt - 0.5 * HopLogic.gravity * dt * dt
            velocity -= HopLogic.gravity * dt
            if height <= 0 { height = 0; velocity = 0 }
        }
        // The dots drift left at the pace of the score before this frame.
        let move = speed * dt
        for i in clusters.indices { clusters[i].x -= move }
        untilNext -= move
        distance += move
        if untilNext <= 0 {
            let shape = rng.int(0, HopLogic.shapes.count - 1)
            clusters.append(Cluster(x: HopLogic.worldWidth + HopLogic.dotRadius + untilNext, shape: shape))
            untilNext += HopLogic.gap(speed: speed, unit: rng.unit())
        }
        // A touch ends the run; a cluster wholly behind the player scores once.
        if clusters.contains(where: { HopLogic.touches(playerX: HopLogic.playerX, playerY: playerY, $0) }) {
            phase = .over
            best = max(best, score)
            return
        }
        for i in clusters.indices where !clusters[i].cleared && clusters[i].rightEdge < HopLogic.playerX - HopLogic.playerRadius {
            clusters[i].cleared = true
            score += 1
        }
        best = max(best, score)
        clusters.removeAll { $0.rightEdge < -HopLogic.dotRadius }
    }

    /// A player that taps when the next cluster is `lead` ahead (scaled with the pace), for `frames` steps of `dt` or
    /// until `target`. The tests use it to prove every run can be won; a Debug screenshot uses it to reach a mid-run frame.
    mutating func autoplay(frames: Int, dt: Double = 1.0 / 60, lead: Double = 40, until target: Int = .max) {
        if phase != .running { tap() }
        var n = 0
        while phase == .running && score < target && n < frames {
            if !airborne, let next = clusters.first(where: { !$0.cleared && $0.x > HopLogic.playerX - HopLogic.dotRadius }) {
                let gap = next.x - HopLogic.dotRadius - (HopLogic.playerX + HopLogic.playerRadius)
                if gap < lead * speed / HopLogic.baseSpeed { tap() }
            }
            step(dt); n += 1
        }
    }

    static func touches(playerX: Double, playerY: Double, _ c: Cluster) -> Bool {
        let reach = (playerRadius + dotRadius) * forgiveness
        return c.dots.contains { hypot($0.x - playerX, $0.y - playerY) < reach }
    }

    // MARK: the K behind the game

    /// The order the K's dots light in: from the ground up (largest y first in the dots' own top-down coordinates), left
    /// to right within a row, so the K builds like a wall. Rows are 8 units deep at the dots' 1024 scale.
    static func lightingOrder(_ dots: [(x: Double, y: Double, r: Double)]) -> [Int] {
        dots.indices.sorted { a, b in
            let ra = (dots[a].y / 8).rounded(.down), rb = (dots[b].y / 8).rounded(.down)
            if ra != rb { return ra > rb }
            if dots[a].x != dots[b].x { return dots[a].x < dots[b].x }
            return a < b
        }
    }

    /// The spring a newly lit dot flies home on, frame by frame at 30 fps, the icon's own (anim2.py's return): the pull
    /// and the damping both grow smoothly, and the last 12 frames settle it exactly onto its place.
    struct Spring {
        static let frames = 84
        static let settle = 12
        static func smooth(_ t: Double) -> Double { let c = max(0, min(1, t)); return c * c * (3 - 2 * c) }
        /// The path from `from` to `home`, one point a frame; the last point is `home` exactly.
        static func path(from: (x: Double, y: Double), home: (x: Double, y: Double)) -> [(x: Double, y: Double)] {
            var x = from.x, y = from.y, vx = 0.0, vy = 0.0
            var out: [(x: Double, y: Double)] = []
            for k in 0..<frames {
                let u = smooth(Double(k) / Double(frames - 26))
                let kspring = 0.004 + 0.022 * u, damp = 0.01 + 0.17 * u
                vx += (home.x - x) * kspring; vy += (home.y - y) * kspring
                vx *= 1 - damp; vy *= 1 - damp
                x += vx; y += vy
                out.append((x, y))
            }
            for j in 0..<settle {
                let k = frames - settle + j, w = smooth(Double(j + 1) / Double(settle))
                out[k].x += (home.x - out[k].x) * w; out[k].y += (home.y - out[k].y) * w
            }
            return out
        }
    }

    // MARK: the best score, kept on this phone only

    static let bestKey = "kosmos.hop.best"
    static func loadBest(_ d: UserDefaults) -> Int { max(0, d.integer(forKey: bestKey)) }
    /// Writes only a higher score, so a short run never lowers the best.
    static func saveBest(_ s: Int, _ d: UserDefaults) {
        if s > loadBest(d) { d.set(s, forKey: bestKey) }
    }
}
