package io.kosmos.app

import io.kosmos.app.shell.AppTabs
import io.kosmos.app.shell.BoardScripts
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * kosmos#8046 slice 1 (board client): the document-start scripts the WebView runs, ported from ContentView.swift
 * BoardWeb.userScripts. markScript always runs; the session hand-over runs only when there is a session to carry or
 * drop and the coordinator origin is well-formed. Pure composition + the origin guard.
 */
class BoardScriptsTest {

    private val origin = "https://login.kosmosplus.com"

    @Test fun markScriptAlwaysRunsFirst() {
        val none = BoardScripts.startScripts(null, emptyList(), origin)
        assertEquals("with no session to carry or drop, only markScript", listOf(AppTabs.markScript), none)

        val withSession = BoardScripts.startScripts("tok", coordinatorOrigin = origin)
        assertEquals("markScript stays first", AppTabs.markScript, withSession.first())
    }

    @Test fun theSessionIsCarriedWhenThereIsOne() {
        val s = BoardScripts.startScripts("tok", coordinatorOrigin = origin)
        assertEquals("markScript + the hand-over", 2, s.size)
        assertTrue("the hand-over carries the token", s[1].contains("\"tok\""))
        assertTrue("the hand-over is the session script", s[1].contains("localStorage.setItem(a[1], a[0])"))
    }

    @Test fun aDroppedSessionIsForgottenEvenWithNoTokenHeld() {
        val s = BoardScripts.startScripts(null, listOf("dead"), origin)
        assertEquals(2, s.size)
        assertTrue("the dropped session is named", s[1].contains("[\"dead\"]"))
        assertTrue("with no token held, a[0] is null", s[1].contains("var a = [null,"))
    }

    @Test fun anUnreadableOriginLeavesOnlyMarkScript() {
        val s = BoardScripts.startScripts("tok", coordinatorOrigin = "not a url")
        assertEquals("the hand-over has nowhere safe to run", listOf(AppTabs.markScript), s)
        assertFalse(s.any { it.contains("\"tok\"") })
    }
}
