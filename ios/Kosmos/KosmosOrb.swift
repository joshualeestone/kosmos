import SwiftUI

/// kosmos#7896 (Josh 2026-11-03: the KOSMOS orb replaces the spinner everywhere, "on the mobile apps" too): the app's
/// loading mark, in place of ProgressView. The geometry is OrbLogic (the desktop's, same seed). About 30 frames a second
/// while it is on screen (SwiftUI stops a TimelineView that is not shown); with Reduce Motion on, one still frame with
/// the K facing. VoiceOver hears it as "Loading" unless a caller gives its own label, as ProgressView sites did.
struct KosmosOrb: View {
    /// The circle's side in points. 20 is a regular ProgressView; 16 and 36 stand for .small and .large.
    var size: CGFloat = 20
    /// The Kosmos gold (the desktop's --gold); a caller on a coloured ground can pass its own.
    var colour: Color = Color(red: 0xD6 / 255.0, green: 0xA6 / 255.0, blue: 0x2E / 255.0)
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
        .accessibilityAddTraits(.updatesFrequently)
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
