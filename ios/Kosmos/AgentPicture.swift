import UIKit

// kosmos#7488 build 14: a new agent's picture on the phone, the desktop's way (Mona Lisa): the generated mark drawn from
// the name (AgentMark, the desktop's scatter), or a photo the person chose, made to fit the board's picture limit.
enum AgentPicture {
    // What the app sets once the board can see the agent (the desktop's uploadPendingAvatar and tcPortrait).
    struct Pending {
        var photo: Data?            // a chosen photo, already fitted (fit); nil for the mark
        let name: String            // the mark's seed: the name the person typed
        var team: String? = nil     // a ready-made team's member: the catalogue's portrait first
        var slot: String? = nil
    }

    static let markSide: CGFloat = 144   // the desktop's canvas, 144 x 144

    // The letter's outline at the desktop's size (215 pt bold in a 256 field), its ink centred, read as a mask.
    private static func inkMask(_ letter: String) -> [UInt8]? {
        let n = Int(AgentMark.side)
        var px = [UInt8](repeating: 0, count: n * n)
        let ok: Bool = px.withUnsafeMutableBytes { buf in
            guard let ctx = CGContext(data: buf.baseAddress, width: n, height: n, bitsPerComponent: 8, bytesPerRow: n,
                                      space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return false }
            let font = UIFont.systemFont(ofSize: 215, weight: .bold)
            let line = CTLineCreateWithAttributedString(NSAttributedString(string: letter, attributes: [.font: font,
                                                        .foregroundColor: UIColor.white]))
            let ink = CTLineGetImageBounds(line, ctx)
            ctx.textPosition = CGPoint(x: AgentMark.centre - ink.midX, y: AgentMark.centre - ink.midY)
            CTLineDraw(line, ctx)
            return true
        }
        return ok ? px : nil
    }

    // The mark as an image, or nil for a name with nothing in it.
    static func mark(_ name: String) -> UIImage? {
        let seed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let letter = AgentMark.letter(seed), let mask = inkMask(letter) else { return nil }
        let n = Int(AgentMark.side)
        // The bitmap's first row is the top of the picture, as the desktop's canvas reads it.
        let dots = AgentMark.dots(name: seed) { x, y in mask[y * n + x] > 128 }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false
        return UIGraphicsImageRenderer(size: CGSize(width: markSide, height: markSide), format: format).image { r in
            let k = markSide / CGFloat(AgentMark.side)
            for d in dots {
                UIColor(red: CGFloat((d.color >> 16) & 0xff) / 255, green: CGFloat((d.color >> 8) & 0xff) / 255,
                        blue: CGFloat(d.color & 0xff) / 255, alpha: 1).setFill()
                r.cgContext.fillEllipse(in: CGRect(x: (d.x - d.r) * k, y: (d.y - d.r) * k, width: 2 * d.r * k, height: 2 * d.r * k))
            }
        }
    }

    // The board keeps a picture up to 60,000 bytes (the desktop's PICTURE_MAX_BYTES, the community's cap). A photo is
    // redrawn as a JPEG on white, largest side first, as the desktop's fitPicture does for a picture with no
    // transparency; nil when even the smallest will not fit.
    static let maxBytes = 60000
    static func fit(_ image: UIImage) -> Data? {
        let big = max(image.size.width, image.size.height)
        guard big > 0 else { return nil }
        for side in [512.0, 384, 256, 192, 128].map({ min(CGFloat($0), big) }) {
            let k = side / big
            let size = CGSize(width: (image.size.width * k).rounded(), height: (image.size.height * k).rounded())
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            format.opaque = true
            let drawn = UIGraphicsImageRenderer(size: size, format: format).image { r in
                UIColor.white.setFill()
                r.fill(CGRect(origin: .zero, size: size))
                image.draw(in: CGRect(origin: .zero, size: size))
            }
            for q in [0.85, 0.7, 0.55] {
                if let data = drawn.jpegData(compressionQuality: q), data.count <= maxBytes { return data }
            }
        }
        return nil
    }
}
