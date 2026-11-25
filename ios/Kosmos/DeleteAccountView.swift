import SwiftUI
import UIKit

// kosmos#8959 slice C: Settings' "Delete account", native, where the web page at /delete-account used to open. Five
// screens over the page's four routes, with the page's words (DeleteAccountLogic.swift): the email, the emailed code, a
// second-step code (only when Kosmos+ opens one), the confirm screen (red only on its last button, which works only once
// "I understand" is ticked), and the answer (deleted, still deleting, or could not, with Try again on the same grant).
// After a deletion, leaving the done screen signs this iPhone out through Settings' own path, as the page forgets every
// session it holds. In a sample run (screenshots) it never asks Kosmos+.
struct DeleteAccountView: View {
    let coordinator: URL
    let currentSession: () -> String?
    /// The account is gone: this iPhone signs out (Settings' signedOut, with the session it held).
    let deleted: (String) -> Void
    var sample = false

    private enum Step: Equatable {
        case email
        case code(email: String)
        case second(email: String, kind: String, challenge: String, sentTo: String?)
        case confirm(DeleteAccount.Grant)
        case done(email: String)
        case pending
        case failed(DeleteAccount.Grant)
        case unknown
    }

    @Environment(\.dismiss) private var dismiss
    @State private var step: Step = .email
    @State private var email = ""
    @State private var code = ""
    @State private var understood = false
    @State private var busy = false
    @State private var note: String?
    // The session held when the flow began, signed out once the account is gone.
    @State private var heldSession: String?
    // Whose account this iPhone holds, when Kosmos+ said (/v1/account/me): another account's deletion signs nothing out.
    @State private var ownEmail: String?
    // The account typed here is deleted (set the moment Kosmos+ says so, whatever screen shows).
    @State private var gone = false
    @State private var goneEmail: String?
    @State private var signedOutDone = false
    @State private var visible = false
    @State private var sent: String?
    // A confirm on the grant shown went out and no answer came back (DeleteAccount.Outcome.unknown).
    @State private var answerLost = false
    // "Send the code again" waits after a send, as the page's (DeleteAccount.resendWait).
    @State private var resendLocked = false
    @State private var resendGeneration = 0
    @AccessibilityFocusState private var answerFocus: Bool

    var body: some View {
        List { content }
            .listStyle(.insetGrouped)
            .navigationTitle(navTitle)
            .navigationBarTitleDisplayMode(.inline)
            // No way back while a confirm is out (it can take a while) or once the answer is shown. The tab bar still
            // leaves; a deletion answered then signs out at the answer (`visible`), and a tab switch on the done screen
            // counts as leaving it.
            .navigationBarBackButtonHidden(isAnswer || confirming)
            .toolbar {
                if isAnswer {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { leave() }.accessibilityIdentifier("delete-done")
                    }
                }
            }
            .task { await prefill() }
            .onAppear { visible = true }
            .onDisappear { visible = false; signOutIfDeleted() }
    }

    private var confirming: Bool {
        guard busy else { return false }
        switch step { case .confirm, .failed: return true; default: return false }
    }

    private var isAnswer: Bool {
        switch step { case .done, .pending, .unknown: return true; default: return false }
    }

    private var navTitle: String {
        switch step {
        case .email: return DeleteAccount.title
        case .code: return DeleteAccount.codeTitle
        case .second: return DeleteAccount.secondTitle
        case .confirm: return "Delete account"
        case .done, .pending, .failed, .unknown: return "Delete account"
        }
    }

    @ViewBuilder private var content: some View {
        switch step {
        case .email: emailScreen
        case .code(let email): codeScreen(email: email)
        case .second(_, let kind, let challenge, let sentTo): secondScreen(kind: kind, challenge: challenge, sentTo: sentTo)
        case .confirm(let grant): confirmScreen(grant)
        case .done(let email): doneScreen(email: email)
        case .pending: pendingScreen
        case .failed(let grant): failedScreen(grant)
        case .unknown: unknownScreen
        }
    }

    // MARK: 1. The email

    @ViewBuilder private var emailScreen: some View {
        Section {
            TextField("Email", text: $email)
                .textContentType(.emailAddress).keyboardType(.emailAddress)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .disabled(busy)
                .onSubmit { Task { await start() } }
                .accessibilityIdentifier("delete-email")
            Button { Task { await start() } } label: { busyLabel(DeleteAccount.continueWord) }
                .disabled(busy || email.trimmingCharacters(in: .whitespaces).isEmpty)
                .accessibilityIdentifier("delete-send")
        } header: {
            Text(DeleteAccount.title)
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                Text(DeleteAccount.intro)
                noteLine
            }
        }
        explain(DeleteAccount.howTitle, DeleteAccount.howWords)
        explain(DeleteAccount.whatTitle, DeleteAccount.whatWords)
        explain(DeleteAccount.keptTitle, DeleteAccount.keptWords)
    }

    // MARK: 2 and 3. The codes

    @ViewBuilder private func codeScreen(email: String) -> some View {
        Section {
            codeField { Task { await verify(email: email) } }
            Button { Task { await verify(email: email) } } label: { busyLabel(DeleteAccount.continueWord) }
                .disabled(busy || code.isEmpty).accessibilityIdentifier("delete-verify")
        } header: {
            Text(DeleteAccount.codeTitle)
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                Text(DeleteAccount.codeWords(email: email))
                if let sent { Text(sent).accessibilityIdentifier("delete-sent") }
                noteLine
            }
        }
        // Kosmos+'s refusals for a used-up or expired code say "ask for a new one": this is where.
        Section {
            Button(DeleteAccount.sendAgain) { Task { await resend(email: email) } }.disabled(busy || resendLocked).accessibilityIdentifier("delete-resend")
        }
        startAgainSection
    }

    @ViewBuilder private func secondScreen(kind: String, challenge: String, sentTo: String?) -> some View {
        Section {
            codeField { Task { await second(challenge: challenge) } }
            Button { Task { await second(challenge: challenge) } } label: { busyLabel(DeleteAccount.continueWord) }
                .disabled(busy || code.isEmpty).accessibilityIdentifier("delete-verify2")
        } header: {
            Text(DeleteAccount.secondTitle)
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                Text(DeleteAccount.secondWords(kind: kind, sentTo: sentTo))
                noteLine
            }
        }
        startAgainSection
    }

    private func codeField(submit: @escaping () -> Void) -> some View {
        TextField("Six-digit code", text: $code)
            .textContentType(.oneTimeCode).keyboardType(.numberPad)
            .font(code.isEmpty ? .body : .system(.title2, design: .monospaced))
            .disabled(busy)
            .onSubmit(submit)
            .accessibilityIdentifier("delete-code")
    }

    private var startAgainSection: some View {
        Section {
            Button(DeleteAccount.startAgain) { startOver(nil) }.disabled(busy).accessibilityIdentifier("delete-start-again")
        }
    }

    // MARK: 4. Confirm

    @ViewBuilder private func confirmScreen(_ grant: DeleteAccount.Grant) -> some View {
        let p = grant.preview
        Section {
            Text(DeleteAccount.deletingFor(p.email ?? email)).foregroundColor(Palette.primary)
        } header: {
            Text(DeleteAccount.confirmTitle).font(.headline).foregroundColor(Palette.primary).textCase(nil)
        }
        Section {
            ForEach(DeleteAccount.deletes, id: \.self) { Text($0).foregroundColor(Palette.primary) }
        } header: { Text(DeleteAccount.deletesTitle) }
        explain(DeleteAccount.notDeletedTitle, DeleteAccount.notDeletedWords)
        if let company = DeleteAccount.companyWords(p.onlyAdminOf) {
            explain(DeleteAccount.companyTitle, company)
        }
        explain(DeleteAccount.subscriptionTitle, DeleteAccount.subscriptionWords(p.subscription))
        explain(DeleteAccount.keptTitle, DeleteAccount.keepWords(p.subscription))
        Section {
            // A box to tick, as the page's: the hint under the button says "Tick the box above".
            Button { understood.toggle() } label: {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Image(systemName: understood ? "checkmark.square.fill" : "square")
                        .foregroundColor(understood ? Palette.primary : Palette.secondary)
                    Text(DeleteAccount.understood).foregroundColor(Palette.primary)
                }
            }
            .disabled(busy)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(DeleteAccount.understood)
            .accessibilityValue(understood ? "Ticked" : "Not ticked")
            .accessibilityAddTraits(understood ? [.isButton, .isSelected] : .isButton)
            .accessibilityIdentifier("delete-understood")
            // Red only here. It stays pressable while unticked (as the page's aria-disabled) so its hint can be heard, and
            // does nothing until the box is ticked.
            Button { if understood { Task { await confirm(grant) } } } label: {
                busyLabel(DeleteAccount.deleteButton, color: understood ? Palette.dangerWord : Palette.secondary)
            }
            .disabled(busy)
            .accessibilityHint(understood ? "" : DeleteAccount.tickHint)
            .accessibilityIdentifier("delete-go")
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                if !understood { Text(DeleteAccount.tickHint) }
                noteLine
            }
        }
        // Not after a lost answer: the account may already be gone, and "Keep" would say otherwise.
        if !answerLost {
            Section {
                Button(DeleteAccount.keepButton) { dismiss() }.disabled(busy).accessibilityIdentifier("delete-keep")
            }
        }
    }

    // MARK: 5. The answer

    @ViewBuilder private func doneScreen(email: String) -> some View {
        Section {
            Text(DeleteAccount.doneNote(email)).foregroundColor(Palette.primary)
            Text(DeleteAccount.doneWords).foregroundColor(Palette.primary)
        } header: {
            Text(DeleteAccount.doneTitle).font(.headline).foregroundColor(Palette.primary).textCase(nil)
                .accessibilityAddTraits(.isHeader).accessibilityIdentifier("delete-done-title")
                .accessibilityFocused($answerFocus)
        }
    }

    private var pendingScreen: some View {
        Section {
            Text(DeleteAccount.pendingWords).foregroundColor(Palette.primary)
            Text(DeleteAccount.pendingClose).foregroundColor(Palette.primary)
        } header: {
            Text(DeleteAccount.pendingTitle).font(.headline).foregroundColor(Palette.primary).textCase(nil)
                .accessibilityAddTraits(.isHeader).accessibilityIdentifier("delete-pending-title")
                .accessibilityFocused($answerFocus)
        }
    }

    private var unknownScreen: some View {
        Section {
            Text(DeleteAccount.unknownWords).foregroundColor(Palette.primary)
        } header: {
            Text(DeleteAccount.unknownTitle).font(.headline).foregroundColor(Palette.primary).textCase(nil)
                .accessibilityAddTraits(.isHeader).accessibilityIdentifier("delete-unknown-title")
                .accessibilityFocused($answerFocus)
        }
    }

    @ViewBuilder private func failedScreen(_ grant: DeleteAccount.Grant) -> some View {
        Section {
            Text(DeleteAccount.failedWords).foregroundColor(Palette.primary)
            Button { Task { await confirm(grant) } } label: { busyLabel(DeleteAccount.tryAgain) }
                .disabled(busy).accessibilityIdentifier("delete-retry")
        } header: {
            Text(DeleteAccount.failedTitle).font(.headline).foregroundColor(Palette.primary).textCase(nil)
                .accessibilityAddTraits(.isHeader).accessibilityIdentifier("delete-failed-title")
                .accessibilityFocused($answerFocus)
        } footer: { noteLine }
        Section {
            Button(DeleteAccount.keepButton) { dismiss() }.disabled(busy)
        }
    }

    // MARK: Pieces

    private func explain(_ title: String, _ words: String) -> some View {
        Section {
            Text(words).foregroundColor(Palette.primary)
        } header: { Text(title) }
    }

    @ViewBuilder private var noteLine: some View {
        if let note { Text(note).foregroundColor(Palette.dangerWord).accessibilityIdentifier("delete-note") }
    }

    private func busyLabel(_ title: String, color: Color = Palette.primary) -> some View {
        HStack {
            Text(title).foregroundColor(color)
            if busy { Spacer(); ProgressView() }
        }
    }

    // MARK: Asking Kosmos+

    // One ephemeral session refusing redirects, as the account screen uses: nothing is cached to disk.
    private static let http = URLSession(configuration: .ephemeral, delegate: RefuseRedirects(), delegateQueue: nil)

    private func send(_ r: URLRequest) async -> (Int, Any?)? { await sendTelling(r).answer }

    /// The answer, or why there was none (the URLError's code; nil for any other failure).
    private func sendTelling(_ r: URLRequest) async -> (answer: (Int, Any?)?, error: URLError.Code?) {
        do {
            let (data, answer) = try await Self.http.data(for: r)
            guard let http = answer as? HTTPURLResponse else { return (nil, nil) }
            return ((http.statusCode, try? JSONSerialization.jsonObject(with: data)), nil)
        } catch let e as URLError {
            return (nil, e.code)
        } catch {
            return (nil, nil)
        }
    }

    /// The account's own email, when this iPhone is signed in and Kosmos+ says it. The field stays editable.
    @MainActor private func prefill() async {
        guard heldSession == nil else { return }
        heldSession = sample ? "sample" : currentSession()
        if sample { if email.isEmpty { email = "you@example.com" }; ownEmail = "you@example.com"; return }
        // Read whatever the field holds: whose account this iPhone holds decides the sign-out after a deletion.
        guard let session = heldSession else { return }
        var r = URLRequest(url: coordinator.appendingPathComponent(String(SignIn.mePath.dropFirst())))
        r.setValue("Bearer \(session)", forHTTPHeaderField: "Authorization")
        r.timeoutInterval = 15
        r.httpShouldHandleCookies = false
        r.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (status, json) = await send(r), let found = SignIn.accountEmail(status: status, json: json) else { return }
        ownEmail = found
        if email.isEmpty, step == .email { email = found }
    }

    @MainActor private func start() async {
        guard !busy else { return }
        guard let address = DeleteAccount.email(email) else { note = DeleteAccount.notAnEmail; return }
        busy = true; note = nil
        defer { busy = false }
        let answer: (Int, Any?)? = sample ? (200, ["ok": true]) : await send(DeleteAccount.startRequest(coordinator: coordinator, email: address))
        guard let (status, json) = answer else { note = DeleteAccount.unreachable; return }
        lockResend(DeleteAccount.resendWait(status: status, json: json))
        switch DeleteAccount.started(status: status, json: json) {
        case .sent: code = ""; sent = nil; step = .code(email: address)
        case .refused(let sentence): note = sentence
        }
    }

    @MainActor private func lockResend(_ secs: Int) {
        resendGeneration += 1
        let mine = resendGeneration
        resendLocked = secs > 0
        guard secs > 0 else { return }
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(secs) * 1_000_000_000)
            if resendGeneration == mine { resendLocked = false }
        }
    }

    /// The page's "Send the code again": the same start, for the address the code screen names.
    @MainActor private func resend(email address: String) async {
        guard !busy else { return }
        busy = true; note = nil; sent = nil
        defer { busy = false }
        let answer: (Int, Any?)? = sample ? (200, ["ok": true]) : await send(DeleteAccount.startRequest(coordinator: coordinator, email: address))
        guard let (status, json) = answer else { note = DeleteAccount.unreachable; return }
        lockResend(DeleteAccount.resendWait(status: status, json: json))
        switch DeleteAccount.started(status: status, json: json) {
        case .sent: code = ""; sent = DeleteAccount.newCodeSent
        case .refused(let sentence): note = sentence
        }
    }

    @MainActor private func verify(email address: String) async {
        guard !busy else { return }
        sent = nil
        guard let typed = SignIn.code(code) else { note = AccountSecond.codeNotSix; return }
        busy = true; note = nil
        defer { busy = false }
        let sampleGrant: [String: Any] = ["grant": "sample", "preview": ["email": address, "plan": "subscription", "onlyAdminOf": ["Sample Co"]]]
        let answer: (Int, Any?)? = sample ? (200, sampleGrant) : await send(DeleteAccount.verifyRequest(coordinator: coordinator, email: address, code: typed))
        guard let (status, json) = answer else { note = DeleteAccount.unreachable; return }
        take(DeleteAccount.checked(status: status, json: json), email: address)
    }

    @MainActor private func second(challenge: String) async {
        guard !busy, case .second(let address, _, _, _) = step else { return }
        guard let typed = SignIn.code(code) else { note = AccountSecond.codeNotSix; return }
        busy = true; note = nil
        defer { busy = false }
        guard let (status, json) = await send(DeleteAccount.secondRequest(coordinator: coordinator, challenge: challenge, code: typed)) else {
            note = DeleteAccount.unreachable; return
        }
        take(DeleteAccount.checked(status: status, json: json), email: address)
    }

    @MainActor private func take(_ checked: DeleteAccount.Checked, email address: String) {
        switch checked {
        case .grant(let grant): code = ""; sent = nil; understood = false; answerLost = false; step = .confirm(grant)
        case .second(let kind, let challenge, let sentTo): code = ""; sent = nil; step = .second(email: address, kind: kind, challenge: challenge, sentTo: sentTo)
        case .refused(let sentence): note = sentence
        case .startOver(let sentence): startOver(sentence)
        }
    }

    @MainActor private func confirm(_ grant: DeleteAccount.Grant) async {
        guard !busy else { return }
        busy = true; note = nil
        // Confirm ends billing before it answers: ask iOS for time to hear the answer if the phone locks or the app is
        // sent away meanwhile, rather than reporting "could not be reached" about a deletion that is going ahead.
        let background = BackgroundTime(name: "delete-account-confirm")
        defer { busy = false; background.end() }
        let sent: (answer: (Int, Any?)?, error: URLError.Code?) = sample ? ((200, ["outcome": "deleted"]), nil)
            : await sendTelling(DeleteAccount.confirmRequest(coordinator: coordinator, grant: grant.token))
        // Nothing reached Kosmos+, or its answer was lost: the same grant may be sent again, as the page's Try again. If it
        // may have reached Kosmos+, the deletion may be finishing, so a later refusal of this grant reads as unknown.
        guard let (status, json) = sent.answer else {
            if DeleteAccount.mayHaveArrived(sent.error) { answerLost = true }
            note = answerLost ? DeleteAccount.lostWords : DeleteAccount.unreachable
            return
        }
        switch DeleteAccount.outcome(status: status, json: json, answerLost: answerLost) {
        case .deleted:
            let address = grant.preview.email ?? email
            gone = true; goneEmail = address
            step = .done(email: address)
            focusAnswer()
            // Left already (another tab, the app sent away): nothing will leave the done screen, so sign out now.
            if !visible { signOutIfDeleted() }
        case .stillDeleting: step = .pending; focusAnswer()
        case .nothingChanged: answerLost = false; step = .failed(grant); focusAnswer()
        case .retry(let sentence):
            // No sentence: something other than Kosmos+ answered (a proxy's page), so the request did reach the way in.
            if sentence == nil { answerLost = true }
            note = answerLost ? DeleteAccount.lostWords : (sentence ?? DeleteAccount.unreachable)
        case .unknown:
            step = .unknown; focusAnswer()
            await settle(deletedEmail: grant.preview.email ?? email)
        case .startOver(let sentence): startOver(sentence)
        }
    }

    /// After "could not tell": one look at this iPhone's own sign-in, when the account in question may be its own.
    @MainActor private func settle(deletedEmail: String?) async {
        guard !sample, let session = heldSession, currentSession() == session else { return }
        if let own = ownEmail?.lowercased(), let gone = deletedEmail?.lowercased(), own != gone { return }
        var r = URLRequest(url: coordinator.appendingPathComponent(String(SignIn.mePath.dropFirst())))
        r.setValue("Bearer \(session)", forHTTPHeaderField: "Authorization")
        r.timeoutInterval = 15
        r.httpShouldHandleCookies = false
        r.cachePolicy = .reloadIgnoringLocalCacheData
        let answer = await send(r)
        guard step == .unknown else { return }
        switch DeleteAccount.settled(meStatus: answer?.0, meEmail: answer.flatMap { SignIn.accountEmail(status: $0.0, json: $0.1) },
                                     deletedEmail: deletedEmail) {
        case .stillThere: startOver(DeleteAccount.stillThereWords)
        case .sessionGone:
            guard !signedOutDone, currentSession() == session else { return }
            signedOutDone = true
            deleted(session)
        case .unknown: break
        }
    }

    /// VoiceOver to the answer's title, once the title exists (the next turn), every time an answer arrives.
    @MainActor private func focusAnswer() {
        answerFocus = false
        DispatchQueue.main.async { answerFocus = true }
    }

    @MainActor private func startOver(_ sentence: String?) {
        code = ""; sent = nil; understood = false; answerFocus = false
        step = .email
        note = sentence
    }

    private func leave() {
        signOutIfDeleted()
        dismiss()
    }

    /// Once, and only after `deleted` (DeleteAccount.signsOut): the session this iPhone held is for an account that no
    /// longer exists. Called on leaving the done screen, and at the answer when the screen is already gone.
    private func signOutIfDeleted() {
        guard DeleteAccount.signsOut(deleted: gone, already: signedOutDone, ownEmail: ownEmail, deletedEmail: goneEmail) else { return }
        signedOutDone = true
        guard !sample else { return }
        // Only the session held when the flow began, and only while it is still the one held: a sign-in that changed
        // meanwhile (another account) is left alone. Signed in during the flow from signed out: that sign-in is new too.
        if let session = heldSession, currentSession() == session { deleted(session) }
    }
}

/// Background time for a request that must be heard out (confirm). Ended when the request ends, or by iOS's expiry
/// handler, whichever comes first, so the app is never ended for holding it past its time.
private final class BackgroundTime {
    private var id: UIBackgroundTaskIdentifier = .invalid
    init(name: String) {
        id = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in self?.end() }
    }
    func end() {
        guard id != .invalid else { return }
        UIApplication.shared.endBackgroundTask(id)
        id = .invalid
    }
}

private final class RefuseRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
