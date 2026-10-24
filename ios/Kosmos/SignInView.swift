import SwiftUI

// kosmos#7042 (iPhone slice 5a, #6838): the native sign-in. Email, the code, the second step, then "Allow this iPhone on
// your Mac" with the match code until the Mac answers. The steps are SignIn.next (SignInLogic.swift, proven in
// ios/LogicTests). What it does not do yet goes to the web sign-in page (`useWeb`) with one line saying why.
@MainActor
final class SignInModel: ObservableObject {
    @Published var step: SignIn.Step = .email
    @Published var email = ""
    @Published var code = ""
    @Published var error: String?
    @Published var busy = false
    /// The session Kosmos+ issued, once: ContentView hands it to the app (the web bridge's own path).
    @Published private(set) var issued: String?
    /// Bumped when the person backs out of an issued session: ContentView signs it out.
    @Published private(set) var abandoned = 0
    private let client: SignInClient?
    private var watch: Task<Void, Never>?
    /// Bumped by every new attempt and every way back: an answer for an older one changes nothing (the web page's
    /// `mine !== attempt`; review round 1).
    private var attempt = 0

    init(client: SignInClient?) {
        self.client = client
        #if DEBUG
        // The sample screens (a Debug build only): KOSMOS_SAMPLE_SIGNIN=email|code|second|sms|allow|nomac|denied|web|error.
        if let sample = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_SIGNIN"] { show(sample: sample) }
        #endif
    }

    deinit { watch?.cancel() }

    func sendCode() {
        let typed = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard SignIn.looksLikeEmail(typed) else { error = "That does not look like an email address."; return }
        guard let client else { return }
        attempt += 1; let mine = attempt
        busy = true; error = nil
        Task {
            defer { if mine == attempt { busy = false } }
            do {
                let codeComing = try await client.start(email: typed)
                guard mine == attempt else { return }
                if codeComing { email = typed; code = ""; step = .code(email: typed) } else { step = .web(reason: SignIn.webForCompany) }
            } catch { if mine == attempt { fail(error) } }
        }
    }

    func verify() {
        guard case .code(let email) = step else { return }
        guard let typed = SignIn.code(code) else { error = "The code is six digits."; return }
        guard let client else { return }
        attempt += 1; let mine = attempt
        busy = true; error = nil
        Task {
            defer { if mine == attempt { busy = false } }
            do {
                let answer = try await client.verify(email: email, code: typed)
                if mine == attempt { take(answer, email: email) }
            } catch { if mine == attempt { fail(error) } }
        }
    }

    func verifySecond() {
        guard case .second(let email, _, let challenge, _) = step else { return }
        guard let typed = SignIn.code(code) else { error = "The code is six digits."; return }
        guard let client else { return }
        attempt += 1; let mine = attempt
        busy = true; error = nil
        Task {
            defer { if mine == attempt { busy = false } }
            do {
                let answer = try await client.second(challenge: challenge, code: typed)
                guard mine == attempt else { return }
                // A wrong second code stays on the second step (the challenge is still good), never back to the email code.
                if case .refused(let message, false) = answer { error = message ?? "That code is not right."; return }
                take(answer, email: email)
            } catch { if mine == attempt { fail(error) } }
        }
    }

    func differentEmail() {
        attempt += 1; busy = false; watch?.cancel(); code = ""; error = nil; step = .email
        if issued != nil { issued = nil; abandoned += 1 }
    }

    /// Signed out later in the launch: the native sign-in starts over from the email (review round 5).
    func restart() {
        attempt += 1; busy = false; watch?.cancel(); code = ""; error = nil; issued = nil; step = .email
    }

    /// Signed in already; the app opens without waiting for the Allow (its tabs say so until the Mac answers).
    func continueToApp() { attempt += 1; watch?.cancel(); step = .done }

    /// A call that did not get an answer. A device key this iPhone cannot keep is not a network problem and would fail
    /// the same way every time, so that goes to the web sign-in page (review round 1).
    private func fail(_ error: Error) {
        if let refusal = error as? SignInRefusal { self.error = refusal.message; return }
        if case SignInClient.SignInError.keyNotKept = error { step = .web(reason: SignIn.webForKey); return }
        self.error = Self.unreachable
    }

    private func take(_ answer: SignIn.Answer, email: String) {
        let (next, session, message) = SignIn.next(after: answer, email: email)
        if case .refused(_, true) = answer { client?.forgetDeviceKey() }   // a new key, allowed once, next time
        // The typed code stays when the step does (a wrong code is fixed in place); clearing it would also clear the
        // error just set, since a keystroke clears it.
        if next != step { code = "" }
        step = next
        error = message
        if let session {
            issued = session.token
            // Denied at sign-in is not final: Kosmos+ has turned it back into a fresh Allow on the Mac (signin.rs
            // issue_session_proven_at), so it is watched as the web page watches it (review round 2).
            switch next { case .allow, .denied: watchAllow(session.token); default: break }
        }
    }

    /// The Allow, asked every few seconds while this screen shows it, as the web sign-in page does.
    private func watchAllow(_ token: String) {
        watch?.cancel()
        let mine = attempt
        watch = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(SignIn.allowPollSeconds * 1_000_000_000))
                guard let self, !Task.isCancelled, let client = self.client else { return }
                let read = await client.allowRead(token: token)
                // Re-checked after the wait: a way back pressed while the answer was coming wins (review round 1).
                guard !Task.isCancelled, mine == self.attempt else { return }
                switch read {
                case .status(.acked, _, _): self.step = .done; return
                // Denied at sign-in and still denied: the Mac said no again. Asked again from waiting: it said no now.
                case .status(.denied, _, _): self.step = .denied(asking: false); return
                case .status(.pending, let code, true):
                    // A computer connected meanwhile: show its code now (only ever from "no computer" to one; review
                    // round 3).
                    if case .allow(_, false) = self.step { self.step = .allow(matchCode: code, hasComputer: true) }
                    continue
                case .ended:
                    self.step = .email
                    self.error = "This sign-in ended before your Mac answered. Sign in again."
                    return
                case .status(.pending, _, false), .unknown: continue
                }
            }
        }
    }

    static let unreachable = "Could not reach Kosmos+. Check your connection and try again."

    #if DEBUG
    private func show(sample: String) {
        email = "ada@example.com"
        switch sample {
        case "code": step = .code(email: email)
        case "second": step = .second(email: email, kind: "totp", challenge: "c", sentTo: nil)
        case "sms": step = .second(email: email, kind: "sms", challenge: "c", sentTo: "+1 *** *** 0123")
        case "allow": step = .allow(matchCode: "K7Q2", hasComputer: true)
        case "nomac": step = .allow(matchCode: nil, hasComputer: false)
        case "denied": step = .denied(asking: true)
        case "web": step = .web(reason: SignIn.webForCompany)
        case "error": step = .code(email: email); code = "48291"; error = "That code is not right or has expired."
        default: step = .email
        }
    }
    #endif
}

struct SignInView: View {
    @ObservedObject var model: SignInModel
    /// Today's web sign-in page, for what this screen does not do yet (and for making an account).
    let useWeb: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                content
            }
            .padding(.horizontal, 24)
            .padding(.top, 48)
            .frame(maxWidth: 480, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Palette.ground.ignoresSafeArea())
        .scrollDismissesKeyboard(.interactively)
    }

    @ViewBuilder private var content: some View {
        switch model.step {
        case .email:
            title("Sign in to Kosmos+")
            line("Use the email address of your Kosmos+ account. We will send you a six-digit code.")
            TextField("Email address", text: $model.email)
                .textContentType(.username).keyboardType(.emailAddress)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .submitLabel(.send).onSubmit(model.sendCode)
                .focused($focused).field()
                .onChange(of: model.email) { _ in model.error = nil }
            errorLine
            primary("Send code", action: model.sendCode)
            link("Sign in with your company or a passkey", action: useWeb)
            footnote("New to Kosmos+? Make your account on your computer.")
        case .code(let email):
            title("Check your email")
            VStack(alignment: .leading, spacing: 2) {
                line("We sent a six-digit code to")
                // On its own line, whole when it fits; past that it breaks only after the @ or a dot (Mona Lisa).
                Text(SignIn.wrappable(email: email) + ".").font(.body.weight(.semibold)).foregroundColor(Palette.primary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            codeField(submit: model.verify)
            errorLine
            primary("Sign in", action: model.verify)
            VStack(spacing: 0) {
                link("Send the code again", action: model.sendCode).disabled(model.busy)
                link("Use a different email", action: model.differentEmail)
            }
        case .second(_, let kind, _, let sentTo):
            title("One more step")
            line(SignIn.secondWords(kind: kind, sentTo: sentTo))
            codeField(submit: model.verifySecond)
            errorLine
            primary("Sign in", action: model.verifySecond)
            link("Use a different email", action: model.differentEmail)
        case .allow(let matchCode, let hasComputer):
            title(hasComputer ? "Allow this iPhone on your Mac" : "Signed in")
            if hasComputer {
                // The one thing to match comes first, at every text size (Mona Lisa's review).
                if let matchCode {
                    Text(matchCode).font(.system(.largeTitle, design: .monospaced).weight(.semibold))
                        .foregroundColor(Palette.primary).accessibilityLabel("Code \(matchCode.map { String($0) }.joined(separator: " "))")
                }
                line("Your Mac is asking whether to let this iPhone in. Allow it there if it shows this code.")
                HStack(spacing: 8) { ProgressView(); Text("Waiting for your Mac").font(.footnote).foregroundColor(Palette.secondary) }
            } else {
                line("No computer is connected to this account yet. Set up Kosmos on your Mac, and this iPhone will be asked about there.")
            }
            link("Continue to the app", action: model.continueToApp)
        case .denied(let asking):
            title("Your Mac said no")
            if asking {
                line("Your Mac did not let this iPhone in before. It is asking again now: if that was a mistake, allow it there, and this screen moves on.")
                HStack(spacing: 8) { ProgressView(); Text("Waiting for your Mac").font(.footnote).foregroundColor(Palette.secondary) }
            } else {
                line("Your Mac did not let this iPhone in. If that was a mistake, sign in again and it will ask again.")
            }
            link("Use a different email", action: model.differentEmail)
        case .web(let reason):
            title(SignIn.webTitle(reason: reason))
            line(reason)
            primary("Continue", action: useWeb)
            link("Use a different email", action: model.differentEmail)
        case .done:
            HStack(spacing: 8) { ProgressView(); Text("Signed in").font(.footnote).foregroundColor(Palette.secondary) }
        }
    }

    private func title(_ text: String) -> some View {
        Text(text).font(.largeTitle.weight(.bold)).foregroundColor(Palette.primary).accessibilityAddTraits(.isHeader)
    }
    private func line(_ text: String) -> some View {
        Text(text).font(.body).foregroundColor(Palette.secondary).fixedSize(horizontal: false, vertical: true)
    }
    private func footnote(_ text: String) -> some View {
        Text(text).font(.footnote).foregroundColor(Palette.tertiary).fixedSize(horizontal: false, vertical: true)
    }
    private func codeField(submit: @escaping () -> Void) -> some View {
        // Mono only for the typed digits; the placeholder is body text (Mona Lisa's review). oneTimeCode offers the code
        // from Mail or Messages above the keyboard.
        TextField("Six-digit code", text: $model.code)
            .textContentType(.oneTimeCode).keyboardType(.numberPad)
            .font(model.code.isEmpty ? .body : .system(.title2, design: .monospaced))
            .focused($focused).onSubmit(submit).field()
            .onChange(of: model.code) { _ in model.error = nil }
    }
    /// The error, directly under the field it is about, in the danger colour; VoiceOver reads it when it appears.
    @ViewBuilder private var errorLine: some View {
        if let error = model.error {
            Text(error).font(.footnote).foregroundColor(Palette.dangerWord)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityLabel("Error: \(error)")
                .id(error)   // a new error is a new line, so it is announced too
                .onAppear { UIAccessibility.post(notification: .announcement, argument: error) }
        }
    }
    /// A tappable line: the link colour, no underline, leading-aligned, a 44pt row (Mona Lisa's review).
    private func link(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label).font(.subheadline).foregroundColor(Palette.link).multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        }
        .buttonStyle(.plain)
    }
    private func primary(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack { Spacer(); if model.busy { ProgressView().tint(Palette.card) } else { Text(label) }; Spacer() }
                // The app's tint is ink (near-white in dark), so the label takes the card colour to stay readable.
                .foregroundColor(Palette.card).padding(.vertical, 6)
        }
        .buttonStyle(.borderedProminent).disabled(model.busy)
    }
}

private extension View {
    func field() -> some View {
        padding(12).background(Palette.card).cornerRadius(10)
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Palette.separator))
            .foregroundColor(Palette.primary)
    }
}
