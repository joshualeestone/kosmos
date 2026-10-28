import SwiftUI

// kosmos#7489 (Josh 10-28 09:41, build 11): + on Projects loaded the board's web page over Kosmos+, which took over a
// minute behind a blank screen. This form opens at once, keeps what was typed, and sends one request on Create
// (NewProject.request, the board's own route). On success it closes and the new project's room opens.
struct NewProjectView: View {
    @ObservedObject var client: BoardClient
    let opened: (String) -> Void   // the new project's id
    @Environment(\.dismiss) private var dismiss
    @State private var draft = NewProject.Draft()
    @State private var sending = false
    @State private var message: String?
    @FocusState private var nameFocused: Bool

    var body: some View {
        NavigationView {
            Form {
                Section {
                    TextField(NewProject.Words.nameExample, text: $draft.name)
                        .focused($nameFocused)
                        .submitLabel(.done)
                        .accessibilityLabel(NewProject.Words.name)
                } header: { Text(NewProject.Words.name) }
                Section {
                    TextField(NewProject.Words.descriptionExample, text: $draft.description, axis: .vertical)
                        .lineLimit(2...6)
                        .accessibilityLabel(NewProject.Words.description)
                } header: { Text(NewProject.Words.description) } footer: { Text(NewProject.Words.descriptionHint) }
                if let message {
                    Section { Text(message).foregroundColor(Palette.dangerWord) }
                }
            }
            .navigationTitle(NewProject.Words.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if sending {
                        ProgressView().accessibilityLabel("Creating the project")
                    } else {
                        Button(NewProject.Words.create) { Task { await create() } }
                            .font(.body.weight(.semibold))
                            .disabled(!NewProject.canCreate(draft))
                    }
                }
            }
            .onAppear { nameFocused = true }
        }
        .navigationViewStyle(.stack)
        .interactiveDismissDisabled(sending)   // never closed mid-send, so an answer always has a sheet to land on
    }

    private func create() async {
        guard !sending, NewProject.canCreate(draft) else { return }
        sending = true
        message = nil
        let sent = draft
        // Another account or Mac while this is in the air: its answer is not this sheet's to show.
        let epoch = client.chatEpoch
        // throughMac answers nil both when nothing was sent and when a send got no answer; only the second may have made
        // the project, so note whether a request was built and handed over (as New task does).
        var built = false
        let got = await client.throughMac { mac in
            let r = NewProject.request(mac: mac, draft: sent)
            built = r != nil
            return r
        }
        sending = false
        guard epoch == client.chatEpoch else { return }
        switch NewProject.result(sent: built, status: got?.1.statusCode ?? 0, body: got?.0) {
        case .made(let id):
            dismiss()
            opened(id)
        case .refused(let why):
            message = why
            UIAccessibility.post(notification: .announcement, argument: why)
        case .unknown:
            message = NewProject.unsureWords
            UIAccessibility.post(notification: .announcement, argument: NewProject.unsureWords)
        }
    }
}
