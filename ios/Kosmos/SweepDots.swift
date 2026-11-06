import SwiftUI

/// kosmos#7954 (Josh 2026-11-04: "use our simple dots that go in a circle since they are smaller"): the board's Sweep
/// loader as its CSS defines it, eight gold dots on a ring lighting one after another (SweepLogic has the numbers). It
/// is the iPhone app's only loading indicator (Josh 2026-11-05 18:33: "only use the dots spinner in the mobile app and
/// scrub any other instances", kosmos#8058); the sweep suite fails if app source in ios/Kosmos or ios/KosmosNotice uses
/// the orb or the system's spinner, pull to refresh included (DotsRefresh, kosmos#8078).
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
    /// The most frames a second it draws. kosmos#8058: 15 inside a chat or room's lazy thread, the orb's rate. Elsewhere
    /// 30, the board's. Whether 15 avoids #7427 (a clock-drawn view in the thread stopped it following new messages) is
    /// not measured. At 15 the dots step 2-2-2-3 frames each (0.15 s a dot); how that looks on a phone is not measured.
    var framesPerSecond: Double = 30
    /// kosmos#8058: with Reduce Motion, one still frame and no clock, as the orb drew everywhere before #8058,
    /// rather than the pulse, so a Reduce Motion reader gains no clock-drawn view inside a lazy thread.
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

// kosmos#8053: over a list that has messages and shows none. See Board.BlankRing. isBlank is asked four times a second from here, never
// in the screen's body, which would redraw the whole list on every row that scrolls in or out. Only time with the app in front counts.
struct BlankListRing: ViewModifier {
    let isBlank: () -> Bool
    let tryAgain: () -> Void
    @State private var phase = Board.BlankRing.none
    @State private var blankFor = 0.0
    @State private var lastLook = Date()
    #if DEBUG
    // KOSMOS_SAMPLE_BLANKRING=<seconds>: reads as blank that long after it starts, since a simulator cannot blank on demand.
    @State private var everShown = false
    @State private var heldFrom = Date()
    private var held: Bool {
        guard let s = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_BLANKRING"].flatMap(Double.init) else { return false }
        return Date().timeIntervalSince(heldFrom) < s
    }
    #endif

    func body(content: Content) -> some View {
        content
            .overlay {
                switch phase {
                case .none: EmptyView()
                case .ring:
                    VStack(spacing: 8) {
                        SweepDots(scales: false)   // Josh 11-05 18:33: dots only in the mobile app, everywhere
                        Text(Board.blankRingWords).font(.footnote).foregroundColor(Palette.secondary).multilineTextAlignment(.center)
                    }
                    .padding(.horizontal, 24).padding(.vertical, 12)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Palette.chatGround))   // legible even if a row is on screen after all
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("blank-ring")
                    .allowsHitTesting(false)
                case .failed:
                    VStack(spacing: 8) {
                        Text(Board.blankRingFailed).font(.footnote).foregroundColor(Palette.secondary).multilineTextAlignment(.center)
                        Button {
                            tryAgain()
                            blankFor = 0
                            phase = .none
                            #if DEBUG
                            heldFrom = Date()
                            #endif
                        } label: {
                            Text("Try again").font(.footnote.weight(.semibold)).foregroundColor(Palette.link)
                                .frame(minWidth: 88, minHeight: 44).contentShape(Rectangle())
                        }
                    }
                    .padding(.horizontal, 24).padding(.vertical, 12)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Palette.chatGround))
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("blank-failed")
                }
            }
            #if DEBUG
            .overlay(alignment: .topLeading) {
                if everShown { Color.clear.frame(width: 1, height: 1).allowsHitTesting(false).accessibilityElement().accessibilityIdentifier("blank-ring-was-shown") }
            }
            #endif
            .task { @MainActor in
                // A fresh start on coming back: time and words from the last visit mean nothing now.
                blankFor = 0
                phase = .none
                lastLook = Date()
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 250_000_000)
                    if !Task.isCancelled { tick() }
                }
            }
    }

    @MainActor private func tick() {
        // Real time, so a stalled main thread (which a blank can be) does not delay the ring. One gap counts for at most half a second, so
        // waking from time away never crosses the second by itself.
        let at = Date()
        let gap = at.timeIntervalSince(lastLook)
        lastLook = at
        guard UIApplication.shared.applicationState == .active else { return }
        #if DEBUG
        let blank = isBlank() || held
        #else
        let blank = isBlank()
        #endif
        blankFor = blank ? blankFor + min(gap, 0.5) : 0
        let now = Board.blankRing(blankFor: blankFor)
        guard now != phase else { return }
        phase = now
        switch now {
        case .none: ChatView.trace("blank: ring gone")
        case .ring:
            ChatView.trace("blank: ring shown")
            UIAccessibility.post(notification: .announcement, argument: Board.blankRingWords)
            #if DEBUG
            everShown = true
            #endif
        case .failed:
            ChatView.trace("blank: ring gave up")
            UIAccessibility.post(notification: .announcement, argument: Board.blankRingFailed)
        }
    }
}
