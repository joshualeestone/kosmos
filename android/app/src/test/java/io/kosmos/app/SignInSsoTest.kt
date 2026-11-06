package io.kosmos.app

import io.kosmos.app.signin.SignIn
import io.kosmos.app.signin.SignIn.CompanyReturn
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * kosmos#8046 slice 1 (board client): a company's own sign-in (kosmos#7045), ported from SignInLogic.swift and
 * mirroring ios/LogicTests/main.swift. Which begin address is safe to open, and what the return carries, pure
 * logic. The coordinator is its origin string, as location.origin writes it.
 */
class SignInSsoTest {

    private val coordinator = "https://login.kosmosplus.com"
    private fun body(sso: String?) = if (sso == null) mapOf("ok" to true) else mapOf("ok" to true, "sso_url" to sso)
    private fun ret(url: String) = SignIn.companyReturn(url, coordinator)

    @Test fun companySignInUrlOpensOnlyKosmosBegin() {
        assertEquals(
            "Kosmos+'s begin address, on the coordinator, as given",
            "https://login.kosmosplus.com/v1/sso/begin?email=ann%40acme.test&device_id=k1.abc",
            SignIn.companySignInURL(body("/v1/sso/begin?email=ann%40acme.test&device_id=k1.abc"), coordinator)
        )
        assertEquals(
            "an address with a + is kept exactly as Kosmos+ encoded it (never decoded to a space)",
            "https://login.kosmosplus.com/v1/sso/begin?email=ann%2Bwork%40acme.test&device_id=k1.abc",
            SignIn.companySignInURL(body("/v1/sso/begin?email=ann%2Bwork%40acme.test&device_id=k1.abc"), coordinator)
        )
        val bad = listOf(
            "https://evil.example/v1/sso/begin?x",   // an absolute address elsewhere
            "//evil.example/v1/sso/begin?x",         // a scheme-relative host
            "/v1/other?x",                           // not the begin path
            "/v1/sso/begin?x#y",                     // carries a fragment
        )
        for (b in bad) assertNull("not opened: $b", SignIn.companySignInURL(body(b), coordinator))
        assertNull("no sso_url", SignIn.companySignInURL(body(null), coordinator))
        assertNull("sso_url not a string", SignIn.companySignInURL(mapOf("sso_url" to 7), coordinator))
    }

    @Test fun companyReturnTakesOnlyKosmosGrantOrRefusal() {
        assertEquals(
            "the grant and the vouched email, from Kosmos+'s own /signin",
            CompanyReturn.Grant("ksso1_abc", "ann@acme.test"),
            ret("https://login.kosmosplus.com/signin#sso_grant=ksso1_abc&email=ann%40acme.test")
        )
        assertEquals(
            "a refusal, in the page's sentence",
            CompanyReturn.Refused(SignIn.companyWords.getValue("not_member")),
            ret("https://login.kosmosplus.com/signin?sso_error=not_member")
        )
        assertEquals(
            "a word not known: the general sentence",
            CompanyReturn.Refused(SignIn.companyWords.getValue("failed")),
            ret("https://login.kosmosplus.com/signin?sso_error=whatever")
        )
        val bad = listOf(
            "https://login.kosmosplus.com/signin#sso_grant=abc&email=ann%40acme.test",      // grant without the prefix
            "https://login.kosmosplus.com/signin#sso_grant=ksso1_abc",                      // no email
            "https://evil.example/signin#sso_grant=ksso1_abc&email=a%40b.co",               // another host
            "https://login.kosmosplus.com/other#sso_grant=ksso1_abc&email=a%40b.co",        // another path
            "http://login.kosmosplus.com/signin#sso_grant=ksso1_abc&email=a%40b.co",        // not https
            "kosmos-signin://sso#sso_grant=ksso1_abc&email=a%40b.co",                        // a custom scheme
            "https://login.kosmosplus.com/signin#sso_grant=ksso1_abc&email=not-an-email",   // not an email
        )
        for (b in bad) assertNull("nothing taken from $b", ret(b))
    }

    @Test fun firstCompanySignInNeedsTerms() {
        // terms_required is read as NeedsTerms, and the step machine hands over to the web page's terms.
        assertEquals(SignIn.Answer.NeedsTerms, SignIn.answer(400, mapOf("error" to "agree first", "code" to "terms_required")))
        assertEquals(SignIn.Step.Web(SignIn.webForTerms), SignIn.next(SignIn.Answer.NeedsTerms, "e").step)
    }
}
