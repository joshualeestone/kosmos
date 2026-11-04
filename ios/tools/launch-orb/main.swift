import Foundation
import CoreGraphics
import ImageIO
// kosmos#7945: draws the launch screen's orb (LaunchOrb.imageset) from OrbLogic itself, its still frame (the one
// Reduce Motion shows, K facing), as KosmosOrb.canvas draws it: deep gold #9c741b (light), #e3b341 (dark), 1x 2x 3x.
//   render <out-dir> <side-pt>          writes the six PNGs (ios/tools/render-launch-orb.sh)
//   render --check <set-dir> <side-pt>  compares them, decoded, with the committed ones (ios/LogicTests/run-orb.sh)
// The check compares PIXELS, not file bytes: another macOS or Xcode can encode the same picture differently, and
// can anti-alias an edge a step apart, so a channel may differ by a few levels. Beyond that it allows almost nothing:
// one 2 px dot added to a 1x picture fails it.

let args = Array(CommandLine.arguments.dropFirst())
let checking = args.first == "--check"
let rest = checking ? Array(args.dropFirst()) : args
guard rest.count == 2, let side = Double(rest[1]) else {
  FileHandle.standardError.write("usage: render [--check] <dir> <side-pt>\n".data(using: .utf8)!); exit(2)
}
let dir = rest[0]
let golds: [(String, (Double, Double, Double))] = [("light", (0x9c, 0x74, 0x1b)), ("dark", (0xe3, 0xb3, 0x41))]

func draw(_ rgb: (Double, Double, Double), _ scale: Double) -> CGImage {
  let px = Int(side * scale)
  let ctx = CGContext(data: nil, width: px, height: px, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.translateBy(x: 0, y: Double(px)); ctx.scaleBy(x: scale, y: -scale)
  let groups = OrbLogic.groups(OrbLogic.stillDots, side: side, scale: scale)
  for (k, g) in groups.enumerated() where !g.isEmpty {
    let a = (Double(k) + 0.5) / Double(OrbLogic.steps)
    // One path per opacity group, filled once, so dots that overlap inside a group merge rather than stack their alpha.
    let path = CGMutablePath()
    for c in g {
      if c.radius * scale < 1 { let s = c.radius * 1.7724538509055159; path.addRect(CGRect(x: c.cx - s/2, y: c.cy - s/2, width: s, height: s)) }
      else { path.addEllipse(in: CGRect(x: c.cx - c.radius, y: c.cy - c.radius, width: c.radius*2, height: c.radius*2)) }
    }
    ctx.setFillColor(CGColor(srgbRed: rgb.0/255, green: rgb.1/255, blue: rgb.2/255, alpha: a))
    ctx.addPath(path); ctx.fillPath(using: .winding)
  }
  return ctx.makeImage()!
}

// RGBA8 sRGB premultiplied, the same layout for both sides of a comparison.
func pixels(_ image: CGImage) -> [UInt8] {
  let w = image.width, h = image.height
  var buf = [UInt8](repeating: 0, count: w * h * 4)
  let ctx = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
  return buf
}

var stale = 0
for (name, rgb) in golds {
  for scale in [1.0, 2.0, 3.0] {
    let file = "launch-orb-\(name)\(scale == 1 ? "" : "@\(Int(scale))x").png"
    let url = URL(fileURLWithPath: dir).appendingPathComponent(file)
    let image = draw(rgb, scale)
    if checking {
      guard let src = CGImageSourceCreateWithURL(url as CFURL, nil), let have = CGImageSourceCreateImageAtIndex(src, 0, nil),
            have.width == image.width, have.height == image.height else { print("STALE  \(file): missing or a different size"); stale += 1; continue }
      let a = pixels(image), b = pixels(have)
      var far = 0
      for i in 0..<a.count where abs(Int(a[i]) - Int(b[i])) > 8 { far += 1 }
      // An edge a step apart moves a channel a few levels, not 8; one channel in 50,000 is room for a stray edge.
      if far > a.count / 50000 { print("STALE  \(file): \(far) channels differ by more than 8 levels"); stale += 1 }
    } else {
      let d = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil)!
      CGImageDestinationAddImage(d, image, nil)
      guard CGImageDestinationFinalize(d) else { print("could not write \(url.path)"); exit(1) }
    }
  }
}
if stale > 0 { print("run ios/tools/render-launch-orb.sh"); exit(1) }
if !checking { print("ok") }
