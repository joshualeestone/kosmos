import SwiftUI

/// kosmos#6255: "Help Kosmos grow", once. One link and the iPhone's own share sheet, with a quiet Not now.
struct InviteStepView: View {
    let step: Board.InviteStep
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 16) {
            Text(step.headline).font(.title2.bold()).multilineTextAlignment(.center)
            Text(step.line).multilineTextAlignment(.center)
            if !step.fine.isEmpty { Text(step.fine).font(.footnote).foregroundColor(.secondary).multilineTextAlignment(.center) }
            ShareLink(item: step.link) { Text("Share your invite link").frame(maxWidth: .infinity) }
                .buttonStyle(.borderedProminent)
            Button("Not now") { dismiss() }
        }
        .padding(24)
    }
}
