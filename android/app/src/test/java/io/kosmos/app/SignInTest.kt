package io.kosmos.app

import io.kosmos.app.signin.InMemorySessionStore
import io.kosmos.app.signin.SessionStore
import io.kosmos.app.signin.SignIn
import io.kosmos.app.signin.SignIn.AllowRead
import io.kosmos.app.signin.SignIn.Answer
import io.kosmos.app.signin.SignIn.DeviceStatus
import io.kosmos.app.signin.SignIn.Session
import io.kosmos.app.signin.SignIn.Step
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * kosmos#8046 slice 1: the board client's framework-free sign-in input core and the session-token store
 * interface, ported from ios/Kosmos/SignInLogic.swift (SignIn) and SessionKeychain (SessionStore). Plain JVM.
 */
class SignInTest {

    @Test fun looksLikeEmail() {
        assertTrue(SignIn.looksLikeEmail("ann@kosmosplus.com"))
        assertTrue("a single-char TLD passes the loose test", SignIn.looksLikeEmail("a@b.c"))
        assertTrue("surrounding spaces are trimmed", SignIn.looksLikeEmail("  ann@work.io  "))
        assertFalse("no dot in the domain", SignIn.looksLikeEmail("ann@kosmosplus"))
        assertFalse("no @", SignIn.looksLikeEmail("ann.kosmosplus.com"))
        assertFalse("two @", SignIn.looksLikeEmail("a@b@c.com"))
        assertFalse("empty local part", SignIn.looksLikeEmail("@kosmosplus.com"))
        assertFalse("a dot at the domain start", SignIn.looksLikeEmail("a@.com"))
        assertFalse("an empty TLD", SignIn.looksLikeEmail("a@b."))
        assertFalse("an internal space", SignIn.looksLikeEmail("ann @work.io"))
    }

    @Test fun code() {
        assertEquals("123456", SignIn.code("123456"))
        assertEquals("spaces between groups are dropped", "123456", SignIn.code("123 456"))
        assertEquals("surrounding spaces too", "123456", SignIn.code("  12 34 56 "))
        assertNull("five digits is not a code", SignIn.code("12345"))
        assertNull("seven digits is not a code", SignIn.code("1234567"))
        assertNull("a letter is not a digit", SignIn.code("12345a"))
    }

    @Test fun paths() {
        assertEquals("/v1/signin/start", SignIn.startPath)
        assertEquals("/v1/signin/verify", SignIn.verifyPath)
        assertEquals("/v1/signin/second", SignIn.secondPath)
        assertEquals("/v1/account/me", SignIn.mePath)
        assertEquals(3.0, SignIn.allowPollSeconds, 1e-9)
    }

    @Test fun sessionStoreRoundTrip() {
        val store: SessionStore = InMemorySessionStore()
        assertNull("empty to start", store.load())
        store.save("KST1.abc")
        assertEquals("KST1.abc", store.load())
        store.save("KST1.def")
        assertEquals("a save replaces the token", "KST1.def", store.load())
        store.clear()
        assertNull("clear is a sign-out", store.load())
        assertEquals("an initial token is loaded", "KST1.seed", InMemorySessionStore("KST1.seed").load())
    }

    @Test fun verifyAnswers() {
        assertEquals("a session, already allowed", Answer.SignedIn(Session("t1", DeviceStatus.ACKED, "AB12", true)),
            SignIn.answer(200, mapOf("token" to "t1", "device_status" to "acked", "match_code" to "AB12", "addresses" to listOf("x.kosmosplus.com"))))
        assertEquals("an unknown status reads as still waiting, never allowed", Answer.SignedIn(Session("t1", DeviceStatus.PENDING, null, false)),
            SignIn.answer(200, mapOf("token" to "t1", "device_status" to "weird", "addresses" to emptyList<String>())))
        assertEquals("a second step", Answer.Second("sms", "c1", "+1 *** 0123"),
            SignIn.answer(200, mapOf("second" to "sms", "challenge" to "c1", "sent_to" to "+1 *** 0123")))
        assertEquals("a second step with no challenge is not guessed at", Answer.Unknown, SignIn.answer(200, mapOf("second" to "totp")))
        assertEquals("an enrol-only token is never a session", Answer.NeedsSetup("enrol-only", true),
            SignIn.answer(200, mapOf("enrol" to true, "token" to "enrol-only", "sms_available" to true)))
        assertEquals("enrol with no token is not guessed at", Answer.Unknown, SignIn.answer(200, mapOf("enrol" to true)))
        assertEquals("a refusal keeps the coordinator's sentence", Answer.Refused("That code is not right.", false),
            SignIn.answer(400, mapOf("error" to "That code is not right.", "code" to "bad_code")))
        assertEquals("a refused proof is told apart, words tidied", Answer.Refused("X.", true),
            SignIn.answer(400, mapOf("error" to "x", "code" to "device_proof_refused")))
        assertEquals("no token: unknown", Answer.Unknown, SignIn.answer(200, emptyMap()))
        assertEquals("no body: a plain refusal", Answer.Refused(null, false), SignIn.answer(500, null))
        assertEquals("terms required", Answer.NeedsTerms, SignIn.answer(400, mapOf("code" to "terms_required")))
        assertEquals("confirm's answer is the first real session", Answer.SignedIn(Session("real", DeviceStatus.PENDING, "K7Q2", true)),
            SignIn.answer(200, mapOf("ok" to true, "kind" to "totp", "token" to "real", "device_status" to "pending", "match_code" to "K7Q2", "addresses" to listOf("mini.kosmosplus.com"))))
    }

    @Test fun companyAndAllow() {
        assertTrue("a company sign-in only when required", SignIn.companySignInRequired(mapOf("ok" to true, "sso_required" to true)))
        assertFalse(SignIn.companySignInRequired(mapOf("ok" to true, "sso_url" to "https://x")))
        assertEquals("the Allow from an ok answer", AllowRead.Status(DeviceStatus.ACKED, null, false), SignIn.allowRead(200, mapOf("device_status" to "acked")))
        assertEquals("a computer connected meanwhile, and its code", AllowRead.Status(DeviceStatus.PENDING, "K7Q2", true),
            SignIn.allowRead(200, mapOf("device_status" to "pending", "match_code" to "K7Q2", "addresses" to listOf("mini.kosmosplus.com"))))
        assertEquals("a refused session ends the watch", AllowRead.Ended, SignIn.allowRead(401, mapOf("device_status" to "acked")))
        assertEquals("a server error: asked again", AllowRead.Unknown, SignIn.allowRead(503, null))
        assertEquals("no answer: asked again", AllowRead.Unknown, SignIn.allowRead(null, null))
        assertEquals("a status not known: asked again", AllowRead.Unknown, SignIn.allowRead(200, mapOf("device_status" to "new")))
    }

    @Test fun steps() {
        val s1 = Session("t", DeviceStatus.PENDING, "AB12", true)
        val pending = SignIn.next(Answer.SignedIn(s1), "e")
        assertEquals("pending: wait for the Allow", Step.Allow("AB12", true), pending.step)
        assertEquals("the session is handed over", s1, pending.session)
        assertEquals("denied at sign-in: asked again, still waiting", Step.Denied(true), SignIn.next(Answer.SignedIn(Session("t", DeviceStatus.DENIED, null, true)), "e").step)
        val setup = SignIn.next(Answer.NeedsSetup("t", false), "e")
        assertEquals("a second step to set up", Step.Setup("t", false), setup.step)
        assertNull("and still no session", setup.session)
        assertEquals("a wrong code stays on the code", Step.Code("e"), SignIn.next(Answer.Refused(null, false), "e").step)
        assertEquals("a refused key: the web page", Step.Web(SignIn.webForKey), SignIn.next(Answer.Refused(null, true), "e").step)
    }

    @Test fun messageHelpers() {
        assertEquals("a capital and a closing stop", "X.", SignIn.sentence("x"))
        assertEquals("already a sentence is left alone", "Already done.", SignIn.sentence("Already done."))
        assertEquals("other stops kept", "Hey!", SignIn.sentence("hey!"))
        assertNull(SignIn.cleanMessage(null))
        assertNull("a non-string is nothing", SignIn.cleanMessage(42))
        assertNull("blank is nothing", SignIn.cleanMessage("   "))
        assertEquals("one line, newlines joined", "one line here", SignIn.cleanMessage("one\nline here"))
        assertEquals("refusal is a one-line sentence", "Wrong code.", SignIn.refusal("wrong code"))
    }
}
