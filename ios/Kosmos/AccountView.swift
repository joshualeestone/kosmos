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
    // The session signed in now: the keychain's, or the one the app holds in memory when the keychain could not save it
    // (PushNotificationManager.currentSession, kosmos#7042 review round 8).
    let currentSession: () -> String?
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
    @State private var busy: Busy?
    @State private var signOutNote: String?
    // Sign out on Kosmos+ did not answer: the person chooses, try again or sign out on this iPhone only. Holds the
    // session that sign-out was for.
    @State private var offerLocalOnly: String?

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
        .onChange(of: accountGeneration) { _ in
            // A sheet, a choice or a note belonged to the sign-in that just changed.
            retireBusy = false; retireFor = nil; closeRetire(); offerLocalOnly = nil; signOutNote = nil; listNote = nil
            busy = nil; busyFor = nil
            load = .reading
            Task { await read() }
        }
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
            Button(busy == .signOut ? "Signing out" : (offerLocalOnly != nil ? "Try signing out again" : "Sign out")) { Task { await signOut() } }
                .disabled(busy != nil)
                .accessibilityIdentifier("account-sign-out")
            if let session = offerLocalOnly {
                Button("Sign out on this iPhone only", role: .destructive) {
                    // Only while it is still the sign-in this iPhone holds.
                    if currentSession() == session { signedOut(session) } else { offerLocalOnly = nil }
                }
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
                        .accessibilityHidden(true)
                }
            }
            .accessibilityIdentifier("account-more")
        } footer: {
            Text("Your plan and billing, passkeys, the second sign-in step and adding a computer are on your Kosmos+ account page.")
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

    @MainActor private func read() async {
        if sample { load = .loaded(Self.sampleRows); return }
        readTicket += 1
        let ticket = readTicket
        guard let session = currentSession() else { load = .failed("You are signed out."); return }
        let (status, data) = await send(Board.macsRequest(coordinator: coordinator, session: session))
        // A cancelled pull or a screen that went away: no answer, so nothing on screen changes.
        if Task.isCancelled { return }
        // A newer read was started meanwhile (a pull, a retire, a sign-in change): its answer is the one shown.
        guard ticket == readTicket else { return }
        // The answer belongs to the sign-in that asked. One that changed meanwhile is not shown; the change itself
        // (accountGeneration) clears the list and reads it again; without one, this reads again for the sign-in held now.
        guard currentSession() == session else {
            if ticket == readTicket { await read() }
            return
        }
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

    @MainActor private func signOutEverywhere() async {
        guard busy == nil, !sample else { return }
        guard let session = currentSession() else { signOutNote = "You are already signed out."; return }
        signOutNote = nil
        busy = .everywhere; busyFor = session
        let (status, data) = await send(Account.signOutEverywhereRequest(coordinator: coordinator, session: session))
        if busyFor == session { busy = nil; busyFor = nil }
        guard currentSession() == session else { return }
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

private final class RefuseRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
