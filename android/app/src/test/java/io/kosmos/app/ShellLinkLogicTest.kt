package io.kosmos.app

import io.kosmos.app.shell.ShellLink
import io.kosmos.app.shell.ShellLink.LinkDecision
import io.kosmos.app.shell.ShellLink.Origin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * kosmos#8046 slice 1: where a link goes, ported from the Shell.linkDecision / isOurs / allowsSubframe
 * cases in ios/LogicTests/main.swift. Plain JVM: ShellLink has no Android types.
 */
class ShellLinkLogicTest {

    private val coordinator = "https://login.kosmosplus.com"

    private fun link(url: String, origin: Origin = Origin.TAPPED): LinkDecision =
        ShellLink.linkDecision(url, coordinator, origin)

    @Test fun oursLoadsInApp() {
        assertEquals("the coordinator: in the app", LinkDecision.IN_APP, link("https://login.kosmosplus.com/signin"))
        assertEquals("a Mac's board: in the app", LinkDecision.IN_APP, link("https://hers.kosmosplus.com/?tab=detail&agent=leo"))
        assertEquals("uppercase scheme and host: still the coordinator", LinkDecision.IN_APP, link("HTTPS://LOGIN.KOSMOSPLUS.COM/signin"))
        assertEquals("a new window to a Mac: in the one WebView", LinkDecision.IN_APP, link("https://hers.kosmosplus.com/", Origin.NEW_WINDOW))
    }

    @Test fun otherSitesGoToBrowser() {
        assertEquals("tapped: Stripe billing to the browser", LinkDecision.EXTERNAL, link("https://billing.stripe.com/p/session/x"))
        assertEquals("a new window to Stripe: browser", LinkDecision.EXTERNAL, link("https://billing.stripe.com/p/session/x", Origin.NEW_WINDOW))
        assertEquals("a redirect/script to another site: browser", LinkDecision.EXTERNAL, link("https://checkout.stripe.com/c/pay/x", Origin.PAGE_FLOW))
        assertEquals("the marketing site: browser (not a Mac, not the coordinator)", LinkDecision.EXTERNAL, link("https://kosmosplus.com/help"))
        assertEquals("another site: browser", LinkDecision.EXTERNAL, link("https://evil.example.com/"))
        assertEquals("a lookalike of the coordinator: browser", LinkDecision.EXTERNAL, link("https://login.kosmosplus.com.evil.example/"))
        assertEquals("two labels deep is not a Mac", LinkDecision.EXTERNAL, link("https://a.b.kosmosplus.com/"))
        assertEquals("tapped on OUR page, another site: browser", LinkDecision.EXTERNAL, link("https://accounts.example-idp.com/other", Origin.TAPPED))
        assertEquals("a new window to another site: browser", LinkDecision.EXTERNAL, link("https://terms.example.org/tos", Origin.NEW_WINDOW))
    }

    @Test fun plainHttp() {
        assertEquals("tapped plain http, even to Kosmos+: browser", LinkDecision.EXTERNAL, link("http://login.kosmosplus.com/"))
        assertEquals("a redirect to plain http: refused", LinkDecision.BLOCK, link("http://login.kosmosplus.com/", Origin.PAGE_FLOW))
        assertEquals("plain http tapped to a third party: browser", LinkDecision.EXTERNAL, link("http://accounts.example-idp.com/", Origin.TAPPED))
        assertEquals("a redirect to a third-party plain http page: refused", LinkDecision.BLOCK, link("http://evil.example.com/", Origin.PAGE_FLOW))
    }

    @Test fun appSchemes() {
        assertEquals("mail: the Mail app", LinkDecision.EXTERNAL, link("mailto:help@kosmosplus.com"))
        assertEquals("phone: the Phone app", LinkDecision.EXTERNAL, link("tel:+12145551234"))
        assertEquals("text: the Messages app", LinkDecision.EXTERNAL, link("sms:+12145551234"))
        assertEquals("a script cannot open Mail", LinkDecision.BLOCK, link("mailto:x@y.z", Origin.PAGE_FLOW))
        assertEquals("a script cannot open Phone", LinkDecision.BLOCK, link("tel:+1", Origin.PAGE_FLOW))
        assertEquals("a script cannot open Messages", LinkDecision.BLOCK, link("sms:+1", Origin.PAGE_FLOW))
        assertEquals("a new window to tel the person asked: Phone", LinkDecision.EXTERNAL, link("tel:+1", Origin.NEW_WINDOW))
    }

    @Test fun refusedSchemes() {
        assertEquals("javascript: refused", LinkDecision.BLOCK, link("javascript:alert(1)"))
        assertEquals("javascript: refused in a flow too", LinkDecision.BLOCK, link("javascript:alert(1)", Origin.PAGE_FLOW))
        assertEquals("file: refused", LinkDecision.BLOCK, link("file:///etc/passwd"))
        assertEquals("data: refused", LinkDecision.BLOCK, link("data:text/html,hi"))
        assertEquals("blob: refused", LinkDecision.BLOCK, link("blob:https://hers.kosmosplus.com/1234"))
        assertEquals("a custom scheme: refused", LinkDecision.BLOCK, link("kosmos://open"))
        assertEquals("about:blank for the page's own use: allowed", LinkDecision.IN_APP, link("about:blank", Origin.PAGE_FLOW))
        assertEquals("about:blank as a new window: refused", LinkDecision.BLOCK, link("about:blank", Origin.NEW_WINDOW))
        assertEquals("other about: pages refused", LinkDecision.BLOCK, link("about:srcdoc"))
    }

    @Test fun isOursPortAndUserRules() {
        assertTrue("an explicit :443 on the coordinator: still ours", ShellLink.isOurs("https://login.kosmosplus.com:443/", coordinator))
        assertFalse("a Mac host with a port is not ours", ShellLink.isOurs("https://hers.kosmosplus.com:8443/", coordinator))
        assertFalse("the coordinator with a user part is not ours", ShellLink.isOurs("https://x@login.kosmosplus.com/", coordinator))
        assertTrue("a coordinator on a port: its own port is ours", ShellLink.isOurs("https://dev.example.org:8443/x", "https://dev.example.org:8443"))
        assertFalse("a coordinator on a port: another port is not ours", ShellLink.isOurs("https://dev.example.org/x", "https://dev.example.org:8443"))
    }

    @Test fun subframes() {
        assertTrue("a frame over https: allowed", ShellLink.allowsSubframe("https://js.stripe.com/v3/"))
        assertTrue("about:srcdoc in a frame: allowed", ShellLink.allowsSubframe("about:srcdoc"))
        assertTrue("about:blank in a frame: allowed", ShellLink.allowsSubframe("about:blank"))
        assertFalse("any other about: page in a frame: refused", ShellLink.allowsSubframe("about:config"))
        for (bad in listOf("javascript:alert(1)", "file:///x", "data:text/html,hi", "blob:https://x/1", "kosmos://open", "http://x.com/")) {
            assertFalse("a frame to $bad: refused", ShellLink.allowsSubframe(bad))
        }
    }
}
