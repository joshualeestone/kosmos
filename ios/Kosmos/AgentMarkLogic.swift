import Foundation

// kosmos#7488 build 14 (Mona Lisa): a new agent's picture, the desktop's way. The generated mark is the desktop's own
// (web/index.html MARK_FAMS, markFamFor, dotGlyph): the name's first letter left as a hole in a field of 240 dots,
// scattered from the whole name, in one of 14 colour families. The scatter here is the desktop's number for number, so
// the same name draws the same mark on the phone and the Mac; only the letter's outline comes from this font.
enum AgentMark {
    static let families: [[UInt32]] = [
        [0xd6a62e, 0xe3b341, 0xb88920],   // gold
        [0x9c7f3d, 0xb2955a, 0x836626],   // amber
        [0x90a249, 0xa5b566, 0x77892f],   // olive
        [0x59933c, 0x74a95a, 0x437925],   // fern
        [0x47a59e, 0x68b5af, 0x2f8a83],   // teal
        [0x4989a4, 0x6a9fb6, 0x31707f],   // steel
        [0x7f9acb, 0x9bb0d7, 0x6180b8],   // slate
        [0x7d76bf, 0x9a94cf, 0x615ba6],   // indigo
        [0xb289cd, 0xc4a3d9, 0x9d6fbe],   // violet
        [0xb468b2, 0xc489c2, 0x9e4c9c],   // orchid
        [0xc681a8, 0xd49dbb, 0xb76490],   // plum
        [0xb96a7c, 0xc98b98, 0xa54e63],   // rose
        [0xcb847a, 0xd8a099, 0xbd6659],   // brick
        [0xb2784c, 0xc49468, 0x9a6034],   // clay
    ]

    // The desktop's FNV over UTF-16 code units (charCodeAt), with JavaScript's own arithmetic: ^ gives a signed 32-bit
    // value, the multiply is in doubles (which round above 2^53), and >>> 0 keeps the low 32 bits of what that gives.
    static func fnv(_ s: String) -> UInt32 {
        var h: UInt32 = 2166136261
        for u in s.utf16 {
            let x = Int32(bitPattern: h) ^ Int32(u)
            h = UInt32(truncatingIfNeeded: Int64(Double(x) * 16777619.0))   // |product| < 2^55: Int64 holds it exactly
        }
        return h
    }
    static func familyIndex(_ name: String) -> Int { Int(fnv(name) % UInt32(families.count)) }

    // The desktop's generator: JavaScript multiplies in doubles, which round above 2^53, then truncates to 32 bits; the
    // same steps here give the same numbers.
    struct Random {
        var state: Int64
        init(seed name: String) {
            let s = Int64(fnv(name) & 0x7fffffff)
            state = s == 0 ? 1 : s
        }
        mutating func next() -> Double {
            let d = Double(state) * 1103515245.0 + 12345.0
            state = Int64(d) & 0x7fffffff   // d < 2^62: Int64 holds it exactly
            return Double(state) / Double(0x7fffffff)
        }
    }

    struct Dot: Equatable { let x: Double; let y: Double; let r: Double; let color: UInt32 }

    static let side = 256.0       // the drawing's own units (S)
    static let centre = 128.0     // C
    static let radius = 118.0     // R
    static let count = 240

    // `ink(x, y)`: whether the letter covers that point of the 256 x 256 field (the desktop's alpha > 128).
    static func dots(name: String, ink: (Int, Int) -> Bool) -> [Dot] {
        var rnd = Random(seed: name)
        let palette = families[familyIndex(name)]
        var dots: [Dot] = []
        var tries = 0
        while dots.count < count && tries < 40000 {
            tries += 1
            let a = rnd.next() * Double.pi * 2
            let rr = rnd.next().squareRoot() * radius
            let x = centre + cos(a) * rr, y = centre + sin(a) * rr
            let r1 = rnd.next(), r2 = rnd.next()
            let rad = 2.5 + r1 * r2 * 11
            if dots.contains(where: { (($0.x - x) * ($0.x - x) + ($0.y - y) * ($0.y - y)).squareRoot() < $0.r + rad + 2 }) { continue }
            let clear = rad + 2
            var hit = false
            for ox in [-clear, 0, clear] where !hit {
                for oy in [-clear, 0, clear] where !hit {
                    // JavaScript's Math.round as near as doubles allow: halves go up, so -0.5 is 0 (it differs only at the
                    // double just below a half, which no dot reaches in practice).
                    let qx = Int((x + ox + 0.5).rounded(.down)), qy = Int((y + oy + 0.5).rounded(.down))
                    if qx >= 0 && qx < Int(side) && qy >= 0 && qy < Int(side) && ink(qx, qy) { hit = true }
                }
            }
            if hit { continue }
            let pick = min(palette.count - 1, Int((rnd.next() * Double(palette.count)).rounded(.down)))
            dots.append(Dot(x: x, y: y, r: rad, color: palette[pick]))
        }
        return dots
    }

    // The letter the mark leaves as a hole: the first character of the trimmed name, upper-cased, as the desktop's
    // seed[0].toUpperCase() (one UTF-16 unit there; a whole character here, so an emoji name is not split).
    static func letter(_ name: String) -> String? {
        let t = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.first.map { String($0).uppercased() }
    }
}
