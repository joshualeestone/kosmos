import SwiftUI

/// kosmos#7954 (Josh 2026-11-04: "use our simple dots that go in a circle since they are smaller"): the board's Sweep
/// loader as its CSS defines it, eight gold dots on a ring lighting one after another (SweepLogic has the numbers). It
/// stands in for the KOSMOS orb on the first waits to connect (Agents, and Projects since #7945, through ConnectingWait
/// below); other loading places keep the orb (#7896).
/// With no label it is hidden from VoiceOver, for a place whose words already say what is loading; with one, VoiceOver
/// reads that label. It grows with the person's text size (unless `scales` is false). Drawn from the clock at 30 frames a second at most, as
/// WorkingDots is; with Reduce Motion the dots stay where they are and pulse together (#4591: still dots read as frozen).
struct SweepDots: View {
    /// The ring's side in points at the default text size: the orb's default, which this replaces.
    var size: CGFloat = 20
    var colour: Color = Palette.starGold
    /// What VoiceOver says for it; nil hides it.
    var label: String? = nil
    /// false keeps `size` at every text size. kosmos#7945 follow-up: the Agents tab's wait to connect, which must match
    /// the launch screen's fixed 20 pt picture; its words still grow with the text.
    var scales = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .footnote) private var grow: CGFloat = 1
    /// kosmos#7945 follow-up: the loop runs from when the ring appeared, starting at SweepLogic.launchAt, the frame the
    /// launch screen shows, so the hand-over from launch is that same picture starting to move.
    @State private var shownAt = Date()

    var body: some View {
        let side = scales ? size * grow : size
        let drawn = TimelineView(.animation(minimumInterval: 1.0 / 30)) { tl in
            let elapsed = tl.date.timeIntervalSince(shownAt)
            Canvas { ctx, box in
                for d in SweepLogic.shown(elapsed, side: Double(min(box.width, box.height)), reduceMotion: reduceMotion) {
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

/// kosmos#7945 follow-up (Josh 11-04 on build 43: a big launch orb, then a small one): a first wait to connect that can
/// follow the launch screen, drawn as the launch screen draws it. The ring alone is centred on the SCREEN (a launch image
/// always is; between the bars it would sit a few points off, differently on each iPhone), at one size whatever the text
/// size (the launch picture is fixed), with the words 8 pt below it. Used by the Agents tab's wait and the Projects tab's
/// (a launch from a room notification opens on Projects). run-sweep.sh checks this shape; KosmosUITests/
/// LaunchHandoverUITests measures the ring at the screen's centre on a running app.
struct ConnectingWait: View {
    let words: String

    var body: some View {
        SweepDots(scales: false)   // hidden from VoiceOver: the words say what is loading
            .overlay(alignment: .bottom) {
                Text(words).font(.footnote).foregroundColor(Palette.secondary)
                    .fixedSize()
                    .alignmentGuide(.bottom) { _ in -8 }   // its top 8 pt below the ring
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .ignoresSafeArea()
            .accessibilityElement(children: .combine)
    }
}
