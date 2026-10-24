import LocalAuthentication
import SwiftUI

// kosmos#7010 (slice 10 of #6838): the native Settings tab. The phone switches (the computer's own setting, read and
// written as the board's Settings does), the computer this phone shows, Face ID (only while the app asks for it), and the Kosmos+
// account (its own pages, opened in the app's web view). Everything about agents, models and connections stays on
// the computer, as the Agents tab says. The logic is SettingsLogic.swift.
struct SettingsView: View {
    let coordinator: URL
    // A Kosmos+ page (the account, the delete flow), opened in the app's web view.
    let openPage: (URL) -> Void
    // The app's choose-a-computer flow (Shell.otherComputer).
    let chooseComputer: () -> Void

    private enum Load: Equatable {
        case reading
        case noComputer
        case loaded(Settings.PhoneNotify)
        case failed(String)
    }

    @State private var load: Load = .reading
    @State private var saving: String?
    @State private var note: String?
    @State private var mac: Settings.Mac?

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
                notifications
                computer
                // Only while the app really asks for it: the lock is off by default (KosmosConfig.requireBiometricUnlock,
                // a product decision still open, #718), and a line saying it is on would be untrue.
                if KosmosConfig.requireBiometricUnlock { security }
                account
                Section {
                    EmptyView()
                } footer: {
                    Text("Agents, AI models and connections are set up on your computer.")
                        .font(.footnote).foregroundColor(Palette.secondary)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            // A switch that is on reads as on in both modes: the app's ink tint made it black in light and near-white
            // on a white knob in dark. The system green is what the 19 Oct design drew (p6-settings).
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

    // MARK: Notifications

    @ViewBuilder private var notifications: some View {
        Section {
            switch load {
            case .reading:
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Reaching your computer…").font(.footnote).foregroundColor(Palette.secondary)
                }
            case .noComputer:
                Text("Open the Agents tab to connect to your computer, then the switches show here.")
                    .font(.subheadline).foregroundColor(Palette.secondary)
            case .failed(let why):
                VStack(alignment: .leading, spacing: 8) {
                    Text(why).font(.subheadline).foregroundColor(Palette.secondary)
                    Button("Try again") { Task { await read() } }
                }
            case .loaded(let s):
                Toggle(isOn: binding(s, kind: nil)) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(Settings.masterLabel).foregroundColor(Palette.primary)
                        Text(Settings.masterNote(s)).font(.footnote).foregroundColor(Palette.secondary)
                    }
                }
                .disabled(!Settings.masterEnabled(s) || saving != nil)
                if s.on {
                    ForEach(Settings.Kind.allCases, id: \.self) { kind in
                        Toggle(isOn: binding(s, kind: kind)) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(kind.label).foregroundColor(Palette.primary)
                                if let hint = kind.hint {
                                    Text(hint).font(.footnote).foregroundColor(Palette.secondary)
                                }
                            }
                        }
                        .disabled(saving != nil)
                    }
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

    private func binding(_ s: Settings.PhoneNotify, kind: Settings.Kind?) -> Binding<Bool> {
        Binding(
            get: { kind.map { s.isOn($0) } ?? s.on },
            set: { on in Task { await write(kind: kind, on: on) } }
        )
    }

    // MARK: Computer

    @ViewBuilder private var computer: some View {
        Section {
            HStack {
                Text("Showing").foregroundColor(Palette.primary)
                Spacer()
                Text(mac?.name ?? "No computer yet").foregroundColor(Palette.secondary)
            }
            .accessibilityElement(children: .combine)
            Button(action: chooseComputer) {
                Text("Use another computer").foregroundColor(Palette.primary)
            }
        } header: {
            Text("Computer")
        }
    }

    // MARK: Security

    @ViewBuilder private var security: some View {
        Section {
            HStack {
                Label(Self.biometryName, systemImage: Self.biometrySymbol).foregroundColor(Palette.primary)
                Spacer()
                Text("On").foregroundColor(Palette.secondary)
            }
            .accessibilityElement(children: .combine)
        } header: {
            Text("Security")
        } footer: {
            Text("Kosmos asks for \(Self.biometryName) each time it opens, so only you can see your agents.")
                .font(.footnote).foregroundColor(Palette.secondary)
        }
    }

    private static var biometryType: LABiometryType {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
        return context.biometryType
    }
    private static var biometryName: String {
        switch biometryType {
        case .touchID: return "Touch ID"
        case .faceID: return "Face ID"
        default: return "Your passcode"
        }
    }
    private static var biometrySymbol: String { biometryType == .touchID ? "touchid" : "faceid" }

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
            Text("Deleting your account takes a few steps on Kosmos+ and asks you to confirm by email.")
                .font(.footnote).foregroundColor(Palette.secondary)
        }
    }

    private func row(_ title: String, detail: String) -> some View {
        HStack {
            Text(title).foregroundColor(Palette.primary)
            Spacer()
            Text(detail).foregroundColor(Palette.secondary)
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

    private func send(_ request: URLRequest?) async -> (Int, Data) {
        guard let request else { return (0, Data()) }
        if Self.sample {
            let s = #"{"available":true,"on":true,"connected":true,"kinds":{"needsYou":true,"replied":true,"postedMention":true,"ready":true,"postedRoom":false},"offByChoice":false,"defaultBecause":null}"#
            return (200, Data(s.utf8))
        }
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        guard let (data, response) = try? await URLSession(configuration: config).data(for: request),
              let http = response as? HTTPURLResponse
        else { return (0, Data()) }
        return (http.statusCode, data)
    }

    @MainActor private func read() async {
        mac = keptMac()
        guard let mac else { load = .noComputer; return }
        if case .loaded = load {} else { load = .reading }
        let (status, data) = await send(Settings.readRequest(mac))
        if let s = Settings.phoneNotify(status: status, data: data) {
            load = .loaded(s)
            note = nil
        } else {
            load = .failed(Settings.refusal(status: status, data: data))
        }
    }

    @MainActor private func write(kind: Settings.Kind?, on: Bool) async {
        guard let mac, saving == nil else { return }
        saving = kind?.rawValue ?? "master"
        defer { saving = nil }
        let (status, data) = await send(Settings.writeRequest(mac, kind: kind, on: on))
        if let s = Settings.phoneNotify(status: status, data: data) {
            load = .loaded(s)
            note = nil
        } else {
            // Nothing changed on the computer: the switch shows what it says, and why it did not save.
            note = Settings.refusal(status: status, data: data)
        }
    }
}
