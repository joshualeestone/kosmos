package io.kosmos.app

import io.kosmos.app.shell.BoardWebRouting
import io.kosmos.app.shell.ShellLink
import io.kosmos.app.shell.ShellLink.LinkDecision
import io.kosmos.app.shell.ShellLink.Origin
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * kosmos#8046 slice 1 (hybrid shell): the main-frame link routing, ported from ContentView.swift's navigation
 * delegate. Pins the platform-signals -> Origin mapping and the decision wiring over the (separately tested)
 * ShellLink.linkDecision.
 */
class BoardWebRoutingTest {

    private val coordinator = "https://login.kosmosplus.com"

    @Test fun onlyATapIsTreatedAsThePersonActing() {
        assertEquals("a tap", Origin.TAPPED, BoardWebRouting.navOrigin(hasGesture = true, isRedirect = false))
        assertEquals("a script/programmatic load", Origin.PAGE_FLOW, BoardWebRouting.navOrigin(hasGesture = false, isRedirect = false))
        assertEquals("a redirect is a flow even with a lingering gesture", Origin.PAGE_FLOW, BoardWebRouting.navOrigin(hasGesture = true, isRedirect = true))
        assertEquals(Origin.PAGE_FLOW, BoardWebRouting.navOrigin(hasGesture = false, isRedirect = true))
    }

    @Test fun kosmosOwnPagesOpenInTheApp() {
        assertEquals(
            LinkDecision.IN_APP,
            BoardWebRouting.mainFrameDecision("https://login.kosmosplus.com/?tab=agents", coordinator, hasGesture = true, isRedirect = false)
        )
    }

    @Test fun anotherHttpsSiteGoesToTheBrowser() {
        assertEquals(
            LinkDecision.EXTERNAL,
            BoardWebRouting.mainFrameDecision("https://example.com/", coordinator, hasGesture = true, isRedirect = false)
        )
    }

    @Test fun plainHttpIsBrowserOnATapButRefusedInAFlow() {
        assertEquals(
            "a tapped http link opens in the browser",
            LinkDecision.EXTERNAL,
            BoardWebRouting.mainFrameDecision("http://example.com/", coordinator, hasGesture = true, isRedirect = false)
        )
        assertEquals(
            "a page-flow http load is refused",
            LinkDecision.BLOCK,
            BoardWebRouting.mainFrameDecision("http://example.com/", coordinator, hasGesture = false, isRedirect = false)
        )
    }

    @Test fun appLinksOpenTheirAppOnlyFromATap() {
        assertEquals(
            LinkDecision.EXTERNAL,
            BoardWebRouting.mainFrameDecision("mailto:a@b.co", coordinator, hasGesture = true, isRedirect = false)
        )
        assertEquals(
            LinkDecision.BLOCK,
            BoardWebRouting.mainFrameDecision("mailto:a@b.co", coordinator, hasGesture = false, isRedirect = false)
        )
    }

    @Test fun otherSchemesAreRefused() {
        assertEquals(
            LinkDecision.BLOCK,
            BoardWebRouting.mainFrameDecision("javascript:alert(1)", coordinator, hasGesture = true, isRedirect = false)
        )
    }
}
