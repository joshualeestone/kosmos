package io.kosmos.app

import io.kosmos.app.signin.SignIn
import io.kosmos.app.signin.SignIn.PasskeyFinish
import io.kosmos.app.signin.SignIn.PasskeyOffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * kosmos#8046 slice 1 (board client): passkey sign-in (kosmos#7050 slice C), ported from SignInLogic.swift and
 * mirroring ios/LogicTests/main.swift. begin's offer is taken only for the coordinator's own host; finish's
 * grant is spent only when it is a passkey grant for a real email. Pure logic; the platform passkey API is the
 * UI-side divergence.
 */
class SignInPasskeyTest {

    private val host = "login.kosmosplus.com"
    private val challenge = byteArrayOf(1, 2, 3, 250.toByte(), 251.toByte(), 252.toByte())

    private fun okOffer(
        challengeText: String = SignIn.base64url(challenge),
        rp: String? = host,
        userVerification: String? = "required",
    ): Map<String, Any?> {
        val m = HashMap<String, Any?>()
        m["challenge"] = challengeText
        if (rp != null) m["rp_id"] = rp
        m["timeout_ms"] = 300000
        if (userVerification != null) m["user_verification"] = userVerification
        return m
    }

    @Test fun passkeyOfferTakenOnlyForTheCoordinatorHost() {
        assertEquals(
            "begin's offer for the coordinator's own host is taken, the challenge decoded",
            PasskeyOffer(challenge, host),
            SignIn.passkeyOffer(200, okOffer(), host)
        )
        val bad: List<Pair<String, Map<String, Any?>?>> = listOf(
            "passkeys off (404)" to emptyMap(),
            "another host's relying party" to okOffer(rp = "kosmosplus.com"),
            "the host in another case" to okOffer(rp = "LOGIN.kosmosplus.com"),
            "a lookalike host" to okOffer(rp = "login.kosmosplus.com.evil.example"),
            "user verification not required" to okOffer(userVerification = "preferred"),
            "no challenge" to mapOf("rp_id" to host, "user_verification" to "required"),
            "an empty challenge" to okOffer(challengeText = ""),
            "no relying party" to okOffer(rp = null),
            "no user verification" to okOffer(userVerification = null),
            "a challenge that is not base64url" to okOffer(challengeText = "%%%"),
        )
        for ((why, body) in bad) {
            // "passkeys off" is the 404; every other case is a 200 whose shape is wrong.
            val status = if (why.contains("404")) 404 else 200
            assertNull("no passkey offered: $why", SignIn.passkeyOffer(status, body, host))
        }
    }

    @Test fun passkeyFinishBodyCarriesEachFieldInItsOwnSlot() {
        val body = SignIn.passkeyFinishBody(
            credentialID = byteArrayOf(9, 9), authenticatorData = byteArrayOf(1),
            clientDataJSON = "{}".toByteArray(Charsets.UTF_8), signature = byteArrayOf(2, 3),
            userHandle = "acct".toByteArray(Charsets.UTF_8), deviceID = "k1.dev"
        )
        assertEquals(SignIn.base64url(byteArrayOf(1)), body["authenticator_data"])
        assertEquals("a swap of data and signature would fail every assertion", SignIn.base64url(byteArrayOf(2, 3)), body["signature"])
        assertEquals(SignIn.base64url(byteArrayOf(9, 9)), body["credential_id"])
        assertEquals(SignIn.base64url("{}".toByteArray(Charsets.UTF_8)), body["client_data_json"])
        assertEquals(SignIn.base64url("acct".toByteArray(Charsets.UTF_8)), body["user_handle"])
        assertEquals("k1.dev", body["device_id"])

        val noHandle = SignIn.passkeyFinishBody(
            credentialID = byteArrayOf(9), authenticatorData = byteArrayOf(1), clientDataJSON = byteArrayOf(1),
            signature = byteArrayOf(1), userHandle = null, deviceID = "k1.dev"
        )
        assertNull("no user handle: none sent", noHandle["user_handle"])
    }

    @Test fun passkeyFinishSpendsOnlyAPasskeyGrant() {
        assertEquals(
            "the grant and the account's email",
            PasskeyFinish.Grant("kpk1_abc", "ada@example.com"),
            SignIn.passkeyFinish(200, mapOf("email" to "ada@example.com", "code" to "kpk1_abc"))
        )
        assertEquals(
            "a code that is not a passkey grant is not spent",
            PasskeyFinish.Refused(SignIn.passkeyWords.failed),
            SignIn.passkeyFinish(200, mapOf("email" to "ada@example.com", "code" to "ksso1_abc"))
        )
        assertEquals(
            "a grant without a usable email is not spent",
            PasskeyFinish.Refused(SignIn.passkeyWords.failed),
            SignIn.passkeyFinish(200, mapOf("email" to "not-an-email", "code" to "kpk1_abc"))
        )
        assertEquals(
            "a company that requires its own sign-in: the app's sentence",
            PasskeyFinish.Refused(SignIn.passkeyWords.company),
            SignIn.passkeyFinish(403, mapOf("error" to "your company requires signing in through its own provider", "code" to "sso_required"))
        )
        assertEquals(
            "any other refusal: the coordinator's sentence, cleaned",
            PasskeyFinish.Refused("That passkey sign-in did not work. Try again, or sign in with your email."),
            SignIn.passkeyFinish(401, mapOf("error" to "that passkey sign-in did not work. Try again, or sign in with your email"))
        )
        assertEquals(
            "no words at all: the general sentence",
            PasskeyFinish.Refused(SignIn.passkeyWords.failed),
            SignIn.passkeyFinish(500, null)
        )
    }
}
