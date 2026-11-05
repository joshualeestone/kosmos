import SwiftUI

/// kosmos#7954 (Josh 2026-11-04: "use our simple dots that go in a circle since they are smaller"): the board's Sweep
/// loader as its CSS defines it, eight gold dots on a ring lighting one after another (SweepLogic has the numbers). It
/// stands in for the KOSMOS orb on the Agents tab's wait to connect; every other loading place keeps the orb (#7896).
/// With no label it is hidden from VoiceOver, for a place whose words already say what is loading; with one, VoiceOver
/// reads that label. It grows with the person's text size. Drawn from the clock at 30 frames a second at most, as
/// WorkingDots is; with Reduce Motion the dots stay where they are and pulse together (#4591: still dots read as frozen).
struct SweepDots: View {
    /// The ring's side in points at the default text size: the orb's default, which this replaces.
    var size: CGFloat = 20
    var colour: Color = Palette.starGold
    /// What VoiceOver says for it; nil hides it.
    var label: String? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .footnote) private var grow: CGFloat = 1
    /// kosmos#7945 follow-up: the loop runs from when the ring appeared, starting at SweepLogic.launchAt, the frame the
    /// launch screen shows, so the hand-over from launch is that same picture starting to move.
    @State private var shownAt = Date()

    var body: some View {
        let side = size * grow
        let drawn = TimelineView(.animation(minimumInterval: 1.0 / 30)) { tl in
            // 24 s holds a whole number of both loops (20 of 1.2 s, 15 of 1.6 s): no jump at the wrap.
            let t = (max(0, tl.date.timeIntervalSince(shownAt)) + SweepLogic.launchAt).truncatingRemainder(dividingBy: 24)
            Canvas { ctx, box in
                for d in SweepLogic.dots(t, side: Double(min(box.width, box.height)), reduceMotion: reduceMotion) {
                    ctx.opacity = d.opacity
                    ctx.fill(Path(ellipseIn: CGRect(x: d.x - d.diameter / 2, y: d.y - d.diameter / 2, width: d.diameter, height: d.diameter)),
                             with: .color(colour))
                }
            }
        }
        .frame(width: side, height: side)
        if let label {
            drawn.accessibilityElement().accessibilityLabel(Text(label)).accessibilityAddTraits(.updatesFrequently)   // it moves with Reduce Motion too (the pulse)
        } else {
            drawn.accessibilityHidden(true)
        }
    }
}
