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
            // White ink from the context itself, so the mask does not rest on which colour key CoreText reads.
            ctx.setFillColor(gray: 1, alpha: 1)
            let attrs: [NSAttributedString.Key: Any] = [.font: font,
                NSAttributedString.Key(kCTForegroundColorFromContextAttributeName as String): true]
            let line = CTLineCreateWithAttributedString(NSAttributedString(string: letter, attributes: attrs))
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
    // read already shrunk and upright from its file (never the whole photo in memory), cut to the centred square the
    // desktop's crop editor opens on, and redrawn as a JPEG on white, 512 px down to 128, as the desktop's fitPicture
    // does for a picture with no transparency. nil when it cannot be read or will not fit. Not on the main thread.
    static let maxBytes = 60000
    static let minSide = 16   // the desktop's PICTURE_MIN_SIDE
    static func fit(data: Data) -> Data? {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil),
              let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 1024] as CFDictionary)
        else { return nil }
        let w = CGFloat(cg.width), h = CGFloat(cg.height), square = min(w, h)
        guard square >= 1, let cut = cg.cropping(to: CGRect(x: ((w - square) / 2).rounded(.down), y: ((h - square) / 2).rounded(.down),
                                                           width: square, height: square)) else { return nil }
        let image = UIImage(cgImage: cut)
        // Each size once (a small picture is tried at its own size only), never under the board's smallest side.
        var sides: [CGFloat] = []
        for s in [512.0, 384, 256, 192, 128].map({ max(CGFloat(minSide), min(CGFloat($0), square)) }) where !sides.contains(s) { sides.append(s) }
        for side in sides {
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            format.opaque = true
            let drawn = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).image { r in
                UIColor.white.setFill()
                r.fill(CGRect(x: 0, y: 0, width: side, height: side))
                image.draw(in: CGRect(x: 0, y: 0, width: side, height: side))
            }
            for q in [0.85, 0.7, 0.55] {
                if let out = drawn.jpegData(compressionQuality: q), out.count <= maxBytes { return out }
            }
        }
        return nil
    }

    // A catalogue portrait: a still PNG that fits is kept as it came (the desktop's fitPicture keeps those); anything else
    // is redrawn, as the desktop redraws every WebP and JPEG.
    static func portrait(_ data: Data, type: String) -> (Data, String)? {
        if type == "image/png", data.count <= maxBytes, data.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return (data, type) }
        return fit(data: data).map { ($0, "image/jpeg") }
    }
}
