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
    private let client: SignInClient?
    private var watch: Task<Void, Never>?

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
        busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                if try await client.start(email: typed) { email = typed; code = ""; step = .code(email: typed) }
                else { step = .web(reason: SignIn.webForCompany) }
            } catch let refusal as SignInRefusal { error = refusal.message } catch { self.error = Self.unreachable }
        }
    }

    func verify() {
        guard case .code(let email) = step else { return }
        guard let typed = SignIn.code(code) else { error = "The code is six digits."; return }
        guard let client else { return }
        busy = true; error = nil
        Task {
            defer { busy = false }
            do { take(try await client.verify(email: email, code: typed), email: email) } catch { self.error = Self.unreachable }
        }
    }

    func verifySecond() {
        guard case .second(let email, _, let challenge, _) = step else { return }
        guard let typed = SignIn.code(code) else { error = "The code is six digits."; return }
        guard let client else { return }
        busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                let answer = try await client.second(challenge: challenge, code: typed)
                // A wrong second code stays on the second step (the challenge is still good), never back to the email code.
                if case .refused(let message, false) = answer { error = message ?? "That code is not right."; return }
                take(answer, email: email)
            } catch { self.error = Self.unreachable }
        }
    }

    func differentEmail() { watch?.cancel(); code = ""; error = nil; step = .email }

    /// Signed in already; the app opens without waiting for the Allow (its tabs say so until the Mac answers).
    func continueToApp() { watch?.cancel(); step = .done }

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
            if case .allow = next { watchAllow(session.token) }
        }
    }

    /// The Allow, asked every few seconds while this screen shows it, as the web sign-in page does.
    private func watchAllow(_ token: String) {
        watch?.cancel()
        watch = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(SignIn.allowPollSeconds * 1_000_000_000))
                guard let self, !Task.isCancelled, let client = self.client else { return }
                switch await client.allowStatus(token: token) {
                case .acked?: self.step = .done; return
                case .denied?: self.step = .denied; return
                default: continue
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
        case "denied": step = .denied
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
            line("We sent a six-digit code to \(SignIn.wrappable(email: email)).")
            codeField(submit: model.verify)
            errorLine
            primary("Sign in", action: model.verify)
            link("Send the code again", action: model.sendCode).disabled(model.busy)
            link("Use a different email", action: model.differentEmail)
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
        case .denied:
            title("Your Mac said no")
            line("Your Mac did not let this iPhone in. If that was a mistake, sign in again and it will ask again.")
            primary("Sign in again", action: model.differentEmail)
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
