package io.kosmos.app.signin

/**
 * kosmos#8046 slice 1 (board client): the native sign-in core, framework-free (no Android types) so a plain
 * JVM test proves it, ported from ios/Kosmos/SignInLogic.swift (Kosmos+'s phone sign-in: POST
 * /v1/signin/start, /v1/signin/verify, /v1/signin/second, and GET /v1/account/me for the Allow).
 *
 * This first slice is the route paths + the input validation a person's typing is checked against. The
 * request/answer model (Answer / answer(status, body)), the step machine (next), and the device-proof
 * CRYPTO (behind a DeviceKey interface, with the Android Keystore-backed signing isolated for review) are
 * the focused following increments, because the proof and the token store are the highest-risk parts.
 */
object SignIn {
    const val startPath = "/v1/signin/start"
    const val verifyPath = "/v1/signin/verify"
    const val secondPath = "/v1/signin/second"
    const val mePath = "/v1/account/me"

    /** How often the Allow is asked about while it is pending: the web sign-in page's own interval. */
    const val allowPollSeconds = 3.0

    /**
     * The coordinator's own test, loosely: something@something.something, with no spaces. The coordinator
     * decides for real; this only keeps an obvious typo from costing a round trip.
     */
    fun looksLikeEmail(raw: String): Boolean {
        val email = raw.trim()
        if (email.any { it.isWhitespace() }) return false
        if (email.count { it == '@' } != 1) return false
        val at = email.indexOf('@')
        val local = email.substring(0, at)
        val domain = email.substring(at + 1)
        if (local.isEmpty()) return false
        val dot = domain.lastIndexOf('.')
        if (dot <= 0) return false            // no dot, or a dot at the domain's start
        return dot < domain.length - 1        // a non-empty TLD after the last dot
    }

    /** A six-digit code, as the web page checks before sending (spaces a person types between groups dropped). */
    fun code(raw: String): String? {
        val digits = raw.filterNot { it.isWhitespace() }
        return if (digits.length == 6 && digits.all { it in '0'..'9' }) digits else null
    }
}
