import SwiftUI

/// kosmos#7896 (Josh 2026-11-03: the KOSMOS orb replaces the spinner everywhere, "on the mobile apps" too): the app's
/// loading mark, in place of ProgressView. The geometry is OrbLogic (the desktop's, same seed). About 30 frames a second
/// (the .animation schedule pauses with the app in the background; whether it also pauses for a view kept alive out of
/// sight is not verified here); with Reduce Motion on, one still frame with the K facing. VoiceOver hears it as
/// "Loading" unless a caller gives its own label, as ProgressView sites did. Each orb places its own dots (the desktop
/// shares one placing across orbs); measured about 0.19 ms per frame for place and grouping on a Mac.
struct KosmosOrb: View {
    /// The circle's side in points. 20 is a regular ProgressView; 16 and 36 stand for .small and .large.
    var size: CGFloat = 20
    /// The star's gold (kosmos#7034): deep gold in light, which holds 3:1 on the light grounds where the bright gold
    /// measures about 2.1:1, and the bright gold in dark. A caller on a coloured ground passes its own.
    var colour: Color = Palette.starGold
    /// What VoiceOver says for it. Sites that labelled their ProgressView pass that label here, rather than stacking a
    /// second accessibilityLabel on top of this one.
    var label: String = "Loading"

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        Group {
            if reduceMotion {
                canvas(OrbLogic.stillDots)
            } else {
                TimelineView(.animation(minimumInterval: 1.0 / 30)) { context in
                    // Wrapped to the 27 s loop: the clock's seconds are far too large for the turn's trigonometry.
                    canvas(OrbLogic.place(context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: OrbLogic.loop)))
                }
            }
        }
        .frame(width: size, height: size)
        .accessibilityElement()
        .accessibilityLabel(Text(label))
        .accessibilityAddTraits(reduceMotion ? [] : .updatesFrequently)
    }

    private func canvas(_ pts: [OrbLogic.Placed]) -> some View {
        Canvas { ctx, box in
            let side = Double(min(box.width, box.height))
            let groups = OrbLogic.groups(pts, side: side, scale: Double(displayScale))
            for (k, group) in groups.enumerated() where !group.isEmpty {
                var path = Path()
                for c in group {
                    path.addEllipse(in: CGRect(x: c.cx - c.radius, y: c.cy - c.radius, width: c.radius * 2, height: c.radius * 2))
                }
                ctx.opacity = (Double(k) + 0.5) / Double(OrbLogic.steps)
                ctx.fill(path, with: .color(colour))
            }
        }
    }
}
