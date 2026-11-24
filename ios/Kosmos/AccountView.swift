import SwiftUI
import UniformTypeIdentifiers

// kosmos#8959 slice B1a: the Kosmos+ account, native. Opened from the Settings tab's "Your Kosmos+ account" row, where
// the web page used to open. The computers on the account (each with the web page's words, and Retire), Sign out and
// Sign out everywhere; everything else on the account (billing, passkeys, the second step) is one row away on the web
// page, until slices B1b, B1c and B2. The logic is AccountLogic.swift; the second step (slice B1b) is AccountSecondLogic.swift.
struct AccountView: View {
    let coordinator: URL
    // The account's web page, for what is not here yet.
    let openPage: (URL) -> Void
    // This iPhone signs out (the app's own path, PushNotificationManager), with the session that was ended.
    let signedOut: (String) -> Void
    // The session signed in now: the keychain's, or the one the app holds in memory when the keychain could not save it
    // (PushNotificationManager.currentSession, kosmos#7042 review round 8).
    let currentSession: () -> String?
    // kosmos#8959 slice B1b: setting up a second step hands back a fresh session for this account (old, fresh); the app
    // keeps it (PushNotificationManager.sessionRenewed), because Kosmos+ refuses the old one from then on.
    let renewed: (String, String) -> Void
    // Bumped on every sign-in change (PushNotificationManager.accountChanges): the list is read again for the new one.
    var accountGeneration = 0
    var sample = false

    private enum Load: Equatable {
        case reading
        case loaded([Account.Computer])
        case failed(String)
    }

    @State private var load: Load = .reading
    // Each read takes the next ticket; only the newest read's answer is shown.
    @State private var readTicket = 0
    @State private var listNote: String?
    // The computer being retired, the code Kosmos+ gave for it, its sentence, and what the person typed.
    @State private var retiring: (name: String, code: String, words: String)?
    @State private var typed = ""
    @State private var retireNote: String?
    @State private var retireBusy = false
    // The sign-in each busy flag belongs to: a stale answer clears its flag only if no newer request took it.
    @State private var retireFor: String?
    @State private var busyFor: String?
    @State private var askEverywhere = false
    // The sign-in "Sign out everywhere?" was opened for: a press after the sign-in changed ends nothing.
    @State private var everywhereFor: String?
    @State private var busy: Busy?
    @State private var signOutNote: String?
    // Sign out on Kosmos+ did not answer: the person chooses, try again or sign out on this iPhone only. Holds the
    // session that sign-out was for.
    @State private var offerLocalOnly: String?
    @State private var askLocalOnly = false

    private enum Busy { case signOut, everywhere }

    // kosmos#8959 slice B1b: the second step. What GET /v1/second said, the setup sheet's screen, and the sign-in each
    // answer belongs to (an answer for another sign-in is dropped, as above).
    private enum SecondLoad: Equatable { case reading, known(AccountSecond.Status), unreadable(String) }
    private enum Setup: Equatable { case phone, textCode(sentTo: String), app(otpauth: String, secret: String) }
    @State private var second: SecondLoad = .reading
    @State private var secondTicket = 0
    @State private var secondNote: String?
    @State private var setup: Setup?
    @State private var setupFor: String?
    @State private var setupBusy = false
    @State private var setupNote: String?
    @State private var phone = ""
    @State private var code = ""
    @Environment(\.openURL) private var openURL

    var body: some View {
        List {
            computers
            secondSection
            signOutSection
            more
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.ground.ignoresSafeArea())
        .navigationTitle("Kosmos+ account")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .dotsRefresh { await read() }
        .task { await read() }
        .onChange(of: accountGeneration) { _ in
            // A sheet, a choice or a note belonged to the sign-in that just changed.
            retireBusy = false; retireFor = nil; closeRetire(); offerLocalOnly = nil; signOutNote = nil; listNote = nil
            busy = nil; busyFor = nil; askEverywhere = false; everywhereFor = nil; askLocalOnly = false
            setupBusy = false; setup = nil; setupFor = nil; setupNote = nil; secondNote = nil; phone = ""; code = ""
            second = .reading
            load = .reading
            Task { await read() }
        }
        .sheet(isPresented: Binding(get: { retiring != nil }, set: { if !$0 { closeRetire() } })) { retireSheet }
        .sheet(isPresented: Binding(get: { setup != nil }, set: { if !$0 { closeSetup() } })) { setupSheet }
        .confirmationDialog("Sign out everywhere?", isPresented: $askEverywhere, titleVisibility: .visible) {
            Button("Sign out everywhere", role: .destructive) { Task { await signOutEverywhere(for: everywhereFor) } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This ends every sign-in to your Kosmos+ account, on this iPhone and on every other phone and browser. Your computers keep running.")
        }
    }

    // MARK: Computers

    @ViewBuilder private var computers: some View {
        Section {
            switch load {
            case .reading:
                HStack { SweepDots(label: "Reading your computers", scales: false); Text("Reading your computers").foregroundColor(Palette.secondary) }
            case .failed(let why):
                Text(why).foregroundColor(Palette.secondary)
            case .loaded(let rows):
                if rows.isEmpty { Text("No computers on your account yet.").foregroundColor(Palette.secondary) }
                let now = Date().timeIntervalSince1970
                let canAllow = Account.canAllow(rows)
                ForEach(rows) { row in computerRow(row, now: now, canAllow: canAllow) }
            }
        } header: {
            Text("Your computers")
        } footer: {
            Text(listNote ?? "Retire a computer you no longer use, or one that was wiped or is gone. It stops answering, and its name is free again after a day.")
                .font(.footnote).foregroundColor(listNote == nil ? Palette.secondary : Palette.dangerWord)
        }
    }

    private func computerRow(_ row: Account.Computer, now: Double, canAllow: Int) -> some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.name).foregroundColor(row.retired || Account.stale(row, now: now) ? Palette.secondary : Palette.primary)
                Text(Account.words(row, now: now, canAllow: canAllow)).font(.footnote).foregroundColor(Palette.secondary)
            }
            Spacer()
            if !row.retired {
                Button("Retire") { Task { await askRetire(row.name) } }
                    .buttonStyle(.borderless)
                    .foregroundColor(Palette.dangerWord)
                    .disabled(retireBusy || busy != nil)
                    .accessibilityLabel("Retire " + row.name)
            }
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .contain)
    }

    private var retireSheet: some View {
        NavigationView {
            Form {
                Section {
                    Text(retiring?.words ?? "")
                    TextField("The four characters", text: $typed)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .submitLabel(.go)
                        .onSubmit { Task { await confirmRetire() } }
                        .disabled(retireBusy)
                        .accessibilityIdentifier("account-retire-code")
                } footer: {
                    if let retireNote { Text(retireNote).foregroundColor(Palette.dangerWord) }
                }
                Section {
                    Button(retireBusy ? "Retiring" : "Retire \(retiring?.name ?? "")", role: .destructive) { Task { await confirmRetire() } }
                        .disabled(retireBusy)
                }
            }
            .navigationTitle("Retire a computer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { closeRetire() }.disabled(retireBusy) } }
        }
        .navigationViewStyle(.stack)
        .interactiveDismissDisabled(retireBusy)
    }

    // MARK: Two-step sign-in (kosmos#8959 slice B1b)

    @ViewBuilder private var secondSection: some View {
        Section {
            switch second {
            case .reading:
                HStack { SweepDots(label: "Reading two-step sign-in", scales: false); Text("Reading two-step sign-in").foregroundColor(Palette.secondary) }
            case .unreadable(let why):
                Text(why).foregroundColor(Palette.secondary)
            case .known(let status):
                if let kind = status.enrolled {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(AccountSecond.onTitle).foregroundColor(Palette.primary)
                        Text(AccountSecond.onWords(kind: kind)).font(.footnote).foregroundColor(Palette.secondary)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("account-second-on")
                    DisclosureGroup(AccountSecond.lostPhoneTitle) {
                        Text(AccountSecond.lostPhoneWords).font(.footnote).foregroundColor(Palette.secondary)
                    }
                } else {
                    Text(AccountSecond.offerWords).font(.footnote).foregroundColor(Palette.secondary)
                    ForEach(AccountSecond.choices(status), id: \.self) { kind in
                        Button(kind == .sms ? "Set up text messages" : "Set up an authenticator app") { Task { await startSetup(kind) } }
                            .disabled(setupBusy || busy != nil)
                            .accessibilityIdentifier(kind == .sms ? "account-second-sms" : "account-second-app")
                    }
                }
            }
        } header: {
            Text(secondHeader)
        } footer: {
            if let secondNote {
                Text(secondNote).font(.footnote).foregroundColor(Palette.dangerWord)
            } else if case .known(let status) = second {
                if status.enrolled != nil || !status.smsAvailable {
                    Text(status.enrolled != nil ? AccountSecond.resetWords : AccountSecond.noTextsWords)
                        .font(.footnote).foregroundColor(Palette.secondary)
                }
            }
        }
    }

    private var secondHeader: String {
        if case .known(let status) = second, status.enrolled == nil { return AccountSecond.offerTitle }
        return "Two-step sign-in"
    }

    private var setupSheet: some View {
        NavigationView {
            Form {
                switch setup {
                case .phone:
                    Section {
                        Text(SignIn.phoneWords)
                        TextField("Mobile number", text: $phone)
                            .textContentType(.telephoneNumber).keyboardType(.phonePad)
                            .disabled(setupBusy)
                            .onChange(of: phone) { _ in setupNote = nil }
                            .accessibilityIdentifier("account-second-phone")
                    } footer: { setupFooter }
                    Section {
                        Button(setupBusy ? "Texting a code" : "Text me a code") { Task { await sendText() } }.disabled(setupBusy)
                        if setupNote == SignIn.textMayBeComing {
                            Button("I got a code") { code = ""; setupNote = nil; setup = .textCode(sentTo: "your phone") }.disabled(setupBusy)
                        }
                    }
                case .textCode(let sentTo):
                    Section {
                        Text(SignIn.secondWords(kind: "sms", sentTo: sentTo))
                        codeField
                    } footer: { setupFooter }
                    Section {
                        Button(setupBusy ? "Confirming" : "Confirm") { Task { await confirmSetup() } }.disabled(setupBusy)
                        Button("Use a different number") { code = ""; setupNote = nil; setup = .phone }.disabled(setupBusy)
                    }
                case .app(let otpauth, let secret):
                    Section {
                        Text("Add Kosmos to your authenticator app with the button, or type this key into the app yourself. Then type the six-digit code it shows.")
                        if let url = URL(string: otpauth) {
                            Button("Add to my authenticator app") { openURL(url) }
                        }
                        HStack(alignment: .firstTextBaseline) {
                            Text(SignIn.grouped(secret: secret)).font(.system(.body, design: .monospaced)).foregroundColor(Palette.primary)
                                .textSelection(.enabled).accessibilityLabel("Key: \(secret.map { String($0) }.joined(separator: " "))")
                                .accessibilityIdentifier("account-second-key")
                            Spacer()
                            // As slice A's: the key is the second step itself, so it stays on this iPhone, for two minutes.
                            Button("Copy") {
                                UIPasteboard.general.setItems([[UTType.plainText.identifier: secret]],
                                                              options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(120)])
                            }.buttonStyle(.borderless).foregroundColor(Palette.link)
                        }
                        codeField
                    } footer: { setupFooter }
                    Section {
                        Button(setupBusy ? "Confirming" : "Confirm") { Task { await confirmSetup() } }.disabled(setupBusy)
                    }
                case nil:
                    EmptyView()
                }
            }
            .navigationTitle(setupTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { closeSetup() }.disabled(setupBusy) } }
        }
        .navigationViewStyle(.stack)
        .interactiveDismissDisabled(setupBusy)
    }

    private var setupTitle: String {
        switch setup {
        case .phone: return "Your mobile number"
        case .textCode: return "Type the code"
        case .app: return "Add your key"
        case nil: return ""
        }
    }

    @ViewBuilder private var setupFooter: some View {
        if let setupNote { Text(setupNote).foregroundColor(Palette.dangerWord) }
    }

    private var codeField: some View {
        TextField("Six-digit code", text: $code)
            .textContentType(.oneTimeCode).keyboardType(.numberPad)
            .font(code.isEmpty ? .body : .system(.title2, design: .monospaced))
            .disabled(setupBusy)
            .onSubmit { Task { await confirmSetup() } }
            .accessibilityIdentifier("account-second-code")
    }

    // MARK: Sign out

    private var signOutSection: some View {
        Section {
            Button(busy == .signOut ? "Signing out" : (offerLocalOnly != nil ? "Try signing out again" : "Sign out")) { Task { await signOut() } }
                .disabled(busy != nil)
                .accessibilityIdentifier("account-sign-out")
            if let session = offerLocalOnly {
                Button("Sign out on this iPhone only", role: .destructive) { askLocalOnly = true }
                    .disabled(busy != nil)
                    .confirmationDialog("Sign out on this iPhone only?", isPresented: $askLocalOnly, titleVisibility: .visible) {
                        Button("Sign out on this iPhone only", role: .destructive) {
                            // Only while it is still the sign-in this iPhone holds.
                            if currentSession() == session { signedOut(session) } else { offerLocalOnly = nil }
                        }
                        Button("Cancel", role: .cancel) {}
                    } message: {
                        Text("Kosmos+ has not ended this sign-in, so a copy of it could still work until you choose Sign out everywhere.")
                    }
            }
            Button(busy == .everywhere ? "Signing out everywhere" : "Sign out everywhere", role: .destructive) {
                everywhereFor = currentSession(); askEverywhere = true
            }
                .disabled(busy != nil)
                .accessibilityIdentifier("account-sign-out-everywhere")
        } header: {
            Text("Sign out")
        } footer: {
            Text(signOutNote ?? "Sign out everywhere also ends your sign-in on every other phone and browser. Use it if you lost a phone, or think someone else signed in.")
                .font(.footnote).foregroundColor(signOutNote == nil ? Palette.secondary : Palette.dangerWord)
        }
    }

    // MARK: The rest, on the web page for now

    private var more: some View {
        Section {
            Button { openPage(Settings.accountURL(coordinator: coordinator)) } label: {
                HStack {
                    Text("More on Kosmos+").foregroundColor(Palette.primary)
                    Spacer()
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundColor(Palette.tertiary)
                        .accessibilityHidden(true)
                }
            }
            .accessibilityIdentifier("account-more")
        } footer: {
            Text("Your plan and billing, passkeys and adding a computer are on your Kosmos+ account page.")
                .font(.footnote).foregroundColor(Palette.secondary)
        }
    }

    // MARK: Asking Kosmos+

    // One ephemeral session refusing redirects, as Settings and the sign-in client use: the Kosmos+ session is never
    // carried to another host, and nothing is cached to disk.
    private static let http = URLSession(configuration: .ephemeral, delegate: RefuseRedirects(), delegateQueue: nil)

    private func send(_ r: URLRequest) async -> (Int?, Data?) {
        guard let (data, answer) = try? await Self.http.data(for: r), let http = answer as? HTTPURLResponse
        else { return (nil, nil) }
        return (http.statusCode, data)
    }

    // `again`: this read follows one whose sign-in changed while it was out; it is not repeated a second time.
    @MainActor private func read(again: Bool = false) async {
        if !again { async let s: Void = readSecond(); await readComputers(again: again); await s; return }
        await readComputers(again: again)
    }

    @MainActor private func readComputers(again: Bool) async {
        if sample { load = .loaded(Self.sampleRows); return }
        readTicket += 1
        let ticket = readTicket
        guard let session = currentSession() else { load = .failed("You are signed out."); return }
        let (status, data) = await send(Board.macsRequest(coordinator: coordinator, session: session))
        // A cancelled pull or a screen that went away: no answer. A list already shown stays; a first read says it did
        // not finish, rather than reading forever.
        if Task.isCancelled {
            if ticket == readTicket, case .reading = load { load = .failed("Your computers were not read. Pull down to try again.") }
            return
        }
        // A newer read was started meanwhile (a pull, a retire, a sign-in change): its answer is the one shown.
        guard ticket == readTicket else { return }
        // The answer belongs to the sign-in that asked. One that changed meanwhile is not shown; the change itself
        // (accountGeneration) clears the list and reads it again; without one, this reads again for the sign-in held now.
        guard currentSession() == session else { if !again { await read(again: true) }; return }
        guard let status else { if case .loaded = load { listNote = Account.reach } else { load = .failed(Account.reach) }; return }
        if (200...299).contains(status), let rows = Account.parseComputers(data) {
            load = .loaded(rows); listNote = nil
        } else {
            let why = Account.errorWords(data) ?? "Could not list your computers."
            if case .loaded = load { listNote = why } else { load = .failed(why) }
        }
    }

    @MainActor private func askRetire(_ name: String) async {
        // A sample run (screenshots) has no session and never asks Kosmos+.
        guard let session = sample ? "sample" : currentSession(), !retireBusy else { return }
        listNote = nil
        retireBusy = true; retireFor = session
        let (status, data) = sample ? (409, Data(#"{"confirm":"K7QX","message":"type K7QX to retire \#(name); it will stop answering and its name is free again after a day"}"#.utf8))
            : await send(Account.retireRequest(coordinator: coordinator, session: session, name: name))
        // A request started since then (after a sign-in change cleared the flag) keeps its own flag.
        if retireFor == session { retireBusy = false; retireFor = nil }
        guard sample || currentSession() == session else { return }
        switch Account.retireAnswer(status: status, data: data, name: name, typed: nil) {
        case .confirm(let code, let words): typed = ""; retireNote = nil; retiring = (name, code, words)
        case .retired: await read()
        case .refused(let why): listNote = why
        }
    }

    @MainActor private func confirmRetire() async {
        if sample { closeRetire(); return }
        guard let r = retiring, let session = currentSession(), !retireBusy else { return }
        let code = Account.typedCode(typed)
        guard !code.isEmpty else { retireNote = "Type the four characters shown above."; return }
        retireNote = nil
        retireBusy = true; retireFor = session
        let (status, data) = await send(Account.retireRequest(coordinator: coordinator, session: session, name: r.name, confirm: code))
        if retireFor == session { retireBusy = false; retireFor = nil }
        guard currentSession() == session else { return }
        switch Account.retireAnswer(status: status, data: data, name: r.name, typed: code) {
        case .retired: closeRetire(); await read()
        // With a typed code retireAnswer never asks again (.confirm); a wrong code comes back as .refused.
        case .refused(let why), .confirm(_, let why): retireNote = why
        }
    }

    private func closeRetire() {
        guard !retireBusy else { return }
        retiring = nil; typed = ""; retireNote = nil
    }

    @MainActor private func signOut() async {
        guard busy == nil, !sample else { return }
        guard let session = currentSession() else { signOutNote = "You are already signed out."; return }
        signOutNote = nil
        busy = .signOut; busyFor = session
        let (status, _) = await send(Account.forgetRequest(coordinator: coordinator, session: session))
        if busyFor == session { busy = nil; busyFor = nil }
        // An answer for a sign-in that changed meanwhile signs out nothing: it would end the newer one here.
        guard currentSession() == session else { return }
        switch Account.forgetAnswer(status: status) {
        case .signOutHere: signedOut(session)
        case .stay(let why): signOutNote = why; offerLocalOnly = session
        }
    }

    @MainActor private func signOutEverywhere(for asked: String?) async {
        guard busy == nil, !sample else { return }
        guard let session = currentSession() else { signOutNote = "You are already signed out."; return }
        // Confirmed for another sign-in (it changed while the question was up): nothing is ended.
        guard asked == session else { return }
        signOutNote = nil; offerLocalOnly = nil
        busy = .everywhere; busyFor = session
        let (status, data) = await send(Account.signOutEverywhereRequest(coordinator: coordinator, session: session))
        if busyFor == session { busy = nil; busyFor = nil }
        guard currentSession() == session else { return }
        switch Account.everywhereAnswer(status: status, data: data) {
        case .signOutHere: signedOut(session)
        case .stay(let why): signOutNote = why
        }
    }

    // MARK: Two-step sign-in, asking Kosmos+

    @MainActor private func readSecond() async {
        if sample { second = .known(.init(enrolled: nil, smsAvailable: true)); return }
        secondTicket += 1
        let ticket = secondTicket
        guard let session = currentSession() else { second = .unreadable("You are signed out."); return }
        let (status, data) = await send(AccountSecond.statusRequest(coordinator: coordinator, session: session))
        guard !Task.isCancelled, ticket == secondTicket, currentSession() == session else {
            if ticket == secondTicket, case .reading = second { second = .unreadable(AccountSecond.unreadableWords) }
            return
        }
        // A failure leaves a state already shown as it is; only a first read says it could not tell.
        guard let status else { if case .reading = second { second = .unreadable(Account.reach) }; return }
        switch AccountSecond.read(status: status, json: data.flatMap { try? JSONSerialization.jsonObject(with: $0) }) {
        case .status(let s): second = .known(s); secondNote = nil
        // This session is refused: what was shown is no longer known, and Kosmos+'s sentence says why (after a step was
        // turned on by a confirm whose answer was lost, it says to sign in again with it).
        case .signedOut(let why): second = .unreadable(why ?? AccountSecond.unreadableWords)
        case .unreadable(let why): if case .reading = second { second = .unreadable(why) }
        }
    }

    @MainActor private func startSetup(_ kind: AccountSecond.Kind) async {
        guard !setupBusy, let session = sample ? "sample" : currentSession() else { return }
        secondNote = nil; setupNote = nil; code = ""
        setupFor = session
        if kind == .sms { setup = .phone; return }
        if sample { setup = .app(otpauth: "otpauth://totp/Kosmos:ada%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Kosmos", secret: "JBSWY3DPEHPK3PXP"); return }
        setupBusy = true
        let (status, data) = await send(AccountSecond.enrolRequest(coordinator: coordinator, session: session, phone: nil))
        setupBusy = false
        guard currentSession() == session else { return }
        guard let status else { secondNote = Account.reach; return }
        switch SignIn.enrolled(status: status, json: data.flatMap { try? JSONSerialization.jsonObject(with: $0) }) {
        case .totp(let link, let secret): setup = .app(otpauth: link, secret: secret)
        case .sms: secondNote = "That did not work. Try again."
        // As sendText: a refusal that says to start over (a step set up elsewhere, the sign-in ended) re-reads the section.
        case .refused(let why) where SignIn.startsOver(why): await settleUncertainSetup(why, closing: true)
        case .refused(let why): secondNote = why
        }
    }

    @MainActor private func sendText() async {
        guard !setupBusy, setup == .phone, let session = setupFor else { return }
        guard phone.contains(where: { $0.isASCII && $0.isNumber }) else { setupNote = "Type your mobile number first."; return }
        if sample { setup = .textCode(sentTo: "\u{2022}\u{2022}\u{2022} 1234"); return }
        guard currentSession() == session else { closeSetup(force: true); return }
        setupBusy = true; setupNote = nil
        let (status, data) = await send(AccountSecond.enrolRequest(coordinator: coordinator, session: session, phone: phone))
        setupBusy = false
        guard currentSession() == session, setup == .phone else { return }
        // No answer: Kosmos+ may have sent the text all the same (slice A's words, and its "I got a code").
        guard let status else { setupNote = SignIn.textMayBeComing; return }
        let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) }
        switch SignIn.enrolled(status: status, json: json) {
        case .sms(let sentTo): code = ""; setup = .textCode(sentTo: sentTo)
        case .totp: setupNote = "That did not work. Try again."
        case .refused(let why):
            // kosmos#5131, as the page: the text service refused, not the number. The offer turns to the app.
            if AccountSecond.textsUnavailable(status: status, json: json) {
                closeSetup(force: true)
                secondTicket += 1
                if case .known(let s) = second { second = .known(.init(enrolled: s.enrolled, smsAvailable: false)) }
                secondNote = why
            } else if SignIn.startsOver(why) {
                // As slice A's afterTextEnrol: a refusal no new number can fix (the sign-in ended, the setup expired).
                await settleUncertainSetup(why, closing: true)
            } else { setupNote = why }
        }
    }

    @MainActor private func confirmSetup() async {
        guard !setupBusy, let shown = setup, shown != .phone, let session = setupFor else { return }
        guard let typed = AccountSecond.code(code) else { setupNote = AccountSecond.codeNotSix; return }
        let texted: Bool
        if case .textCode = shown { texted = true } else { texted = false }
        if sample { closeSetup(force: true); second = .known(.init(enrolled: texted ? "sms" : "totp", smsAvailable: true)); return }
        guard currentSession() == session else { closeSetup(force: true); return }
        setupBusy = true; setupNote = nil
        let (status, data) = await send(AccountSecond.confirmRequest(coordinator: coordinator, session: session, code: typed))
        setupBusy = false
        // The step may be on even when the sign-in changed meanwhile; this screen reads it again for whoever is in now.
        guard currentSession() == session else { await readSecond(); return }
        // No answer: Kosmos+ may have turned the step on all the same, and then refuses this session from now on. The
        // section is read again, so it says so rather than offering a step that is on.
        guard let status else { setupNote = Account.reach; await settleUncertainSetup(Account.reach, closing: false); return }
        // A read that started before this answer must not overwrite what the answer shows.
        secondTicket += 1
        switch AccountSecond.confirmed(status: status, json: data.flatMap { try? JSONSerialization.jsonObject(with: $0) }) {
        case .on(let kind, let fresh):
            // First, before anything else asks Kosmos+: the old session is refused from now on.
            if let fresh { renewed(session, fresh) }
            closeSetup(force: true)
            second = .known(.init(enrolled: kind, smsAvailable: { if case .known(let s) = second { return s.smsAvailable }; return false }()))
            secondNote = nil
        case .onSignInAgain(let kind):
            closeSetup(force: true)
            second = .known(.init(enrolled: kind, smsAvailable: false))
            secondNote = AccountSecond.signInAgainWords(kind: kind)
        case .refused(let why):
            setupNote = why == AccountSecond.codeRefused ? SignIn.setupCodeRefused(texted: texted) : why
        case .startOver(let why):
            // Nothing staged any more may mean an earlier confirm went through.
            await settleUncertainSetup(why, closing: true)
        case .signedOut(let why):
            closeSetup(force: true)
            secondNote = why
        }
    }

    /// After an answer that leaves the setup uncertain (none came, or Kosmos+ said to start again): the section is read
    /// again, and the setup closes when the step turned out to be on or this session is refused, so the sheet never
    /// sits over a section that says otherwise. `why` stays on screen unless the re-read's own sentence replaces it.
    @MainActor private func settleUncertainSetup(_ why: String, closing: Bool) async {
        if closing { closeSetup(force: true); secondNote = why }
        // Busy while the read is out, so a second Confirm cannot start a request this read then closes the sheet over.
        setupBusy = true
        await readSecond()
        setupBusy = false
        switch second {
        case .unreadable:
            closeSetup(force: true); secondNote = nil
        case .known(let s) where s.enrolled != nil:
            closeSetup(force: true); secondNote = nil
        default:
            if closing, secondNote == nil { secondNote = why }
        }
    }

    private func closeSetup(force: Bool = false) {
        guard force || !setupBusy else { return }
        setup = nil; setupFor = nil; setupNote = nil; code = ""
    }

    private static let sampleRows: [Account.Computer] = {
        let now = Date().timeIntervalSince1970
        return [
            Account.Computer(name: "studio", lastSeen: now - 30, position: 0),
            Account.Computer(name: "laptop", lastSeen: now - 5 * 3600, position: 1),
            Account.Computer(name: "old-mini", lastSeen: now - 20 * 86400, position: 2),
            Account.Computer(name: "old-mini", lastSeen: now - 60 * 86400, retired: true, position: 3),
        ]
    }()
}

private final class RefuseRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
