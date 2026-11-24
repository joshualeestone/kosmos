import SwiftUI
import UniformTypeIdentifiers

// kosmos#8959 slice B1a: the Kosmos+ account, native. Opened from the Settings tab's "Your Kosmos+ account" row, where
// the web page used to open. The computers on the account (each with the web page's words, and Retire), Sign out and
// Sign out everywhere, and (slice B2) the plan line the in-app web page shows; billing, the subscription and the cloud
// machine are never on the phone (kosmos#718's CAN_BUY_HERE, Josh's switch). The logic is
// AccountLogic.swift; the second step (slice B1b) is AccountSecondLogic.swift; passkeys and sign-ins from new places
// (slice B1c) are AccountSecurityLogic.swift, with Apple's passkey sheet in PasskeyMaker.swift.
struct AccountView: View {
    let coordinator: URL
    // The account's web page, for what is not here yet (the Kosmos+ address; slice B3).
    let openPage: (URL) -> Void
    // This iPhone signs out (the app's own path, PushNotificationManager), with the session that was ended.
    let signedOut: (String) -> Void
    // The session signed in now: the keychain's, or the one the app holds in memory when the keychain could not save it
    // (PushNotificationManager.currentSession, kosmos#7042 review round 8).
    let currentSession: () -> String?
    // kosmos#8959 slice B1b: setting up a second step hands back a fresh session for this account (old, fresh); the app
    // keeps it (PushNotificationManager.sessionRenewed), because Kosmos+ refuses the old one from then on. Says whether
    // it was kept.
    let renewed: (String, String) -> Bool
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

    // kosmos#8959 slice B1c: passkeys and sign-ins from new places (AccountSecurityLogic.swift).
    private enum PasskeyLoad: Equatable { case reading, off, loaded([AccountSecurity.Passkey]), failed(String) }
    @State private var passkeys: PasskeyLoad = .reading
    @State private var passkeyTicket = 0
    @State private var passkeyNote: String?
    @State private var passkeyListNote: String?   // review 5: a failed read's note, apart from an Add or Remove's
    // Review 5: B1b's confirm renews the session for the SAME account (old -> fresh). B1c follows that chain, so a renewal is
    // never read as a sign-in change (which dropped an Add, a Not me's sign-out, or a read, without a word).
    @State private var renewedFrom: [String: String] = [:]
    @State private var passkeyDone: String?
    @State private var passkeyBusy = false
    @State private var passkeyFor: String?
    @State private var passkeyAdding = false
    @State private var onScreen = false   // review 8: an Add whose begin answers after the screen went away opens no sheet   // review 7: the Add button says "Adding" only for an Add, not a Remove
    @State private var removing: AccountSecurity.Passkey?
    // Review 1 (B1c): the sign-in each dialog was opened for. A press after the sign-in changed does nothing, as B1a's
    // Sign out everywhere (everywhereFor).
    @State private var removingFor: String?
    @State private var notMeAskedFor: String?
    // A challenge kept after any end but finish, used again by the next Add of the same account (followed across a renewal
    // by stillHeld), as the page's pkAddReady: each begin stores one, and five waiting are refused.
    @State private var heldAdd: (reg: AccountSecurity.Registration, at: Date, session: String)?
    @State private var maker = PasskeyMaker()
    @State private var newPlaces: [AccountSecurity.NewPlace] = []
    @State private var placesTicket = 0
    @State private var notMeFor: AccountSecurity.NewPlace?
    @State private var notMeBusy = false
    @State private var notMeBusyFor: String?   // review 1: the busy flag belongs to the sign-in that asked
    @State private var notMeNote: String?
    @State private var plan: String?          // slice B2: Account.planActive, or nil (no line)
    @State private var standing: Account.StandingNote?   // slice B2: the server's sentence when the plan is not good
    @State private var planTicket = 0

    var body: some View {
        List {
            planSection
            computers
            secondSection
            passkeySection
            newPlacesSection
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
            maker.cancel(); passkeyBusy = false; passkeyFor = nil; passkeyAdding = false; removing = nil; passkeyNote = nil; passkeyDone = nil
            passkeys = .reading; newPlaces = []; notMeFor = nil; notMeBusy = false; notMeBusyFor = nil; notMeNote = nil
            removingFor = nil; notMeAskedFor = nil; heldAdd = nil; renewedFrom = [:]; passkeyListNote = nil
            plan = nil; standing = nil
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
        .confirmationDialog("Remove this passkey?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
                            titleVisibility: .visible, presenting: removing) { p in
            Button("Remove \(p.name)", role: .destructive) { let asked = removingFor; Task { await removePasskey(p, for: asked) } }
            Button("Cancel", role: .cancel) {}
        } message: { p in
            Text(AccountSecurity.removeQuestion(p, day: Self.day))
        }
        .confirmationDialog("Not me?", isPresented: Binding(get: { notMeFor != nil }, set: { if !$0 { notMeFor = nil } }),
                            titleVisibility: .visible, presenting: notMeFor) { p in
            Button("Sign out everywhere", role: .destructive) { let asked = notMeAskedFor; Task { await notMe(p, for: asked) } }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text(AccountSecurity.notMeQuestion)
        }
        .onAppear { onScreen = true }
        .onDisappear { onScreen = false; maker.cancel() }
    }

    // MARK: The plan (slice B2)

    // Only what the in-app page shows (signin.html #plan-line and #standing-note): the plan line when Kosmos+ says it is
    // active, the server's own sentence when it is not, no section when there is neither, and never a way to buy, change
    // or cancel the plan here.
    @ViewBuilder private var planSection: some View {
        if plan != nil || standing != nil {
            Section {
                if let plan {
                    // Review 2: VoiceOver reads the dot as "middle dot"; the label says it as a pause.
                    Text(plan).foregroundColor(Palette.primary)
                        .accessibilityLabel(Account.planSpoken).accessibilityIdentifier("account-plan")
                }
                if let standing {
                    Text(standing.words).font(.subheadline)
                        .foregroundColor(standing.calm ? Palette.secondary : Palette.dangerWord)
                        .accessibilityIdentifier("account-standing")
                }
            }
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
                            .disabled(setupBusy || busy != nil || passkeyBusy || notMeBusy)   // review 5: no renewal mid-Add or mid-Not me
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

    // MARK: Passkeys and new places (kosmos#8959 slice B1c)

    @ViewBuilder private var passkeySection: some View {
        // 404: passkeys are off on this Kosmos+, and the section is not shown, as on the page.
        if passkeys != .off {
            Section {
                switch passkeys {
                case .reading, .off:
                    HStack { SweepDots(label: "Reading your passkeys", scales: false); Text("Reading your passkeys").foregroundColor(Palette.secondary) }
                case .failed(let why):
                    Text(why).foregroundColor(Palette.secondary)
                case .loaded(let rows):
                    if rows.isEmpty { Text(AccountSecurity.noPasskeys).foregroundColor(Palette.secondary) }
                    ForEach(rows, id: \.credentialID) { p in
                        HStack(alignment: .firstTextBaseline) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.name).foregroundColor(Palette.primary)
                                Text(AccountSecurity.passkeyLine(p, day: Self.day)).font(.footnote).foregroundColor(Palette.secondary)
                            }
                            Spacer()
                            Button("Remove") { passkeyNote = nil; passkeyDone = nil; removingFor = sample ? "sample" : currentSession(); removing = p }
                                .buttonStyle(.borderless).foregroundColor(Palette.dangerWord)
                                .disabled(passkeyBusy || busy != nil)
                                // Review 3: the date tells two of one name apart, as the page's labels do.
                                .accessibilityLabel("Remove " + p.name + (p.createdAt.map { ", added " + Self.day($0) } ?? ""))
                                .accessibilityIdentifier("account-passkey-remove-" + p.credentialID)
                        }
                        .frame(minHeight: 44)
                        .accessibilityElement(children: .contain)
                    }
                    Button(passkeyAdding ? "Adding a passkey" : AccountSecurity.addButton) { Task { await addPasskey() } }
                        .disabled(passkeyBusy || busy != nil)
                        .accessibilityIdentifier("account-passkey-add")
                }
            } header: {
                Text(AccountSecurity.passkeysTitle)
            } footer: {
                if let note = passkeyNote ?? passkeyListNote {
                    Text(note).font(.footnote).foregroundColor(Palette.dangerWord)
                } else {
                    Text(passkeyDone ?? AccountSecurity.passkeysWords).font(.footnote).foregroundColor(Palette.secondary)
                }
            }
        }
    }

    // Shown only when there is a sign-in to list, as on the page.
    @ViewBuilder private var newPlacesSection: some View {
        if !newPlaces.isEmpty {
            Section {
                ForEach(newPlaces, id: \.id) { p in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(p.name).foregroundColor(Palette.primary)
                        Text(AccountSecurity.newPlaceLine(p, when: Self.when)).font(.footnote).foregroundColor(Palette.secondary)
                        if AccountSecurity.offersNotMe(p) {
                            Button(AccountSecurity.notMeButton, role: .destructive) { notMeNote = nil; notMeAskedFor = currentSession(); notMeFor = p }
                                .buttonStyle(.borderless).foregroundColor(Palette.dangerWord)
                                .disabled(notMeBusy || busy != nil)
                                .accessibilityLabel(AccountSecurity.notMeButton + (p.at.map { ", for the sign-in " + Self.when($0) } ?? ""))
                                .accessibilityIdentifier("account-not-me-" + p.id)
                        }
                    }
                    .padding(.vertical, 4)
                    .accessibilityElement(children: .contain)
                }
            } header: {
                Text(AccountSecurity.newPlacesTitle)
            } footer: {
                Text(notMeNote ?? AccountSecurity.newPlacesWords)
                    .font(.footnote).foregroundColor(notMeNote == nil ? Palette.secondary : Palette.dangerWord)
            }
        }
    }

    // As the page's passkeyWhen (day, short month, year) and newPlaceWhen (with the time), in this iPhone's own locale.
    private static let dayFormat: DateFormatter = { let f = DateFormatter(); f.setLocalizedDateFormatFromTemplate("dMMMy"); return f }()
    private static let whenFormat: DateFormatter = { let f = DateFormatter(); f.setLocalizedDateFormatFromTemplate("dMMMyjmm"); return f }()
    private static func day(_ s: Int) -> String { dayFormat.string(from: Date(timeIntervalSince1970: Double(s))) }
    private static func when(_ s: Int) -> String { whenFormat.string(from: Date(timeIntervalSince1970: Double(s))) }

    // MARK: Sign out

    private var signOutSection: some View {
        Section {
            Button(busy == .signOut ? "Signing out" : (offerLocalOnly != nil ? "Try signing out again" : "Sign out")) { Task { await signOut() } }
                .disabled(busy != nil || notMeBusy)
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
            // Slice B2: only what that page still offers inside the app. It hides billing, the cloud machine and adding a
            // computer there (CAN_BUY_HERE), so this footer names none of them.
            Text("Your Kosmos+ address, and choosing one if you have none yet, are on your Kosmos+ account page.")
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
        if !again {
            async let s: Void = readSecond(), k: Void = readPasskeys(), n: Void = readNewPlaces(), m: Void = readPlan()
            await readComputers(again: again); await s; await k; await n; await m; return
        }
        // Review 1: the plan read also gave up when the sign-in changed under it, so it is asked again with the computers.
        async let m: Void = readPlan()
        await readComputers(again: again); await m
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

    // MARK: The plan, asking Kosmos+

    // A failed read keeps what is shown; a first read that fails shows nothing (the page shows nothing either).
    @MainActor private func readPlan() async {
        if sample { plan = Account.planActive; standing = nil; return }
        planTicket += 1
        let ticket = planTicket
        guard let session = currentSession() else { plan = nil; standing = nil; return }
        let (status, data) = await send(Account.meRequest(coordinator: coordinator, session: session))
        guard !Task.isCancelled, ticket == planTicket, currentSession() == session, let status else { return }
        // Review 2: a 200 that is not the account's JSON (a captive page, say) is a failed read, so what is shown stays.
        if (200...299).contains(status), Account.isObject(data) { plan = Account.planLine(data); standing = Account.standingNote(data) }
        else if status == 401 { plan = nil; standing = nil }
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
        // A refusal that says to start over (the sign-in ended), or a 401 (enrol refuses one when the account already has a
        // step, set up elsewhere since this screen read it: second.rs enrol), re-reads the section rather than offering again.
        case .refused(let why) where SignIn.startsOver(why) || status == 401: await settleUncertainSetup(why, closing: true)
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
            } else if SignIn.startsOver(why) || status == 401 {
                // As slice A's afterTextEnrol: a refusal no new number can fix (the sign-in ended, the setup expired, or a
                // step set up elsewhere since this screen read it, which enrol refuses with a 401).
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
            let kept = fresh.map { renewed(session, $0) } ?? true
            // Review 5/6 (B1c): the same account, followed by stillHeld. Recorded whenever the fresh session is the one this
            // iPhone holds now, even when the keychain refused to keep it (the registrar holds it in memory).
            if let fresh, kept || currentSession() == fresh { renewedFrom[session] = fresh }
            closeSetup(force: true)
            second = .known(.init(enrolled: kind, smsAvailable: { if case .known(let s) = second { return s.smsAvailable }; return false }()))
            // Not kept (the keychain refused it, or the sign-in changed meanwhile): this iPhone's session is now refused.
            secondNote = kept ? nil : AccountSecond.signInAgainWords(kind: kind)
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
            // This session is over: the section no longer knows the account's state, so it offers nothing.
            second = .unreadable(why)
            secondNote = nil
        }
    }

    /// After an answer that leaves the setup uncertain (none came, or Kosmos+ said to start again): the section is read
    /// again, and the setup closes when the step turned out to be on or this session is refused, so the sheet never
    /// sits over a section that says otherwise. `why` stays on screen unless the re-read's own sentence replaces it.
    @MainActor private func settleUncertainSetup(_ why: String, closing: Bool) async {
        if closing { closeSetup(force: true); secondNote = why }
        // Busy while the read is out, so a second Confirm cannot start a request this read then closes the sheet over.
        let asked = currentSession()
        setupBusy = true
        await readSecond()
        // The sign-in changed while the read was out: everything here belongs to the new one now (accountGeneration
        // reset it), so nothing is written over it.
        guard currentSession() == asked else { return }
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

    // MARK: Passkeys and new places, asking Kosmos+

    /// Review 5: the session held now when it is `asked`, or `asked` renewed (B1b's confirm) along its chain; nil when the
    /// sign-in really changed (signed out, or another account). Later requests use the session this returns.
    private func stillHeld(_ asked: String) -> String? {
        AccountSecurity.follow(asked, now: currentSession(), chain: renewedFrom)
    }

    @MainActor private func readPasskeys() async {
        if sample { passkeys = .loaded(Self.samplePasskeys); return }
        passkeyTicket += 1
        let ticket = passkeyTicket
        guard let session = currentSession() else { passkeys = .failed("You are signed out."); return }
        let (status, data) = await send(AccountSecurity.listRequest(coordinator: coordinator, session: session))
        guard !Task.isCancelled, ticket == passkeyTicket, stillHeld(session) != nil else {
            if ticket == passkeyTicket, case .reading = passkeys { passkeys = .failed(AccountSecurity.listFailed) }
            return
        }
        // No answer, or a failure: a list already shown stays, with the note; a first read says it could not list them.
        guard let status else { if case .loaded = passkeys { passkeyListNote = Account.reach } else { passkeys = .failed(Account.reach) }; return }
        switch AccountSecurity.list(status: status, json: data.flatMap { try? JSONSerialization.jsonObject(with: $0) }) {
        // A good read clears only a failed read's note: an Add or Remove's own note (such as "delete it in the Passwords
        // app") stays until the person acts again (review 5).
        case .passkeys(let rows): passkeys = .loaded(rows); passkeyListNote = nil
        case .off: passkeys = .off
        case .signedOut:
            // Answered for a renewed session (the old one is refused now): read again for the session held now.
            if session != currentSession(), stillHeld(session) != nil { await readPasskeys(); return }
            passkeys = .failed("You are signed out.")
        case .failed: if case .loaded = passkeys { passkeyListNote = AccountSecurity.listFailed } else { passkeys = .failed(AccountSecurity.listFailed) }
        }
    }

    @MainActor private func readNewPlaces() async {
        if sample { newPlaces = Self.sampleNewPlaces; return }
        placesTicket += 1
        let ticket = placesTicket
        guard let session = currentSession() else { newPlaces = []; return }
        let (status, data) = await send(AccountSecurity.newPlacesRequest(coordinator: coordinator, session: session))
        guard !Task.isCancelled, ticket == placesTicket, stillHeld(session) != nil else { return }
        // Review 5: answered for a session renewed meanwhile (refused now): read again for the one held now, so a list of
        // possible intruders is never left hidden by a renewal.
        if status == 401, session != currentSession() { await readNewPlaces(); return }
        // A blip leaves what was shown, as the page does (`if (!r.ok) return`): the email is still how the owner hears of one.
        guard let status, (200..<300).contains(status) else { return }
        newPlaces = AccountSecurity.newPlaces(status: status, json: data.flatMap { try? JSONSerialization.jsonObject(with: $0) })
    }

    @MainActor private func addPasskey() async {
        guard !passkeyBusy, let first = sample ? "sample" : currentSession() else { return }
        passkeyNote = nil; passkeyDone = nil
        if sample { passkeyDone = AccountSecurity.added; return }
        // Review 3: known before begin from the list shown, so no fresh sign-in is asked for an Add this iPhone cannot do.
        // Review 4: when the list is not shown, the check after begin (on its exclude list) still stops it; nothing is made.
        if #available(iOS 17.4, *) {} else if case .loaded(let rows) = passkeys, !rows.isEmpty { passkeyNote = AccountSecurity.addNeedsNewer; return }
        passkeyBusy = true; passkeyFor = first; passkeyAdding = true
        defer { if passkeyFor == first { passkeyBusy = false; passkeyFor = nil; passkeyAdding = false } }
        /* Review 2: a challenge is held from the moment begin answers, with the time begin answered (its true age), and is
           let go only once finish has been sent. Every other end (Apple's sheet closed or refused, the host refused, an
           older iOS) leaves it for the next press, so presses do not stack up waiting challenges (Kosmos+ keeps five).
           Review 5: the challenge belongs to the account, not the session (passkey.rs), so a renewed session keeps it. */
        let reg: AccountSecurity.Registration
        let begunAt: Date   // review 4: the challenge's own age, carried here rather than read back from heldAdd
        if let held = heldAdd, stillHeld(held.session) == first, Date().timeIntervalSince(held.at) < AccountSecurity.heldChallengeSeconds {
            reg = held.reg; begunAt = held.at
        } else {
            heldAdd = nil
            let asked = Date()   // review 7: the age counts from the ask, as the page's askedAt (the answer's travel is part of it)
            let (status, data) = await send(AccountSecurity.beginRequest(coordinator: coordinator, session: first))
            guard stillHeld(first) != nil else { return }
            guard let status else { passkeyNote = Account.reach; return }
            let begun = data.flatMap { try? JSONSerialization.jsonObject(with: $0) }
            guard (200..<300).contains(status) else { passkeyNote = AccountSecurity.refusal(json: begun, fallback: AccountSecurity.addNotNow); return }
            // A begin asking for what an iPhone passkey is not (another algorithm, an attestation) is refused here rather
            // than making a passkey finish would turn away.
            guard let got = AccountSecurity.registration(status: status, json: begun) else { passkeyNote = AccountSecurity.addFailed; return }
            reg = got; begunAt = asked
            heldAdd = (got, begunAt, first)
        }
        if let refusal = AccountSecurity.rpRefusal(reg, coordinator: coordinator) { passkeyNote = refusal; return }
        guard onScreen else { return }   // the challenge stays held for the next Add
        if #available(iOS 17.4, *) {} else if !reg.exclude.isEmpty { passkeyNote = AccountSecurity.addNeedsNewer; return }
        switch await maker.make(reg, closeAfter: AccountSecurity.sheetSeconds(ageSeconds: Date().timeIntervalSince(begunAt))) {
        case .cancelled:
            // The challenge stays held for the next press of this sign-in (it is live for five minutes).
            if stillHeld(first) != nil { passkeyNote = AccountSecurity.addCancelled }
            return
        case .alreadyHere: if stillHeld(first) != nil { passkeyNote = AccountSecurity.addHave }; return
        case .failed: if stillHeld(first) != nil { passkeyNote = AccountSecurity.addFailed }; return
        case .made(let id, let att, let client):
            // Signed out, or another account, while Apple's sheet was open: nothing is sent for it. A renewal is the same
            // account, and finish goes with the session held now.
            guard let session = stillHeld(first) else { return }
            heldAdd = nil   // finish uses the challenge up, whatever it answers
            guard let body = AccountSecurity.finishBody(credentialID: id, attestationObject: att, clientDataJSON: client,
                                                        name: AccountSecurity.passkeyName)
            else { passkeyNote = AccountSecurity.madeButRefused(AccountSecurity.addFailed); return }
            let (fs, fd) = await send(AccountSecurity.finishRequest(coordinator: coordinator, session: session, body: body))
            guard stillHeld(session) != nil else { return }
            // No answer: it may have been added or not. The list is read again; the note (kept apart from the list's) says
            // what to do if it is not there.
            guard let fs else {
                passkeyNote = "Kosmos+ did not answer. If the new passkey is not listed, delete it in \(AccountSecurity.passwordsPlace) and add one again."
                await readPasskeys(); return
            }
            guard (200..<300).contains(fs) else {
                let answer = fd.flatMap { try? JSONSerialization.jsonObject(with: $0) }
                // Review 4/5: the passkey exists on the iPhone already; any refusal here says to delete it there.
                let usual = AccountSecurity.refusal(json: answer, fallback: AccountSecurity.addFailed)
                passkeyNote = usual == AccountSecurity.stepUp ? AccountSecurity.stepUpAfterMade : AccountSecurity.madeButRefused(usual)
                return
            }
            passkeyDone = AccountSecurity.added
            await readPasskeys()
        }
    }

    @MainActor private func removePasskey(_ p: AccountSecurity.Passkey, for asked: String?) async {
        removing = nil; removingFor = nil
        guard !passkeyBusy, let asked else { return }
        if sample { if asked == "sample" { passkeyNote = nil; passkeyDone = AccountSecurity.removed }; return }
        guard let session = stillHeld(asked) else { return }
        passkeyNote = nil; passkeyDone = nil
        passkeyBusy = true; passkeyFor = session
        let (status, data) = await send(AccountSecurity.removeRequest(coordinator: coordinator, session: session, p))
        if passkeyFor == session { passkeyBusy = false; passkeyFor = nil }
        guard stillHeld(session) != nil else { return }
        guard let status else { passkeyNote = Account.reach; return }
        guard (200..<300).contains(status) else {
            passkeyNote = AccountSecurity.refusal(json: data.flatMap { try? JSONSerialization.jsonObject(with: $0) }, fallback: AccountSecurity.removeFailed)
            return
        }
        passkeyDone = AccountSecurity.removed
        await readPasskeys()
    }

    @MainActor private func notMe(_ p: AccountSecurity.NewPlace, for asked: String?) async {
        notMeFor = nil; notMeAskedFor = nil
        // Confirmed for another account (it changed while the question was up): nothing is signed out. A renewal is the
        // same account (review 5).
        guard !notMeBusy, !sample, let asked, let session = stillHeld(asked) else { return }
        notMeNote = nil
        notMeBusy = true; notMeBusyFor = session
        let (status, data) = await send(AccountSecurity.notMeRequest(coordinator: coordinator, session: session, p))
        if notMeBusyFor == session { notMeBusy = false; notMeBusyFor = nil }
        // Review 5: Kosmos+ refuses every session issued before Not me, a renewed one too, so the sign-out goes to the
        // session held now when it is still this account.
        guard let held = stillHeld(session) else { return }
        guard let status else { notMeNote = Account.reach; return }
        switch AccountSecurity.notMe(status: status, json: data.flatMap { try? JSONSerialization.jsonObject(with: $0) }) {
        // The account is signed out everywhere, this iPhone included: the app's own sign-out way.
        case .signedOutEverywhere: signedOut(held)
        case .sessionGone: notMeNote = AccountSecurity.notMeSessionGone
        case .refused(let why): notMeNote = why
        }
    }

    private static let samplePasskeys: [AccountSecurity.Passkey] = {
        let now = Int(Date().timeIntervalSince1970)
        return [AccountSecurity.Passkey(credentialID: "sample-1", name: "iPhone", createdAt: now - 40 * 86400, lastUsedAt: now - 2 * 86400),
                AccountSecurity.Passkey(credentialID: "sample-2", name: "MacBook", createdAt: now - 90 * 86400, lastUsedAt: nil)]
    }()

    private static let sampleNewPlaces: [AccountSecurity.NewPlace] = {
        let now = Int(Date().timeIntervalSince1970)
        return [AccountSecurity.NewPlace(id: "np-1", name: "Safari on a Mac", at: now - 3 * 3600, notMeAt: nil)]
    }()

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
