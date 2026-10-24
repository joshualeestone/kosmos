import SwiftUI
import UniformTypeIdentifiers
import AuthenticationServices

// kosmos#7042 (iPhone slice 5a, #6838): the native sign-in. Email, the code, the second step, then "Allow this iPhone on
// your Mac" with the match code until the Mac answers. The steps are SignIn.next (SignInLogic.swift, proven in
// ios/LogicTests). What it cannot do (a company sign-in before iOS 17.4, a device key it cannot keep, a texted second
// step to set up) goes to the web sign-in page (`useWeb`) with one line saying why.
@MainActor
final class SignInModel: ObservableObject {
    @Published var step: SignIn.Step = .email
    @Published var email = ""
    @Published var code = ""
    @Published var error: String?
    @Published var busy = false
    /// kosmos#7045: Kosmos+ offered this address its company's own sign-in beside the code (a link on the code step).
    @Published private(set) var companyURL: URL?
    /// Whether this iPhone opens a company's sign-in in Apple's sheet (iOS 17.4+); earlier, the web page has it.
    var companySheet: Bool { client?.canUseCompanySheet ?? false }
    /// kosmos#7050 slice C: Kosmos+ offers passkey sign-in (its begin answered with an offer a passkey can use here).
    /// Asked when the email step shows (checkPasskeys), and again after a sign-out; with passkeys off on the coordinator
    /// it stays false and no passkey is offered.
    @Published private(set) var passkeys = false
    private var passkeysAsked = false
    /// Bumped by a sign-out: an availability answer asked before it is dropped.
    private var passkeysGen = 0
    /// The session Kosmos+ issued, once: ContentView hands it to the app (the web bridge's own path).
    @Published private(set) var issued: String?
    /// Bumped when an issued session is dropped (backed out of, or ended): ContentView signs it out, and the web page
    /// forgets it (`lastAbandoned`).
    @Published private(set) var abandoned = 0
    private(set) var lastAbandoned: String?
    private let client: SignInClient?
    private var watch: Task<Void, Never>?
    /// Bumped by every new attempt and every way back: an answer for an older one changes nothing (the web page's
    /// `mine !== attempt`; review round 1).
    private var attempt = 0

    init(client: SignInClient?) {
        self.client = client
        #if DEBUG
        // The sample screens (a Debug build only): KOSMOS_SAMPLE_SIGNIN=email|code|second|sms|allow|nomac|denied|web|error|company|companyerror|passkey|passkeyerror.
        if let sample = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_SIGNIN"] { show(sample: sample); return }
        #endif
    }

    /// Whether Kosmos+ offers passkeys, asked the first time the email step shows (not at launch: a signed-in person
    /// never sees this step, and the store screenshots never show it). Only a clear answer is kept (an offer, or a 404
    /// for passkeys off); after a server error or no answer at all, the next time the email step appears asks again.
    func checkPasskeys() async {
        guard let client, !passkeysAsked else { return }
        passkeysAsked = true
        let gen = passkeysGen
        let begun = try? await client.passkeyOffer()
        guard gen == passkeysGen else { return }   // signed out meanwhile: restart() asks again
        switch begun {
        case .offer?: passkeys = true
        case .off?: passkeys = false
        case .unusable?, nil: passkeys = false; passkeysAsked = false
        }
    }

    deinit { watch?.cancel() }

    func sendCode() {
        let typed = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard SignIn.looksLikeEmail(typed) else { error = "That does not look like an email address."; return }
        guard let client else { return }
        client.cancelPasskey()   // kosmos#7050: a passkey sheet still open is closed; this press takes over
        attempt += 1; let mine = attempt
        busy = true; error = nil
        Task {
            // The company's sheet keeps busy itself once it is opened (its own task, same attempt): not cleared here
            // (review of #7045: the outer clear ran after it and let a second press throw the grant's answer away).
            var handedOver = false
            defer { if mine == attempt && !handedOver { busy = false } }
            do {
                let started = try await client.start(email: typed)
                guard mine == attempt else { return }
                companyURL = started.company
                if started.codeComing { email = typed; code = ""; step = .code(email: typed); return }
                // The company requires its own sign-in, so no code is coming: straight to Apple's sheet, or the web
                // page when the address Kosmos+ gave is not one this app opens.
                guard let url = started.company else { step = .web(reason: SignIn.webForCompany); return }
                email = typed
                handedOver = true
                companySignIn(url, mine: mine)
            } catch { if mine == attempt { fail(error) } }
        }
    }

    func verify() {
        guard !busy, case .code(let email) = step else { return }
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
        guard !busy, case .second(let email, _, let challenge, _) = step else { return }
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

    // MARK: - kosmos#7046: a required second step, set up here

    func startSetup() {
        guard !busy, case .setup(let token, _) = step, let client else { return }
        attempt += 1; let mine = attempt
        busy = true; error = nil
        Task {
            defer { if mine == attempt { busy = false } }
            do {
                let enrolled = try await client.enrol(token: token)
                guard mine == attempt else { return }
                switch enrolled {
                case .totp(let link, let secret): code = ""; step = .setupConfirm(token: token, otpauth: link, secret: secret)
                case .refused(let sentence):
                    // As confirm: a setup Kosmos+ says to start again (the token ran out) goes back to the email.
                    if SignIn.startsOver(sentence) { step = .email }
                    error = sentence
                }
            } catch { if mine == attempt { fail(error) } }
        }
    }

    func confirmSetup() {
        guard !busy, case .setupConfirm(let token, _, _) = step else { return }
        guard let typed = SignIn.code(code) else { error = "The code is six digits."; return }
        guard let client else { return }
        attempt += 1; let mine = attempt
        busy = true; error = nil
        Task {
            defer { if mine == attempt { busy = false } }
            do {
                let answer = try await client.confirmSetup(token: token, code: typed)
                guard mine == attempt else { return }
                // A wrong code stays here: the authenticator is added already, only its code was early or late.
                if case .refused(let message, false) = answer {
                    // Kosmos+ says to start again (the setup expired): back to the email, with its sentence.
                    if SignIn.startsOver(message) { code = ""; step = .email }
                    error = message ?? "That code is not what the app shows right now."
                    return
                }
                take(answer, email: email)
            } catch { if mine == attempt { fail(error) } }
        }
    }

    /// kosmos#7045: the company's own sign-in, in Apple's sheet. The grant it brings back is spent at verify in place of
    /// the code, for the email the provider vouched for, with this iPhone's own proof.
    func companySignIn() {
        guard let url = companyURL else { return }
        attempt += 1
        companySignIn(url, mine: attempt)
    }

    private func companySignIn(_ url: URL, mine: Int) {
        guard let client else { return }
        busy = true; error = nil
        Task {
            defer { if mine == attempt { busy = false } }
            guard let back = await client.openCompanySignIn(url), mine == attempt else { return }   // closed: nothing changes
            switch SignIn.companyReturn(back, coordinator: KosmosConfig.coordinatorOrigin) {
            case .grant(let grant, let vouched)?:
                do {
                    email = vouched   // first, as passkeySignIn does: a later change would clear take()'s sentence
                    let answer = try await client.verify(email: vouched, code: grant)
                    guard mine == attempt else { return }
                    take(answer, email: vouched)
                    // A refused grant is not a wrong code to retype: back to the email, with the sentence.
                    if case .code = step { step = .email }
                } catch { if mine == attempt { fail(error) } }
            case .refused(let sentence)?:
                step = .email; error = sentence
            case nil:
                step = .email; error = SignIn.companyWords["failed"]
            }
        }
    }

    /// kosmos#7050 slice C: the app went to the background (ContentView calls this): a passkey sheet still open is closed,
    /// so its press is answered (as not used) instead of leaving the screen busy.
    func appLeft() { client?.cancelPasskey() }

    /// kosmos#7050 slice C: sign in with a passkey, in Apple's passkey sheet. The grant finish brings back is spent at
    /// verify in place of the code, for the account's own email, with this iPhone's proof (as a company sign-in's is),
    /// so the second step and the Allow follow exactly as for a code.
    func passkeySignIn() {
        guard let client, !busy else { return }
        attempt += 1; let mine = attempt
        busy = true; error = nil
        Task {
            defer { if mine == attempt { busy = false } }
            do {
                // A fresh challenge for every press: each is good for one sign-in only.
                let begun = try await client.passkeyOffer()
                guard case .offer(let offer) = begun else {
                    guard mine == attempt else { return }
                    // Switched off since the screen asked: the link goes, and the sentence says to use the code.
                    switch begun {
                    case .off: passkeys = false; error = SignIn.passkeyWords.off
                    case .unusable(let sentence): error = sentence ?? SignIn.passkeyWords.failed
                    case .offer: break
                    }
                    return
                }
                guard mine == attempt else { return }
                let assertion: ASAuthorizationPlatformPublicKeyCredentialAssertion
                switch await client.passkeyAssert(offer) {
                case .assertion(let got): assertion = got
                case .cancelled: if mine == attempt { error = SignIn.passkeyWords.notUsed }; return
                case .failed: if mine == attempt { error = SignIn.passkeyWords.failed }; return
                }
                guard mine == attempt else { return }
                switch try await client.passkeyFinish(assertion) {
                case .grant(let grant, let account):
                    // The address first: changing it later clears the error line (the email field's onChange) and
                    // would wipe the sentence take() sets for a refused grant.
                    email = account
                    let answer = try await client.verify(email: account, code: grant)
                    guard mine == attempt else { return }
                    take(answer, email: account)
                    // A refused grant is not a wrong code to retype: back to the email, with the sentence.
                    if case .code = step { step = .email }
                case .refused(let sentence):
                    guard mine == attempt else { return }
                    step = .email; error = sentence
                }
            } catch { if mine == attempt { fail(error) } }
        }
    }

    func differentEmail() {
        client?.cancelPasskey()   // a passkey sheet still open is closed, never left waiting
        attempt += 1; busy = false; watch?.cancel(); code = ""; error = nil; step = .email
        drop()
    }

    private func drop() {
        guard let token = issued else { return }
        issued = nil; lastAbandoned = token; abandoned += 1
    }

    /// Signed out later in the launch: the native sign-in starts over from the email (review round 5).
    func restart() {
        // The address goes too: the next sign-in here may be another person's (the web page clears it the same way).
        attempt += 1; busy = false; watch?.cancel(); email = ""; code = ""; error = nil; issued = nil; step = .email
        passkeysAsked = false; passkeys = false; passkeysGen += 1   // asked again when the email step shows: it may have changed
        client?.cancelPasskey()
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
                    // An ended session is dropped like one backed out of (review round 7): signed out here, and
                    // forgotten by the web page, which would otherwise hand the dead one back.
                    self.drop()
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
        passkeysAsked = true   // a sample screen never asks the live coordinator
        email = "ada@example.com"
        switch sample {
        case "code": step = .code(email: email)
        case "second": step = .second(email: email, kind: "totp", challenge: "c", sentTo: nil)
        case "sms": step = .second(email: email, kind: "sms", challenge: "c", sentTo: "+1 *** *** 0123")
        case "allow": step = .allow(matchCode: "K7Q2", hasComputer: true)
        case "nomac": step = .allow(matchCode: nil, hasComputer: false)
        case "denied": step = .denied(asking: true)
        case "web": step = .web(reason: SignIn.webForCompany)
        // kosmos#7050 slice C: the email step with passkey sign-in offered, and a passkey that was not used.
        case "passkey": passkeys = true
        case "passkeyerror": passkeys = true; error = SignIn.passkeyWords.notUsed
        case "error": step = .code(email: email); code = "48291"; error = "That code is not right or has expired."
        // kosmos#7046: setting up a required second step.
        case "setup": step = .setup(token: "t", sms: true)
        case "setupconfirm": step = .setupConfirm(token: "t", otpauth: "otpauth://totp/Kosmos:ada%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Kosmos", secret: "JBSWY3DPEHPK3PXP")
        // kosmos#7045: the code step with the company's own sign-in offered beside it, and a company refusal.
        case "company": step = .code(email: email); companyURL = URL(string: "https://login.kosmosplus.com/v1/sso/begin?email=x")
        case "companyerror": step = .email; error = SignIn.companyWords["not_provisioned"]
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
    @Environment(\.openURL) private var openURL

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
            title("Sign in to Kosmos+").task { await model.checkPasskeys() }
            line("Use the email address of your Kosmos+ account. We will send you a six-digit code.")
            TextField("Email address", text: $model.email)
                .textContentType(.username).keyboardType(.emailAddress)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .submitLabel(.send).onSubmit(model.sendCode)
                .focused($focused).field()
                .onChange(of: model.email) { _ in model.error = nil }
            errorLine
            primary("Send code", action: model.sendCode)
            // kosmos#7050 slice C: a passkey signs in here, natively, when Kosmos+ offers it.
            if model.passkeys { link("Sign in with a passkey", action: model.passkeySignIn).disabled(model.busy) }
            // Where Apple's sheet cannot take a company's sign-in (before iOS 17.4), the web page has it: say so here.
            if !model.companySheet { link("Sign in with your company's account", action: useWeb) }
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
                if model.companyURL != nil { link("Sign in with your company's account instead", action: model.companySignIn).disabled(model.busy) }
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
        case .setup(_, let sms):
            title("Set up a second step")
            line(SignIn.setupWords)
            errorLine
            primary("Set up an authenticator app", action: model.startSetup)
            VStack(spacing: 0) {
                if sms { link("Use text messages instead", action: useWeb) }
                link("Use a different email", action: model.differentEmail)
            }
        case .setupConfirm(_, let otpauth, let secret):
            title("Add your key")   // one short word per line at the largest sizes, no hyphen inside one
            line("Add Kosmos to your authenticator app with the button, or type this key into the app yourself. Then type the six-digit code it shows.")
            if let url = URL(string: otpauth) {
                Button { openURL(url) } label: { Text("Add to my authenticator app").frame(maxWidth: .infinity).padding(.vertical, 6) }
                    .buttonStyle(.bordered)
            }
            HStack(alignment: .firstTextBaseline) {
                Text(SignIn.grouped(secret: secret)).font(.system(.body, design: .monospaced)).foregroundColor(Palette.primary)
                    .textSelection(.enabled).accessibilityLabel("Key: \(secret.map { String($0) }.joined(separator: " "))")
                Spacer()
                // The key is the second step itself: kept on this iPhone only (no Universal Clipboard) and for two
                // minutes (review of #7046).
                Button("Copy") {
                    UIPasteboard.general.setItems([[UTType.plainText.identifier: secret]],
                                                  options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(120)])
                }.font(.subheadline).foregroundColor(Palette.link)
            }
            codeField(submit: model.confirmSetup)
            errorLine
            primary("Confirm", action: model.confirmSetup)
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
