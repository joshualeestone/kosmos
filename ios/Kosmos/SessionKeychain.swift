import Foundation
import Security

// The coordinator session, kept in the Keychain so the app can register or
// unregister its APNs token on a later launch before the sign-in page has loaded
// and posted it again (#718). ThisDeviceOnly: it never migrates to
// another device through a backup, and it is readable after the first unlock so a
// launch in the background can still use it.
//
// Two items: `live` is the signed-in session, `pendingUnregister` a signed-out one
// that still owes the coordinator an unregister (see PushRegistrar).
struct SessionKeychain: SessionStore {
    static let live = SessionKeychain(account: "session")
    static let pendingUnregister = SessionKeychain(account: "pending-unregister")

    private let service = "io.kosmos.app.coordinator-session"
    let account: String

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    func load() -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    func save(_ session: String) -> Bool {
        let data = Data(session.utf8)
        let update: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(baseQuery as CFDictionary, update as CFDictionary)
        if status == errSecSuccess { return true }
        guard status == errSecItemNotFound else { return false }
        var add = baseQuery
        add.merge(update) { _, new in new }
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }

    func delete() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}
