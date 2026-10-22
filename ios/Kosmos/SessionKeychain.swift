import Foundation
import Security

// The coordinator session, kept in the Keychain so the app can register or
// unregister its APNs token on a later launch before the sign-in page has loaded
// and posted it again (#718). ThisDeviceOnly: it never migrates to
// another device through a backup, and it is readable after the first unlock so a
// launch in the background can still use it.
//
// Three items: `live` is the signed-in session, `pendingUnregister` a signed-out one
// that still owes the coordinator an unregister (see PushRegistrar), and `macSession`
// the Mac's session cookie for the native Agents tab (kosmos#6838, BoardClient).
struct SessionKeychain: SessionStore {
    static let live = SessionKeychain(account: "session")
    static let pendingUnregister = SessionKeychain(account: "pending-unregister")
    // kosmos#6838: the Mac's session for the native Agents tab (Board.SavedMacSession, as JSON). kosmos#6487: kept in
    // the keychain group the app shares with its Notification Service Extension (KosmosNotice), which uses it to ask
    // that Mac for a notification's words.
    static let macSession = SessionKeychain(account: "mac-session", shared: true)

    private let service = "io.kosmos.app.coordinator-session"
    let account: String
    // kosmos#6487: kept in the shared group (Info.plist KosmosSharedKeychainGroup, from the entitlements' first
    // keychain-access-groups entry). Nil in a build with no signing team, where the group has no team prefix.
    private let group: String?

    init(account: String, shared: Bool = false) {
        self.account = account
        let named = shared ? Bundle.main.object(forInfoDictionaryKey: "KosmosSharedKeychainGroup") as? String : nil
        group = Self.usableGroup(named)
    }

    // A keychain group this build can hold: "<10-character team id>.<rest>". An unsigned build expands
    // $(AppIdentifierPrefix) to nothing, so its group reads "io.kosmos.app.shared" and is not one. The extension makes
    // the same check (KosmosNotice/NoticeLogic.swift hasTeamPrefix); ios/LogicTests runs both on the same cases.
    static func usableGroup(_ named: String?) -> String? {
        guard let named else { return nil }
        let parts = named.split(separator: ".", maxSplits: 1)
        guard parts.count == 2, parts[0].count == 10, !parts[1].isEmpty,
              parts[0].unicodeScalars.allSatisfy({ ("A"..."Z").contains($0) || ("0"..."9").contains($0) })
        else { return nil }
        return named
    }

    // Without a group: matches the item in whichever group holds it (the app's own, before kosmos#6487, or the shared one).
    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    private func read(_ query: [String: Any]) -> String? {
        var query = query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func load() -> String? {
        guard let group else { return read(baseQuery) }
        var inGroup = baseQuery
        inGroup[kSecAttrAccessGroup as String] = group
        if let kept = read(inGroup) { return kept }
        // kosmos#6487: kept before the shared group existed. Moved there once, so the extension can read it.
        guard let older = read(baseQuery) else { return nil }
        SecItemDelete(baseQuery as CFDictionary)
        if !save(older) { _ = add(older, group: nil) }   // never lose the session over the move
        return older
    }

    private func add(_ session: String, group: String?) -> Bool {
        var add = baseQuery
        if let group { add[kSecAttrAccessGroup as String] = group }
        add[kSecValueData as String] = Data(session.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }

    @discardableResult
    func save(_ session: String) -> Bool {
        let update: [String: Any] = [
            kSecValueData as String: Data(session.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        var query = baseQuery
        if let group { query[kSecAttrAccessGroup as String] = group }
        let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecSuccess { return true }
        guard status == errSecItemNotFound else { return false }
        // A shared group this build cannot write (an entitlement missing from the signature) still keeps the session.
        return add(session, group: group) || (group != nil && add(session, group: nil))
    }

    func delete() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}
