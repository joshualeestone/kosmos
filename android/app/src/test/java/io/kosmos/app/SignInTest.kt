package io.kosmos.app

import io.kosmos.app.signin.InMemorySessionStore
import io.kosmos.app.signin.SessionStore
import io.kosmos.app.signin.SignIn
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
}
