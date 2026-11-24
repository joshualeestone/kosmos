import SwiftUI

// kosmos#8959 slice B1a: the Kosmos+ account, native. Opened from the Settings tab's "Your Kosmos+ account" row, where
// the web page used to open. The computers on the account (each with the web page's words, and Retire), Sign out and
// Sign out everywhere; everything else on the account (billing, passkeys, the second step) is one row away on the web
// page, until slices B1b, B1c and B2. The logic is AccountLogic.swift.
struct AccountView: View {
    let coordinator: URL
    // The account's web page, for what is not here yet.
    let openPage: (URL) -> Void
    // This iPhone signs out (the app's own path, PushNotificationManager), with the session that was ended.
    let signedOut: (String) -> Void
    var sample = false

    private enum Load: Equatable {
        case reading
        case loaded([Account.Computer])
        case failed(String)
    }

    @State private var load: Load = .reading
    @State private var listNote: String?
    // The computer being retired, the code Kosmos+ gave for it, its sentence, and what the person typed.
    @State private var retiring: (name: String, code: String, words: String)?
    @State private var typed = ""
    @State private var retireNote: String?
    @State private var retireBusy = false
    @State private var askEverywhere = false
    @State private var busy: Busy?
    @State private var signOutNote: String?
    // Sign out on Kosmos+ did not answer: the person chooses, try again or sign out on this iPhone only.
    @State private var offerLocalOnly = false

    private enum Busy { case signOut, everywhere }

    var body: some View {
        List {
            computers
            signOutSection
            more
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.ground.ignoresSafeArea())
        .navigationTitle("Kosmos+ account")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .refreshable { await read() }
        .task { await read() }
        .sheet(isPresented: Binding(get: { retiring != nil }, set: { if !$0 { closeRetire() } })) { retireSheet }
        .confirmationDialog("Sign out everywhere?", isPresented: $askEverywhere, titleVisibility: .visible) {
            Button("Sign out everywhere", role: .destructive) { Task { await signOutEverywhere() } }
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
                HStack { ProgressView(); Text("Reading your computers").foregroundColor(Palette.secondary) }
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
                    .disabled(retireBusy)
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
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { closeRetire() } } }
        }
        .navigationViewStyle(.stack)
        .interactiveDismissDisabled(retireBusy)
    }

    // MARK: Sign out

    private var signOutSection: some View {
        Section {
            Button(busy == .signOut ? "Signing out" : (offerLocalOnly ? "Try signing out again" : "Sign out")) { Task { await signOut() } }
                .disabled(busy != nil)
                .accessibilityIdentifier("account-sign-out")
            if offerLocalOnly, let session = SessionKeychain.live.load() {
                Button("Sign out on this iPhone only", role: .destructive) { signedOut(session) }
                    .disabled(busy != nil)
            }
            Button(busy == .everywhere ? "Signing out everywhere" : "Sign out everywhere", role: .destructive) { askEverywhere = true }
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
                }
            }
        } footer: {
            Text("Your plan and billing, passkeys, the second sign-in step and adding a computer are on your Kosmos+ account page.")
                .font(.footnote).foregroundColor(Palette.secondary)
        }
    }

    // MARK: Asking Kosmos+

    private func send(_ r: URLRequest) async -> (Int?, Data?) {
        guard let (data, answer) = try? await URLSession.shared.data(for: r), let http = answer as? HTTPURLResponse
        else { return (nil, nil) }
        return (http.statusCode, data)
    }

    private func read() async {
        if sample { load = .loaded(Self.sampleRows); return }
        guard let session = SessionKeychain.live.load() else { load = .failed("You are signed out."); return }
        let (status, data) = await send(Board.macsRequest(coordinator: coordinator, session: session))
        // The answer belongs to the sign-in that asked: one that changed meanwhile shows nothing of it.
        guard SessionKeychain.live.load() == session else { return }
        guard let status else { if case .loaded = load { listNote = Account.reach } else { load = .failed(Account.reach) }; return }
        if (200...299).contains(status), let rows = Account.parseComputers(data) {
            load = .loaded(rows); listNote = nil
        } else {
            let why = Account.errorWords(data) ?? "Could not list your computers."
            if case .loaded = load { listNote = why } else { load = .failed(why) }
        }
    }

    private func askRetire(_ name: String) async {
        guard let session = SessionKeychain.live.load(), !retireBusy else { return }
        listNote = nil
        retireBusy = true
        let (status, data) = sample ? (409, Data(#"{"confirm":"K7QX","message":"type K7QX to retire studio; it will stop answering and its name is free again after a day"}"#.utf8))
            : await send(Account.retireRequest(coordinator: coordinator, session: session, name: name))
        retireBusy = false
        switch Account.retireAnswer(status: status, data: data, name: name, typed: nil) {
        case .confirm(let code, let words): typed = ""; retireNote = nil; retiring = (name, code, words)
        case .retired: await read()
        case .refused(let why): listNote = why
        }
    }

    private func confirmRetire() async {
        if sample { closeRetire(); return }
        guard let r = retiring, let session = SessionKeychain.live.load(), !retireBusy else { return }
        let code = Account.typedCode(typed)
        guard !code.isEmpty else { retireNote = "Type the four characters shown above."; return }
        retireNote = nil
        retireBusy = true
        let (status, data) = await send(Account.retireRequest(coordinator: coordinator, session: session, name: r.name, confirm: code))
        retireBusy = false
        switch Account.retireAnswer(status: status, data: data, name: r.name, typed: code) {
        case .retired: closeRetire(); await read()
        case .refused(let why): retireNote = why
        case .confirm: retireNote = "That is not the code shown for \(r.name). Nothing was retired."
        }
    }

    private func closeRetire() {
        guard !retireBusy else { return }
        retiring = nil; typed = ""; retireNote = nil
    }

    private func signOut() async {
        guard busy == nil, let session = SessionKeychain.live.load() else { return }
        signOutNote = nil
        busy = .signOut
        let (status, _) = await send(Account.forgetRequest(coordinator: coordinator, session: session))
        busy = nil
        switch Account.forgetAnswer(status: status) {
        case .signOutHere: signedOut(session)
        case .stay(let why): signOutNote = why; offerLocalOnly = true
        }
    }

    private func signOutEverywhere() async {
        guard busy == nil, let session = SessionKeychain.live.load() else { return }
        signOutNote = nil
        busy = .everywhere
        let (status, data) = await send(Account.signOutEverywhereRequest(coordinator: coordinator, session: session))
        busy = nil
        switch Account.everywhereAnswer(status: status, data: data) {
        case .signOutHere: signedOut(session)
        case .stay(let why): signOutNote = why
        }
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
