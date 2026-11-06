import SwiftUI

/// kosmos#7954 (Josh 2026-11-04: "use our simple dots that go in a circle since they are smaller"): the board's Sweep
/// loader as its CSS defines it, eight gold dots on a ring lighting one after another (SweepLogic has the numbers). It
/// is the iPhone app's only loading indicator (Josh 2026-11-05 18:33: "only use the dots spinner in the mobile app and
/// scrub any other instances", kosmos#8058); run-sweep.sh fails if the orb or the system's spinner is used anywhere.
/// With no label it is hidden from VoiceOver, for a place whose words already say what is loading; with one, VoiceOver
/// reads that label. It grows with the person's text size (unless `scales` is false). Drawn from the clock at 30 frames
/// a second at most by default (`framesPerSecond`), as WorkingDots is; with Reduce Motion the dots stay where they are
/// and pulse together (#4591: still dots read as frozen), unless `stillWhenReduced` holds them still.
struct SweepDots: View {
    /// The ring's side in points at the default text size: the orb's default, which this replaces.
    var size: CGFloat = 20
    var colour: Color = Palette.starGold
    /// What VoiceOver says for it; nil hides it.
    var label: String? = nil
    /// false keeps `size` at every text size. kosmos#7945 follow-up: the Agents tab's wait to connect, which must match
    /// the launch screen's fixed 20 pt picture; its words still grow with the text.
    var scales = true
    /// The most frames a second it draws. kosmos#8058: 15 inside a chat or room's lazy thread, matching the orb it
    /// replaces there; whether 15 avoids #7427 (a clock-drawn view in the thread stopped it following new messages) is
    /// not measured. At 15 the dots step 2-2-2-3 frames each (0.15 s a dot); how that looks on a phone is not measured.
    var framesPerSecond: Double = 30
    /// kosmos#8058: with Reduce Motion, one still frame and no clock, as the orb it replaces did inside a lazy thread,
    /// rather than the pulse, so a Reduce Motion reader gains no clock-drawn view there.
    var stillWhenReduced = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .footnote) private var grow: CGFloat = 1
    /// kosmos#7945 follow-up: the loop runs from when the ring appeared, starting at SweepLogic.launchAt, the frame the
    /// launch screen shows, so the hand-over from launch is that same picture starting to move.
    @State private var shownAt = Date()

    var body: some View {
        let side = scales ? size * grow : size
        let still = reduceMotion && stillWhenReduced
        let drawn = Group {
            if still {
                ring(0, still: true)   // the launch screen's frame (SweepLogic.shown adds launchAt)
            } else {
                TimelineView(.animation(minimumInterval: 1.0 / framesPerSecond)) { tl in
                    let elapsed = tl.date.timeIntervalSince(shownAt)
                    ring(elapsed, still: false)
                }
            }
        }
        .frame(width: side, height: side)
        if let label {
            // It moves with Reduce Motion too (the pulse), unless held still.
            drawn.accessibilityElement().accessibilityLabel(Text(label)).accessibilityAddTraits(still ? [] : .updatesFrequently)
        } else {
            drawn.accessibilityHidden(true)
        }
    }

    private func ring(_ elapsed: Double, still: Bool) -> some View {
        Canvas { ctx, box in
            for d in SweepLogic.shown(elapsed, side: Double(min(box.width, box.height)), reduceMotion: reduceMotion && !still) {
                ctx.opacity = d.opacity
                ctx.fill(Path(ellipseIn: CGRect(x: d.x - d.diameter / 2, y: d.y - d.diameter / 2, width: d.diameter, height: d.diameter)),
                         with: .color(colour))
            }
        }
    }
}

/// kosmos#7945 follow-up (Josh 11-04 on build 43: a big launch orb, then a small one): a first wait to connect that can
/// follow the launch screen, drawn as the launch screen draws it. The ring alone is centred on the SCREEN (a launch image
/// always is; between the bars it would sit a few points off, differently on each iPhone), at one size whatever the text
/// size (the launch picture is fixed), with the words 8 pt below it, laid out across the screen's width less 24 pt each
/// side, so that at the largest text sizes they wrap rather than run off its edges. Used by the Agents tab's wait and the Projects tab's
/// (a launch from a room notification opens on Projects). run-sweep.sh checks this shape; KosmosUITests/
/// LaunchHandoverUITests measures the ring at the screen's centre on a running app.
struct ConnectingWait: View {
    let words: String

    var body: some View {
        SweepDots(scales: false)   // hidden from VoiceOver: the words say what is loading
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .overlay(alignment: .center) {
                Text(words).font(.footnote).foregroundColor(Palette.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 24)
                    // Its top 18 pt below the centre: half the 20 pt ring, then 8 pt. The ring alone is centred.
                    .alignmentGuide(VerticalAlignment.center) { _ in -18 }
            }
            .ignoresSafeArea()
            .accessibilityElement(children: .combine)
    }
}
