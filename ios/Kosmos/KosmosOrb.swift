import SwiftUI

/// kosmos#7896 (Josh 2026-11-03), retired on the iPhone by kosmos#8058 (Josh 2026-11-05 18:33: dots only in the mobile
/// app), then back on exactly three whole-screen waits by Josh 2026-11-06 18:14: Allow this iPhone and Connecting to your
/// Mac (AgentsView) and Making <name> (NewAgentView), at AgentsWait.orbSide. The sweep suite fails if any other place draws it.

/// The orb's side on those three waits: Josh, "at least double" the 66 pt the desktop list uses.
enum AgentsWait { static let orbSide: CGFloat = 132 }
/// The geometry is OrbLogic (the desktop's, same seed). 15 frames a second
/// (the .animation schedule pauses with the app in the background; whether it also pauses for a view kept alive out of
/// sight is not verified here); with Reduce Motion on, one still frame with the K facing. VoiceOver hears it as
/// "Loading" unless a caller gives its own label, as ProgressView sites did. Orbs on screen in the same frame share one placing,
/// as the desktop does; measured about 0.19 ms per frame for place and grouping on a Mac.
struct KosmosOrb: View {
    /// The circle's side in points. 20 is a regular ProgressView; 16 and 36 stand for .small and .large.
    var size: CGFloat = 20
    /// The star's gold (kosmos#7034): deep gold in light, a COLOUR that holds 3:1 on the light grounds where the bright
    /// gold measures about 2.1:1, and the bright gold in dark. The orb as drawn (sparse, partly transparent dots) reads
    /// fainter than its colour; how faint at 16 pt on a device is not measured. A caller on a coloured ground passes its own.
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
                // 15 frames a second for every orb: the turn is slow enough that 15 reads the same as 30, at half the
                // drawing, and one rate lets every orb on screen share one placing (review round 4: two rates thrashed it).
                TimelineView(.animation(minimumInterval: 1.0 / 15)) { context in
                    // Wrapped to the 27 s loop: the clock's seconds are far too large for the turn's trigonometry.
                    canvas(OrbLogic.placeShared(context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: OrbLogic.loop)))
                }
            }
        }
        .frame(width: size, height: size)   // expected, not measured: the Canvas fills an explicit colour, so a disabled Button does not dim it (those are disabled because they are working; round 6)
        .accessibilityElement()
        .accessibilityLabel(Text(label))
        .accessibilityAddTraits(reduceMotion ? [] : .updatesFrequently)
    }

    private func canvas(_ pts: [OrbLogic.Placed]) -> some View {
        Canvas { ctx, box in
            let side = Double(min(box.width, box.height))
            let scale = Double(displayScale)
            let groups = OrbLogic.groups(pts, side: side, scale: scale)
            for (k, group) in groups.enumerated() where !group.isEmpty {
                var path = Path()
                for c in group {
                    // A dot under 2 pixels across is filled as a square of the SAME AREA (side r times root pi), which is
                    // far cheaper to fill and paints the same amount of gold: measured on a Mac at 3x, the fill fell from
                    // 2.6 to 0.64 ms per frame at 16 pt (review round 3: the fill, not the placing, is the cost).
                    if c.radius * scale < 1 {
                        let s = c.radius * 1.7724538509055159
                        path.addRect(CGRect(x: c.cx - s / 2, y: c.cy - s / 2, width: s, height: s))
                    } else {
                        path.addEllipse(in: CGRect(x: c.cx - c.radius, y: c.cy - c.radius, width: c.radius * 2, height: c.radius * 2))
                    }
                }
                ctx.opacity = (Double(k) + 0.5) / Double(OrbLogic.steps)
                ctx.fill(path, with: .color(colour))
            }
        }
    }
}
