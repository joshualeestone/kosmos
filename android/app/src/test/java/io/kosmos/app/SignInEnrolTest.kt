package io.kosmos.app

import io.kosmos.app.signin.SignIn
import io.kosmos.app.signin.SignIn.Enrolled
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * kosmos#8046 slice 1 (board client): setting up a required second step (kosmos#7046), ported from SignInLogic.swift
 * and mirroring ios/LogicTests/main.swift. This app sets up an authenticator (totp); only an otpauth://totp/ link
 * with a secret is taken. A refusal that says start again, or that the account is gone, sends the person back to
 * the email; a wrong code stays on the setup screen. Pure logic.
 */
class SignInEnrolTest {

    @Test fun enrolTakesOnlyAnAuthenticatorLink() {
        assertEquals(
            "the authenticator's link and secret",
            Enrolled.Totp("otpauth://totp/Kosmos:a%40b.co?secret=ABCD", "ABCDEFGHIJ"),
            SignIn.enrolled(200, mapOf("kind" to "totp", "otpauth" to "otpauth://totp/Kosmos:a%40b.co?secret=ABCD", "secret" to "ABCDEFGHIJ"))
        )
        assertEquals(
            "not an otpauth://totp/ link: refused",
            Enrolled.Refused("That did not work. Try again."),
            SignIn.enrolled(200, mapOf("kind" to "totp", "otpauth" to "https://evil.example/?secret=ABCD", "secret" to "ABCD"))
        )
        assertEquals(
            "texts are set up on the web, not here",
            Enrolled.Refused("That did not work. Try again."),
            SignIn.enrolled(200, mapOf("kind" to "sms", "sent_to" to "x"))
        )
        assertEquals(
            "an empty secret is not a setup",
            Enrolled.Refused("That did not work. Try again."),
            SignIn.enrolled(200, mapOf("kind" to "totp", "otpauth" to "otpauth://totp/Kosmos:a%40b.co?secret=", "secret" to ""))
        )
        assertEquals(
            "a refusal keeps the coordinator's sentence",
            Enrolled.Refused("Too many tries; wait a minute."),
            SignIn.enrolled(429, mapOf("error" to "Too many tries; wait a minute."))
        )
        assertEquals(
            "a refusal with no sentence gets the app's own",
            Enrolled.Refused("That did not work. Try again."),
            SignIn.enrolled(500, null)
        )
    }

    @Test fun secretReadsInGroupsOfFour() {
        assertEquals("ABCD EFGH IJ", SignIn.grouped("ABCDEFGHIJ"))
        assertEquals("ABCD", SignIn.grouped("ABCD"))
        assertEquals("", SignIn.grouped(""))
    }

    @Test fun setupRequestsCarryOnlyTheirOneField() {
        assertEquals("totp", SignIn.enrolBody()["kind"])
        assertEquals(1, SignIn.enrolBody().size)
        assertEquals("123456", SignIn.confirmBody("123456")["code"])
        assertEquals("the confirm sends only the code", 1, SignIn.confirmBody("1").size)
    }

    @Test fun onlyAStartAgainOrGoneAccountLeavesTheScreen() {
        assertTrue(SignIn.startsOver("token invalid or expired; start again from the email"))
        assertTrue("case does not matter", SignIn.startsOver("nothing is being enrolled; Start again"))
        assertTrue(SignIn.startsOver("no such account"))
        assertTrue(SignIn.startsOver("this Kosmos+ account no longer exists"))
        assertTrue(SignIn.startsOver("this account signed out everywhere since; sign in again"))
        assertTrue(SignIn.startsOver("this account is being deleted"))
        assertFalse("a wrong texted code stays", SignIn.startsOver("that code is not the one we texted"))
        assertFalse(
            "a wrong authenticator code stays",
            SignIn.startsOver("that code is not what the app shows right now; wait for the next one and try again")
        )
        assertFalse("no sentence at all stays", SignIn.startsOver(null))
    }
}
