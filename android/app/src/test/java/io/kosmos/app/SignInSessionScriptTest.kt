package io.kosmos.app

import io.kosmos.app.signin.SignIn
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * kosmos#8046 slice 1 (board client): the document-start script that hands the app's session to the sign-in page's
 * own localStorage (kosmos#7042), ported from SignInLogic.swift.
 *
 * Android divergence: ios/LogicTests/main.swift verifies this by EXECUTING the script in a JSContext; JDK 21 has no
 * Nashorn and this pure-JVM unit test has no JS engine, so the JSON array is hand-rolled (as base64url is) and pinned
 * by string content here, with a dedicated assertion that a quote/backslash in the token is carried as DATA (escaped
 * inside the JSON string), never spliced as script. The live behavioural round-trip (idempotent write, replace-stale,
 * storage-that-throws) is exercised in the WebView integration and the /challenge-loop, not here.
 */
class SignInSessionScriptTest {

    private val origin = "https://login.kosmosplus.com"

    @Test fun tokenGoesInAsDataNotScript() {
        // The same injection the iOS test uses: a token that tries to close the array and run its own setItem.
        val evil = """t"]; localStorage.setItem("x", "pwned"); var b = ["""
        val s = SignIn.sessionScript(evil, origin = origin)!!

        // The only special characters here are the double-quotes, so the JSON-escaped form is the token with " -> \".
        val encoded = evil.replace("\\", "\\\\").replace("\"", "\\\"")
        assertTrue("the token is a JSON string literal under a[0]", s.contains("var a = [\"$encoded\""))

        // Proof it is data, not script: the injected setItem with literal quotes must NOT appear as source.
        assertFalse("a quote in the token never becomes script", s.contains("setItem(\"x\", \"pwned\")"))
        // The token's own quotes are present only in escaped form.
        assertTrue(s.contains("\\\"x\\\""))
    }

    @Test fun scriptGuardsOriginAndUsesThePagesOwnKey() {
        val s = SignIn.sessionScript("fresh", origin = origin)!!
        assertEquals("the key signin.html restore() reads", "kosmos_session", SignIn.pageSessionKey)
        assertTrue("the key is carried as a[1], a JSON string", s.contains("\"kosmos_session\""))
        assertTrue("the origin is carried as a[2]", s.contains("\"$origin\""))
        assertTrue("runs only on the page's own origin", s.contains("if (location.origin !== a[2]) return;"))
        assertTrue(s.contains("localStorage.getItem(a[1])"))
        assertTrue("the app's session is written under the page's key", s.contains("localStorage.setItem(a[1], a[0])"))
        assertTrue("storage that throws breaks nothing on the page", s.contains("catch (e) {}"))
    }

    @Test fun noTokenDropsOnlyTheSessionsTheAppAbandoned() {
        val s = SignIn.sessionScript(null, forget = listOf("abandoned"), origin = origin)!!
        assertTrue("with no session held, a[0] is null", s.contains("var a = [null,"))
        assertTrue("the dropped session is named in a[3]", s.contains("[\"abandoned\"]"))
        assertTrue("and removed from the page only if the page still holds it", s.contains("localStorage.removeItem(a[1])"))
        assertTrue("only a session the app dropped is removed", s.contains("a[3].indexOf(v) >= 0"))
    }

    @Test fun nothingHeldAndNothingDroppedIsNoScript() {
        assertNull(SignIn.sessionScript(null, emptyList(), origin))
        assertNull("the default forget is empty", SignIn.sessionScript(null, origin = origin))
    }

    @Test fun originIsWrittenAsLocationOriginWritesIt() {
        assertEquals(origin, SignIn.pageOrigin("https://login.kosmosplus.com"))
        assertEquals("host lowercased, default port dropped", origin, SignIn.pageOrigin("https://LOGIN.kosmosplus.com:443/x?y"))
        assertEquals("a non-default port is kept", "https://login.kosmosplus.com:8443", SignIn.pageOrigin("https://login.kosmosplus.com:8443/"))
        assertNull("no scheme or host: nothing", SignIn.pageOrigin("not a url"))
    }
}
