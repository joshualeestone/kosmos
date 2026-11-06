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

    // MARK: - Answers
    //
    // These take the response body as an already-parsed Map (the networking layer parses the JSON; this stays
    // Android-free and JVM-testable), where iOS takes JSONSerialization's `[String: Any]`. That is the one
    // Android divergence here, written per #8046.

    enum class DeviceStatus { PENDING, ACKED, DENIED;
        companion object {
            fun from(raw: String): DeviceStatus? = when (raw) {
                "pending" -> PENDING; "acked" -> ACKED; "denied" -> DENIED; else -> null
            }
        }
    }

    /** What a signed-in answer carries that the screens use. The token is the session the web bridge hands over. */
    data class Session(val token: String, val deviceStatus: DeviceStatus, val matchCode: String?, val hasComputer: Boolean)

    /** One of verify's (or second's) answers. */
    sealed interface Answer {
        data class SignedIn(val session: Session) : Answer
        /** A second step is set up: the email code opened a challenge. [sentTo] is where an SMS went. */
        data class Second(val kind: String, val challenge: String, val sentTo: String?) : Answer
        /** A second step is required and not set up yet. [token] is good only for setting the step up. */
        data class NeedsSetup(val token: String, val sms: Boolean) : Answer
        /** Refused, with the coordinator's own sentence when it sent one. [proofRefused]: the device key was refused. */
        data class Refused(val message: String?, val proofRefused: Boolean) : Answer
        /** Not an answer this screen understands (a newer coordinator): the web sign-in page takes over. */
        data object Unknown : Answer
        /** A first company sign-in makes the account, and its terms are agreed on the sign-in page. */
        data object NeedsTerms : Answer
    }

    fun answer(status: Int, body: Map<String, Any?>?): Answer {
        val b = body ?: emptyMap()
        if (status !in 200..299) {
            val code = b["code"] as? String
            if (code == "terms_required") return Answer.NeedsTerms
            return Answer.Refused(message = refusal(b["error"]), proofRefused = code == "device_proof_refused")
        }
        if (b["enrol"] as? Boolean == true) {
            val token = b["token"] as? String
            return if (token.isNullOrEmpty()) Answer.Unknown else Answer.NeedsSetup(token, sms = b["sms_available"] as? Boolean == true)
        }
        val second = b["second"] as? String
        if (!second.isNullOrEmpty()) {
            val challenge = b["challenge"] as? String
            return if (challenge.isNullOrEmpty()) Answer.Unknown else Answer.Second(second, challenge, cleanMessage(b["sent_to"]))
        }
        val token = b["token"] as? String
        if (token.isNullOrEmpty()) return Answer.Unknown
        val ds = (b["device_status"] as? String)?.let { DeviceStatus.from(it) } ?: DeviceStatus.PENDING
        val match = (b["match_code"] as? String)?.takeIf { it.isNotEmpty() }
        val hasComputer = ((b["addresses"] as? List<*>) ?: emptyList<Any?>()).isNotEmpty()
        return Answer.SignedIn(Session(token, ds, match, hasComputer))
    }

    /** start's answer: whether this address's company signs in through its own provider and requires it. */
    fun companySignInRequired(body: Map<String, Any?>?): Boolean = body?.get("sso_required") as? Boolean == true

    /** The Allow, read from GET /v1/account/me. */
    sealed interface AllowRead {
        data class Status(val deviceStatus: DeviceStatus, val matchCode: String?, val hasComputer: Boolean) : AllowRead
        /** The session itself was refused (signed out everywhere): the watch stops, as the web page's does on a 401. */
        data object Ended : AllowRead
        /** Nothing usable (no answer, a server error): asked again on the next tick. */
        data object Unknown : AllowRead
    }

    fun allowRead(status: Int?, body: Map<String, Any?>?): AllowRead {
        if (status == null) return AllowRead.Unknown
        if (status == 401) return AllowRead.Ended
        if (status !in 200..299) return AllowRead.Unknown
        val s = body?.get("device_status") as? String ?: return AllowRead.Unknown
        val known = DeviceStatus.from(s) ?: return AllowRead.Unknown
        val match = (body["match_code"] as? String)?.takeIf { it.isNotEmpty() }
        val hasComputer = ((body["addresses"] as? List<*>) ?: emptyList<Any?>()).isNotEmpty()
        return AllowRead.Status(known, match, hasComputer)
    }

    // MARK: - The screens' steps (the subset the core produces; display/setup paths add more later)

    sealed interface Step {
        data class Allow(val matchCode: String?, val hasComputer: Boolean) : Step
        /** The Mac said no. [asking] true while Kosmos+ has made a fresh Allow, so the screen still waits. */
        data class Denied(val asking: Boolean) : Step
        data class Setup(val token: String, val sms: Boolean) : Step
        data class Second(val email: String, val kind: String, val challenge: String, val sentTo: String?) : Step
        data class Code(val email: String) : Step
        /** Over to the web sign-in page, with why (one line the screen shows first). */
        data class Web(val reason: String) : Step
        data object Done : Step
    }

    data class Next(val step: Step, val session: Session?, val error: String?)

    /** The step a verify or second answer leads to, and the session to hand over when there is one. */
    fun next(after: Answer, email: String): Next = when (after) {
        is Answer.SignedIn -> when (after.session.deviceStatus) {
            DeviceStatus.ACKED -> Next(Step.Done, after.session, null)
            DeviceStatus.DENIED -> Next(Step.Denied(asking = true), after.session, null)
            DeviceStatus.PENDING -> Next(Step.Allow(after.session.matchCode, after.session.hasComputer), after.session, null)
        }
        is Answer.Second -> Next(Step.Second(email, after.kind, after.challenge, after.sentTo), null, null)
        is Answer.NeedsSetup -> Next(Step.Setup(after.token, after.sms), null, null)
        is Answer.Refused -> if (after.proofRefused) Next(Step.Web(webForKey), null, null)
            else Next(Step.Code(email), null, after.message ?: "That code is not right or has expired.")
        Answer.Unknown -> Next(Step.Web(webForUnknown), null, null)
        Answer.NeedsTerms -> Next(Step.Web(webForTerms), null, null)
    }

    const val webForKey = "This phone could not prove its key to Kosmos+, so this continues on the sign-in page."
    const val webForTerms = "Your company's sign-in will make your Kosmos+ account, and that starts with agreeing to its terms on the sign-in page."
    const val webForUnknown = "Kosmos+ answered in a way this app does not know yet, so this continues on the sign-in page."

    // MARK: - Message helpers

    /** Kosmos+'s refusal as a sentence on screen: one line (cleanMessage), then a capital and a closing stop. */
    fun refusal(value: Any?): String? = cleanMessage(value)?.let { sentence(it) }

    /** The coordinator's sentence, kept short and on one line; null when it sent none. */
    fun cleanMessage(value: Any?): String? {
        val s = value as? String ?: return null
        val one = s.split("\n", "\r").joinToString(" ").trim()
        if (one.isEmpty()) return null
        return if (one.length > 200) one.substring(0, 200) else one
    }

    /** A capital first letter and a closing stop. */
    fun sentence(s: String): String {
        if (s.isEmpty()) return s
        val capital = s.first().uppercase() + s.substring(1)
        return if (capital.last() in ".!?") capital else "$capital."
    }
}
