package io.kosmos.app.signin

import java.net.URI
import java.security.MessageDigest

/**
 * kosmos#8046 slice 1 (board client): the native sign-in core, framework-free (no Android types) so a plain
 * JVM test proves it, ported from ios/Kosmos/SignInLogic.swift (Kosmos+'s phone sign-in: POST
 * /v1/signin/start, /v1/signin/verify, /v1/signin/second, and GET /v1/account/me for the Allow).
 *
 * This holds the route paths, the input validation a person's typing is checked against, the request/answer
 * model (Answer / answer(status, body)), the step machine (next), and the device-proof encoding: base64url,
 * the device id, the message a device signs, and the verify body. The signing KEY itself is held behind the
 * DeviceKey interface so the hardware-backed implementation (Android Keystore EC P-256) stays isolated and
 * reviewable on its own; the software key used by the tests is in DeviceKeyCrypto.kt. The proof here is
 * pinned by content to the coordinator's own WebCrypto vector (devkey.rs), the same vector the iOS suite uses.
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

    // MARK: - The device's proof (kosmos#5422)
    //
    // base64url is hand-rolled, not java.util.Base64: that type is API 26, and this app's minSdk is 24, so on
    // an API 24/25 device java.util.Base64 would not be there. Hand-rolled it is also framework-free, so the
    // plain JVM test runs it, and it is pinned by content to the coordinator's WebCrypto vector. (Android
    // divergence from iOS, which uses Foundation's Data base64, written per #8046.)

    private const val B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

    /** base64url with no padding, the coordinator's written form. */
    fun base64url(data: ByteArray): String {
        val out = StringBuilder((data.size + 2) / 3 * 4)
        var i = 0
        while (i < data.size) {
            val b0 = data[i].toInt() and 0xFF
            val b1 = if (i + 1 < data.size) data[i + 1].toInt() and 0xFF else 0
            val b2 = if (i + 2 < data.size) data[i + 2].toInt() and 0xFF else 0
            val chunk = (b0 shl 16) or (b1 shl 8) or b2
            out.append(B64URL[(chunk shr 18) and 0x3F])
            out.append(B64URL[(chunk shr 12) and 0x3F])
            if (i + 1 < data.size) out.append(B64URL[(chunk shr 6) and 0x3F])
            if (i + 2 < data.size) out.append(B64URL[chunk and 0x3F])
            i += 3
        }
        return out.toString()
    }

    /** Reads base64url back. Tolerant of padding and of the standard `+`/`/` alphabet; null on any other char. */
    fun fromBase64url(text: String): ByteArray? {
        val out = ArrayList<Byte>(text.length * 3 / 4)
        var buffer = 0
        var bits = 0
        for (c in text) {
            if (c == '=') continue
            val v = when (c) {
                in 'A'..'Z' -> c - 'A'
                in 'a'..'z' -> c - 'a' + 26
                in '0'..'9' -> c - '0' + 52
                '-', '+' -> 62
                '_', '/' -> 63
                else -> return null
            }
            buffer = (buffer shl 6) or v
            bits += 6
            if (bits >= 8) {
                bits -= 8
                out.add(((buffer shr bits) and 0xFF).toByte())
            }
        }
        return out.toByteArray()
    }

    /**
     * The coordinator's device id for a public key (devkey.rs derive_id): "k1." and the first 32 characters of
     * the base64url SHA-256 of the key's SPKI DER.
     */
    fun deviceID(spki: ByteArray): String =
        "k1." + base64url(MessageDigest.getInstance("SHA-256").digest(spki)).take(32)

    /** What a device signs (devkey.rs message): one field per line. `email` exactly as the request carries it. */
    fun proofMessage(door: String = "signin", email: String, code: String, deviceID: String): ByteArray =
        "kosmos-device-v1\n$door\n$email\n$code\n$deviceID".toByteArray(Charsets.UTF_8)

    /**
     * A key that can sign the proof: the app's Android Keystore key on a device, a software key in the tests.
     * [spki] is the public key as SPKI DER; [sign] gives ECDSA P-256 SHA-256 as raw r||s (64 bytes), the form
     * the coordinator checks. The concrete implementations live in their own files so the hardware-backed one
     * is isolated: DeviceKeyCrypto.kt (software, used by the tests) and KeystoreDeviceKey.kt (device, a
     * following increment).
     */
    interface DeviceKey {
        val spki: ByteArray
        fun sign(message: ByteArray): ByteArray
        val id: String get() = SignIn.deviceID(spki)
    }

    // MARK: - Request bodies

    fun startBody(email: String, deviceID: String, deviceName: String): Map<String, Any> =
        mapOf("email" to email, "device_id" to deviceID, "device_name" to deviceName)

    /**
     * The verify body, with the proof. The email goes exactly as signed: the coordinator checks the proof over
     * the email as sent, before it normalises it.
     */
    fun verifyBody(email: String, code: String, deviceName: String, key: DeviceKey): Map<String, Any> {
        val sig = key.sign(proofMessage(email = email, code = code, deviceID = key.id))
        return mapOf(
            "email" to email, "device_id" to key.id, "device_name" to deviceName, "code" to code,
            "device_key" to base64url(key.spki), "device_sig" to base64url(sig)
        )
    }

    fun secondBody(challenge: String, code: String): Map<String, Any> =
        mapOf("challenge" to challenge, "code" to code)

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

    // MARK: - A company's own sign-in (kosmos#7045)
    //
    // On the phone this happens in the system sign-in sheet (Android CredentialManager / a Custom Tab, where
    // iOS uses ASWebAuthenticationSession); that chrome is the UI-side divergence. The logic here is pure: which
    // address is safe to open, and what the return carries. The coordinator is passed as its origin string
    // ("https://host[:port]", no trailing slash, no default port), as location.origin writes it.

    /** Where a company sign-in returns on the coordinator (sso.rs callback): its own /signin, the grant in the fragment. */
    const val returnPath = "/signin"

    /** What a company sign-in's grant starts with (sso.rs GRANT_PREFIX); spent at verify in place of the code. */
    const val grantPrefix = "ksso1_"

    /**
     * start's company sign-in address (`sso_url`) as the page to open, only Kosmos+'s own begin path on the
     * coordinator. Kept byte for byte: rebuilding the query would decode `%2B` in an address like ann+work@ to a
     * `+`, which the server reads as a space. The `/v1/sso/begin?` prefix is what rejects an absolute or `//host`
     * address, so no address anywhere else is ever opened.
     */
    fun companySignInURL(body: Map<String, Any?>?, coordinatorOrigin: String): String? {
        val ssoUrl = body?.get("sso_url") as? String ?: return null
        if (!ssoUrl.startsWith("/v1/sso/begin?") || ssoUrl.contains("#")) return null
        return coordinatorOrigin.trimEnd('/') + ssoUrl
    }

    /** What the sign-in sheet brought back. */
    sealed interface CompanyReturn {
        /** The grant, and the email the provider vouched for (sign in with exactly this one). */
        data class Grant(val grant: String, val email: String) : CompanyReturn
        /** The coordinator's one-word refusal, already in the page's sentence. */
        data class Refused(val message: String) : CompanyReturn
    }

    /**
     * Only Kosmos+'s own /signin on the coordinator (https, exact host/port, the path), the grant in the fragment,
     * a refusal in the query. Null for anything else: nothing is guessed.
     */
    fun companyReturn(url: String, coordinatorOrigin: String): CompanyReturn? {
        val u = try { URI(url) } catch (_: Exception) { return null }
        val co = try { URI(coordinatorOrigin) } catch (_: Exception) { return null }
        if (u.scheme?.lowercase() != "https") return null
        if (!u.host.equals(co.host, ignoreCase = true)) return null
        if (u.port != co.port) return null
        if (u.path != returnPath) return null
        val query = queryPairs(u.rawQuery)
        query["sso_error"]?.let { return CompanyReturn.Refused(companyWords[it] ?: companyWords.getValue("failed")) }
        val fragment = queryPairs(u.rawFragment)
        val grant = fragment["sso_grant"]
        val email = fragment["email"]
        if (grant != null && grant.startsWith(grantPrefix) && email != null && looksLikeEmail(email)) {
            return CompanyReturn.Grant(grant, email)
        }
        return null
    }

    /** The page's sentences for each refusal (signin.html ssoReturn SSO_WORDS), word for word. */
    val companyWords: Map<String, String> = mapOf(
        "cancelled" to "You did not finish signing in with your company's account. Try again, or use your email code.",
        "expired" to "That company sign-in took too long or was already used. Try again.",
        "not_provisioned" to "Your company has not given you access to Kosmos+. Ask the people who run your company's accounts.",
        "not_member" to "Your company's sign-in vouched for this address, but it is not a member of that company in Kosmos+. Sign in with your email code.",
        "wrong_person" to "Your company's sign-in said you are someone else. Sign in again with the account for this address.",
        "unavailable" to "Your company's sign-in is turned off right now. Sign in with your email code.",
        "failed" to "Signing in with your company's account did not work. Try again, or use your email code.",
    )

    // Splits an &-joined key=value string, percent-decoding the VALUE only (the key is left raw), as iOS's
    // removingPercentEncoding does. A pair whose value will not decode is dropped. `+` is left as `+`.
    private fun queryPairs(raw: String?): Map<String, String> {
        val out = HashMap<String, String>()
        for (kv in (raw ?: "").split("&")) {
            if (kv.isEmpty()) continue
            val eq = kv.indexOf('=')
            if (eq < 0) continue
            val value = percentDecode(kv.substring(eq + 1)) ?: continue
            out[kv.substring(0, eq)] = value
        }
        return out
    }

    private fun percentDecode(s: String): String? {
        val bytes = java.io.ByteArrayOutputStream()
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (c == '%') {
                if (i + 2 >= s.length) return null
                val b = s.substring(i + 1, i + 3).toIntOrNull(16) ?: return null
                bytes.write(b)
                i += 3
            } else {
                for (bb in c.toString().toByteArray(Charsets.UTF_8)) bytes.write(bb.toInt())
                i++
            }
        }
        return bytes.toString("UTF-8")
    }
}
