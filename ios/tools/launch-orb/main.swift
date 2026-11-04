import Foundation
import CoreGraphics
import ImageIO
// kosmos#7945: draws the launch screen's orb (LaunchOrb.imageset) from OrbLogic itself, its still frame (the one
// Reduce Motion shows, K facing), as KosmosOrb.canvas draws it: deep gold #9c741b (light), #e3b341 (dark), 1x 2x 3x.
// Run ios/tools/render-launch-orb.sh after any change to OrbLogic's seed or drawing.
let out = CommandLine.arguments[1]; let side = Double(CommandLine.arguments[2])!
let golds: [(String, (Double, Double, Double))] = [("light", (0x9c, 0x74, 0x1b)), ("dark", (0xe3, 0xb3, 0x41))]
for (name, rgb) in golds {
  for scale in [1.0, 2.0, 3.0] {
    let px = Int(side * scale)
    let ctx = CGContext(data: nil, width: px, height: px, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.translateBy(x: 0, y: Double(px)); ctx.scaleBy(x: scale, y: -scale)
    let groups = OrbLogic.groups(OrbLogic.stillDots, side: side, scale: scale)
    for (k, g) in groups.enumerated() where !g.isEmpty {
      let a = (Double(k) + 0.5) / Double(OrbLogic.steps)
      ctx.setFillColor(CGColor(srgbRed: rgb.0/255, green: rgb.1/255, blue: rgb.2/255, alpha: a))
      for c in g {
        if c.radius * scale < 1 { let s = c.radius * 1.7724538509055159; ctx.fill(CGRect(x: c.cx - s/2, y: c.cy - s/2, width: s, height: s)) }
        else { ctx.fillEllipse(in: CGRect(x: c.cx - c.radius, y: c.cy - c.radius, width: c.radius*2, height: c.radius*2)) }
      }
    }
    let suffix = scale == 1 ? "" : "@\(Int(scale))x"
    let url = URL(fileURLWithPath: "\(out)/launch-orb-\(name)\(suffix).png")
    let d = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil)!
    CGImageDestinationAddImage(d, ctx.makeImage()!, nil); CGImageDestinationFinalize(d)
  }
}
print("ok")
