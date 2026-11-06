package io.kosmos.app

import io.kosmos.app.signin.SignIn
import io.kosmos.app.signin.SignIn.Answer
import io.kosmos.app.signin.SignIn.DeviceStatus
import io.kosmos.app.signin.SignIn.ReviewAnswer
import io.kosmos.app.signin.SignIn.Session
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * kosmos#8046 slice 1 (board client): the App Store review door (kosmos#7357), ported from SignInLogic.swift and
 * mirroring ios/LogicTests/main.swift. The one password door, whose session still waits for the review computer's
 * Allow; a wrong password stays on the password step; an admitted review session drops the phone's device key
 * (m733), since its device is the server's own review-*.
 */
class SignInReviewTest {

    @Test fun doorAndBody() {
        assertEquals("open: a GET gets 405 (POST only)", true, SignIn.reviewDoorOpen(405))
        assertEquals("closed: answers like a path that does not exist", false, SignIn.reviewDoorOpen(404))
        assertNull("any other answer is not read as open", SignIn.reviewDoorOpen(200))
        assertNull(SignIn.reviewDoorOpen(429))
        assertNull(SignIn.reviewDoorOpen(503))

        val body = SignIn.reviewBody("review@example.com", "p", "Pixel")
        assertEquals("the review sign-in sends the email, the password and the name only", 3, body.size)
        assertEquals("review@example.com", body["email"])
        assertEquals("p", body["password"])
        assertEquals("Pixel", body["device_name"])
        assertNull("no device id: the server makes its own review device", body["device_id"])
        assertEquals("/v1/signin/review", SignIn.reviewPath)

        // Its answer is verify's: a session that waits for the computer's Allow; the server's device id is ignored.
        assertEquals(
            "an admitted review sign-in waits for the review computer's Allow, as any sign-in does",
            Answer.SignedIn(Session("t", DeviceStatus.PENDING, "K7Q2", true)),
            SignIn.answer(200, mapOf("token" to "t", "device_status" to "pending", "match_code" to "K7Q2", "addresses" to listOf("a"), "device_id" to "review-1"))
        )
    }

    @Test fun refusalsStayOnThePasswordStep() {
        assertEquals(
            "a wrong password, in Kosmos+'s words as a sentence",
            ReviewAnswer.Refused("That email and password do not match."),
            SignIn.reviewAnswer(401, mapOf("error" to "that email and password do not match"))
        )
        assertEquals(
            "the door's 429 says wait, never the code limiter's words about codes",
            ReviewAnswer.Refused(SignIn.reviewTooMany),
            SignIn.reviewAnswer(429, mapOf("error" to "too many codes asked for from this network; wait a moment and try again", "retry_after_secs" to 20))
        )
        assertEquals(
            "a 401 that is not about the password keeps its own sentence",
            ReviewAnswer.Refused("This account is being deleted."),
            SignIn.reviewAnswer(401, mapOf("error" to "this account is being deleted"))
        )
        assertEquals("a sentence that already ends is left as it is", "Done already.", SignIn.sentence("Done already."))
        assertEquals("", SignIn.sentence(""))
        assertEquals(
            "any other refusal keeps its sentence",
            ReviewAnswer.Refused("This account signs in through its company."),
            SignIn.reviewAnswer(403, mapOf("error" to "this account signs in through its company"))
        )
        assertEquals("a server error says try again", ReviewAnswer.Refused(SignIn.reviewNoAnswer), SignIn.reviewAnswer(503, emptyMap()))
        assertEquals("a bad request says try again", ReviewAnswer.Refused(SignIn.reviewNoAnswer), SignIn.reviewAnswer(400, emptyMap()))
        assertEquals("with no sentence from Kosmos+, the phone's own", ReviewAnswer.Refused(SignIn.reviewRefused), SignIn.reviewAnswer(401, emptyMap()))
        assertEquals("a 404 is the door closed since the link showed", ReviewAnswer.Closed, SignIn.reviewAnswer(404, null))
        assertEquals(
            "an admitted sign-in goes on to the Allow",
            ReviewAnswer.Answered(Answer.SignedIn(Session("t", DeviceStatus.PENDING, null, false))),
            SignIn.reviewAnswer(200, mapOf("token" to "t", "device_status" to "pending"))
        )
    }

    @Test fun admittedReviewDropsThePhoneKey() {
        assertTrue(
            "m733: an admitted review sign-in drops a key kept by an earlier code sign-in",
            SignIn.reviewDropsKey(SignIn.reviewAnswer(200, mapOf("token" to "t", "device_status" to "pending", "device_id" to "review-1")))
        )
        assertTrue(
            "and so would one going on to a second step, should the door ever ask",
            SignIn.reviewDropsKey(ReviewAnswer.Answered(Answer.Second("totp", "c", null)))
        )
        assertFalse("a wrong password keeps the key", SignIn.reviewDropsKey(SignIn.reviewAnswer(401, mapOf("error" to "that email and password do not match"))))
        assertFalse("a closed door keeps the key", SignIn.reviewDropsKey(SignIn.reviewAnswer(404, null)))
        assertFalse("an answer this cannot read keeps the key", SignIn.reviewDropsKey(SignIn.reviewAnswer(200, mapOf("nothing" to true))))
    }
}
