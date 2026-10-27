import LocalAuthentication
import SwiftUI

// kosmos#7010 (slice 10 of #6838): the native Settings tab. The phone switches (the computer's own setting, read and
// written as the board's Settings does), the computer this phone shows, Face ID (only while the app asks for it), the
// Kosmos+ account (its own pages, opened in the app's web view), and a row to the board's own Settings for everything
// else. The logic is SettingsLogic.swift.
struct SettingsView: View {
    let coordinator: URL
    // A Kosmos+ page (the account, the delete flow), opened in the app's web view.
    let openPage: (URL) -> Void
    // The board's own Settings, shown under Today (AppTabs.barTab).
    let openBoardSettings: () -> Void
    // kosmos#7266 slice B: the person on the shown computer, for the page's top (BoardClient.youName / youPicture).
    var youName: String? = nil
    var youPicture: Data? = nil

    private enum Load: Equatable {
        case reading
        case signedOut
        case noComputer
        case loaded(Settings.PhoneNotify)
        case failed(String)
    }

    @State private var load: Load = .reading
    // The switch being saved and the value the person chose for it, shown until the computer answers.
    @State private var saving: (key: String, on: Bool)?
    @State private var note: String?
    @State private var mac: Settings.Mac?
    // Bumped by every write, so a read that started before it cannot paint the older state over the newer one.
    @State private var generation = 0

    private static var sample: Bool {
        #if DEBUG
        // The Agents tab's Debug sample switch (BoardClient): Settings shows a sample computer with it, for screenshots.
        return ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_AGENTS"] == "1"
        #else
        return false
        #endif
    }

    var body: some View {
        NavigationView {
            ScrollViewReader { scroller in
                List {
                    profile
                    notifications
                    computer
                    // Only while the app really asks for it: the lock is off by default (KosmosConfig.requireBiometricUnlock,
                    // a product decision still open, #718), and a line saying it is on would be untrue.
                    if KosmosConfig.requireBiometricUnlock { security }
                    account
                    board
                    about
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                // A switch that is on reads as on in both modes: the app's ink tint made it black in light and
                // near-white on a white knob in dark. The system green is what the 19 Oct design drew (p6-settings).
                .tint(Color(UIColor.systemGreen))
                .background(Palette.ground.ignoresSafeArea())
                .navigationTitle("Settings")
                .refreshable { await read() }
                .onAppear {
                    #if DEBUG
                    // Screenshots of the lower sections (KOSMOS_SAMPLE_SCROLL=account, a Debug build only).
                    if Self.sample && ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_SCROLL"] == "account" {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { scroller.scrollTo("account", anchor: .top) }
                    }
                    #endif
                }
            }
        }
        .navigationViewStyle(.stack)
        .task { await read() }
    }

    // MARK: Profile (kosmos#7266 slice B)

    // The person's picture and name on top, as a profile page; every setting under it. The picture and the name are
    // the computer's own ("You" on the board): they are changed there, which the footer says.
    private var profile: some View {
        Section {
            VStack(spacing: 10) {
                Group {
                    if let picture = YouFace.profileImage(youPicture) {
                        Image(uiImage: picture).resizable().scaledToFill()
                    } else if let letter = Board.youLetter(youName) {
                        // Mona Lisa's review: the person's letter on the avatar cream, as an agent with no picture.
                        ZStack {
                            Palette.avatarFill
                            Text(letter).font(.system(size: 36, weight: .semibold)).foregroundColor(Palette.avatarLetter)
                        }
                    } else {
                        Image(systemName: "person.crop.circle.fill").resizable().scaledToFit().foregroundColor(Palette.secondary)
                    }
                }
                .frame(width: 88, height: 88)
                .clipShape(Circle())
                .accessibilityHidden(true)
                Text(youName ?? "You").font(.title2.weight(.semibold)).foregroundColor(Palette.primary)
                    .multilineTextAlignment(.center)
                    .accessibilityAddTraits(.isHeader)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .listRowBackground(Color.clear)
        } footer: {
            Text("Your name and picture come from your computer. Change them in your Profile in the board's Settings.")
                .font(.footnote).foregroundColor(Palette.secondary).frame(maxWidth: .infinity, alignment: .center)
                .multilineTextAlignment(.center)
        }
    }

    // MARK: Notifications

    @ViewBuilder private var notifications: some View {
        Section {
            switch load {
            case .reading:
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Reaching your computer…").font(.footnote).foregroundColor(Palette.secondary)
                }
            case .signedOut:
                Text("Sign in to Kosmos+ first, then your computer's phone settings show here.")
                    .font(.subheadline).foregroundColor(Palette.secondary)
            case .noComputer:
                Text("Open the Agents tab to connect to your computer, then its phone settings show here.")
                    .font(.subheadline).foregroundColor(Palette.secondary)
            case .failed(let why):
                VStack(alignment: .leading, spacing: 8) {
                    Text(why).font(.subheadline).foregroundColor(Palette.secondary)
                    Button("Try again") { Task { await read() } }
                }
            case .loaded(let s):
                switchRow(s, kind: nil)
                if Settings.kindsShown(s) {
                    ForEach(Settings.Kind.allCases, id: \.self) { kind in switchRow(s, kind: kind) }
                }
            }
        } header: {
            Text("Phone notifications")
        } footer: {
            if let note {
                Text(note).font(.footnote).foregroundColor(Palette.dangerWord)
            } else if case .loaded = load {
                Text("These are your computer's own settings, the same as in Settings on its board.")
                    .font(.footnote).foregroundColor(Palette.secondary)
            }
        }
    }

    private func key(_ kind: Settings.Kind?) -> String { kind?.rawValue ?? "master" }

    private func switchRow(_ s: Settings.PhoneNotify, kind: Settings.Kind?) -> some View {
        let k = key(kind)
        let chosen: Bool? = saving?.key == k ? saving?.on : nil
        return Toggle(isOn: Binding(
            // While it saves, the switch shows what the person chose; then what the computer says.
            get: { chosen ?? (kind.map { s.isOn($0) } ?? s.on) },
            set: { on in Task { await write(kind: kind, on: on) } }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(kind?.label ?? Settings.masterLabel).foregroundColor(Palette.primary)
                    if chosen != nil { ProgressView().controlSize(.small) }
                }
                if kind == nil {
                    Text(Settings.masterNote(s)).font(.footnote).foregroundColor(Palette.secondary)
                } else if let hint = kind?.hint {
                    Text(hint).font(.footnote).foregroundColor(Palette.secondary)
                }
            }
        }
        // One save at a time; the master also waits until the computer could act on it.
        .disabled(saving != nil || (kind == nil && !Settings.masterEnabled(s)))
    }

    // MARK: Computer

    @ViewBuilder private var computer: some View {
        if let mac {
            Section {
                HStack {
                    Text("Showing").foregroundColor(Palette.primary)
                    Spacer()
                    Text(mac.name).foregroundColor(Palette.secondary)
                }
                .accessibilityElement(children: .combine)
            } header: {
                Text("Computer")
            }
        }
    }

    // MARK: Security

    @ViewBuilder private var security: some View {
        Section {
            HStack {
                Label(Self.biometry.title, systemImage: Self.biometry.symbol).foregroundColor(Palette.primary)
                Spacer()
                Text("On").foregroundColor(Palette.secondary)
            }
            .accessibilityElement(children: .combine)
        } header: {
            Text("Security")
        } footer: {
            Text("Kosmos asks for \(Self.biometry.inSentence) each time it opens, so only you can see your agents.")
                .font(.footnote).foregroundColor(Palette.secondary)
        }
    }

    private static var biometry: (title: String, inSentence: String, symbol: String) {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
        switch context.biometryType {
        case .touchID: return ("Touch ID", "Touch ID", "touchid")
        case .faceID: return ("Face ID", "Face ID", "faceid")
        default: return ("Passcode", "your passcode", "lock")
        }
    }

    // MARK: Account

    @ViewBuilder private var account: some View {
        Section {
            Button { openPage(Settings.accountURL(coordinator: coordinator)) } label: {
                row("Your Kosmos+ account", detail: "Sign out here")
            }
            Button { openPage(Settings.deleteAccountURL(coordinator: coordinator)) } label: {
                Text("Delete account").foregroundColor(Palette.dangerWord)
            }
        } header: {
            Text("Account").id("account")
        } footer: {
            Text("Deleting your account takes a few steps on Kosmos+ and asks you to confirm with a code we email you.")
                .font(.footnote).foregroundColor(Palette.secondary)
        }
    }

    // MARK: The board's own Settings

    @ViewBuilder private var board: some View {
        Section {
            Button(action: openBoardSettings) { row("Settings on your computer's board", detail: nil) }
        } footer: {
            Text("Agents, AI models, connections and the rest of your computer's settings are there.")
                .font(.footnote).foregroundColor(Palette.secondary)
        }
    }

    // kosmos#7266: the credit the Agents tab's icon needs (Font Awesome Free's icons are CC BY 4.0).
    private var about: some View {
        Section {
            // Review 1 nit: the licence linked and its holder named, as CC BY 4.0 asks.
            Text("The Agents icon is from Font Awesome Free, \u{00A9} Fonticons, Inc., used under the [CC BY 4.0 licence](https://creativecommons.org/licenses/by/4.0/).")
                .font(.footnote).foregroundColor(Palette.secondary)
        } header: {
            Text("About")
        }
    }

    private func row(_ title: String, detail: String?) -> some View {
        HStack {
            Text(title).foregroundColor(Palette.primary)
            Spacer()
            if let detail { Text(detail).foregroundColor(Palette.secondary) }
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundColor(Palette.tertiary)
        }
    }

    // MARK: Reading and writing

    private func keptMac() -> Settings.Mac? {
        if Self.sample {
            return Settings.Mac(name: "Studio Mac", url: URL(string: "https://studio.kosmosplus.com/")!, cookie: "sample")
        }
        return Settings.keptMac(stored: SessionKeychain.macSession.load(), session: SessionKeychain.live.load(), coordinator: coordinator)
    }

    // One session for every request here, refusing redirects as the app's own client and the notice extension do, so
    // the computer's cookie can never be carried to another host.
    private static let http = URLSession(configuration: .ephemeral, delegate: RefuseRedirects(), delegateQueue: nil)

    private func send(_ request: URLRequest?) async -> (Int, Data) {
        guard let request else { return (0, Data()) }
        if Self.sample {
            let s = #"{"available":true,"on":true,"connected":true,"kinds":{"needsYou":true,"replied":true,"postedMention":true,"ready":true,"postedRoom":false},"offByChoice":false,"defaultBecause":null}"#
            return (200, Data(s.utf8))
        }
        guard let (data, response) = try? await Self.http.data(for: request),
              let answer = response as? HTTPURLResponse
        else { return (0, Data()) }
        return (answer.statusCode, data)
    }

    @MainActor private func read() async {
        let started = generation
        if !Self.sample && SessionKeychain.live.load() == nil { mac = nil; load = .signedOut; return }
        mac = keptMac()
        guard let mac else { load = .noComputer; return }
        if case .loaded = load {} else { load = .reading }
        let (status, data) = await send(Settings.readRequest(mac))
        // A write landed meanwhile: its answer is newer than this one.
        guard started == generation else { return }
        if let s = Settings.phoneNotify(status: status, data: data) {
            load = .loaded(s)
            note = nil
        } else {
            load = .failed(Settings.refusal(status: status, data: data, writing: false))
        }
    }

    @MainActor private func write(kind: Settings.Kind?, on: Bool) async {
        guard let mac, saving == nil else { return }
        generation += 1
        saving = (key(kind), on)
        defer { saving = nil }
        let (status, data) = await send(Settings.writeRequest(mac, kind: kind, on: on))
        if let s = Settings.phoneNotify(status: status, data: data) {
            load = .loaded(s)
            note = nil
        } else {
            // Nothing changed on the computer: the switch goes back to what it says, and the footer says why.
            note = Settings.refusal(status: status, data: data, writing: true)
        }
    }
}

private final class RefuseRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
