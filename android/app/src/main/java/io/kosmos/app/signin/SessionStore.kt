package io.kosmos.app.signin

/**
 * kosmos#8046 slice 1 (board client): the board session token store, kept behind an interface (Liu Kang
 * 2026-11-06) so the Android Keystore / EncryptedSharedPreferences implementation is isolated and can be
 * reviewed on its own. The iOS analog is SessionKeychain. All sign-in / board-client logic depends only on
 * this interface, never on the concrete store.
 */
interface SessionStore {
    /** The saved board session token, or null if none is stored. */
    fun load(): String?

    /** Replace the saved token with [token]. */
    fun save(token: String)

    /** Forget the saved token (a sign-out). */
    fun clear()
}

/**
 * An in-memory store for tests and previews. The real, hardware-backed store (KeystoreSessionStore, built on
 * EncryptedSharedPreferences / the Android Keystore) is a SEPARATE, isolated implementation added in a
 * following increment, so the security-sensitive code lands and reviews on its own.
 */
class InMemorySessionStore(initial: String? = null) : SessionStore {
    private var token: String? = initial
    override fun load(): String? = token
    override fun save(token: String) { this.token = token }
    override fun clear() { token = null }
}
