import SwiftUI

/// kosmos#6255: "Help Kosmos grow", once. One link and the iPhone's own share sheet, with a quiet Not now.
struct InviteStepView: View {
    let step: Board.InviteStep
    let shared: () -> Void
    let notNow: () -> Void
    @State private var pressedShare = false

    var body: some View {
        VStack(spacing: 16) {
            Text(step.headline).font(.title2.bold()).multilineTextAlignment(.center)
            Text(step.line).multilineTextAlignment(.center)
            if !step.fine.isEmpty { Text(step.fine).font(.footnote).foregroundColor(.secondary).multilineTextAlignment(.center) }
            ShareLink(item: step.link) { Text("Share your invite link").frame(maxWidth: .infinity) }
                .buttonStyle(.borderedProminent)
                .simultaneousGesture(TapGesture().onEnded { pressedShare = true; shared() })
            Button(pressedShare ? "Done" : "Not now") { notNow() }
        }
        .padding(24)
        .interactiveDismissDisabled()   // the two buttons are the answers: a swipe must not spend the only offer
    }
}
