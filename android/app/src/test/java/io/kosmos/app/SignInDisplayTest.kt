package io.kosmos.app

import io.kosmos.app.signin.SignIn
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * kosmos#8046 slice 1 (board client): the words the second-step screen and the web hand-over show, ported from
 * SignInLogic.swift and mirroring ios/LogicTests/main.swift. A masked number stays whole on one line (non-breaking
 * spaces), an address wraps only after its @ or a dot (zero-width spaces, no inserted hyphen), and each hand-over
 * title names what happens next. Pure text shaping.
 */
class SignInDisplayTest {

    private val nbsp = " "
    private val zwsp = "​"

    @Test fun secondStepWordsNameTheStep() {
        assertTrue("a text goes to the phone", SignIn.secondWords("sms", null).contains("your phone"))
        assertTrue("an authenticator step says so", SignIn.secondWords("totp", null).contains("authenticator"))
    }

    @Test fun maskedNumberStaysWholeOnOneLine() {
        val line = SignIn.secondWords("sms", "+1 *** *** 0123")
        assertTrue(
            "its spaces are non-breaking, so the number never wraps",
            line.contains("+1$nbsp***$nbsp***${nbsp}0123")
        )
        assertFalse("no ordinary space survives inside the number", line.contains("*** ***"))
    }

    @Test fun addressBreaksOnlyAfterAtOrDot() {
        assertEquals("ada@${zwsp}example.${zwsp}com", SignIn.wrappable("ada@example.com"))
        assertEquals(
            "the breaks are zero-width, so the address reads unchanged",
            "ada@example.com",
            SignIn.wrappable("ada@example.com").replace(zwsp, "")
        )
        assertFalse("never an inserted hyphen", SignIn.wrappable("ada@example.com").contains("-"))
    }

    @Test fun handoverTitlesSayWhatHappensNext() {
        assertEquals("Your company signs you in", SignIn.webTitle(SignIn.webForCompany))
        assertEquals("Finish signing in on the next page", SignIn.webTitle(SignIn.webForSetup))
        assertFalse("no title carries a hyphen to break at", SignIn.webTitle(SignIn.webForSetup).contains("-"))
    }
}
