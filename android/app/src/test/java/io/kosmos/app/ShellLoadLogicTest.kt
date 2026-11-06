package io.kosmos.app

import io.kosmos.app.shell.ShellLoad
import io.kosmos.app.shell.ShellLoad.LoadFailure
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * kosmos#8046 slice 1: the shell's load-failure logic, ported from the Shell cases in
 * ios/LogicTests/main.swift and adapted to Android's WebViewClient error codes + the ConnectivityManager
 * online flag. Plain JVM: ShellLoad has no Android types. Each classification arm has a control that must
 * land in a DIFFERENT bucket, so a rule that quietly matched everything (or nothing) cannot pass.
 */
class ShellLoadLogicTest {

    private val coordinator = "login.kosmosplus.com"

    @Test fun baseClassification() {
        assertEquals("no connection: offline", LoadFailure.OFFLINE, ShellLoad.classify(online = false, errorCode = ShellLoad.ERROR_TIMEOUT))
        assertEquals("DNS failure while online: unreachable", LoadFailure.UNREACHABLE, ShellLoad.classify(true, ShellLoad.ERROR_HOST_LOOKUP))
        assertEquals("cannot connect: unreachable", LoadFailure.UNREACHABLE, ShellLoad.classify(true, ShellLoad.ERROR_CONNECT))
        assertEquals("connection lost (IO): unreachable", LoadFailure.UNREACHABLE, ShellLoad.classify(true, ShellLoad.ERROR_IO))
        assertEquals("timed out: unreachable", LoadFailure.UNREACHABLE, ShellLoad.classify(true, ShellLoad.ERROR_TIMEOUT))
        assertEquals("failed TLS handshake: unreachable", LoadFailure.UNREACHABLE, ShellLoad.classify(true, ShellLoad.ERROR_FAILED_SSL_HANDSHAKE))
        assertEquals("a file-not-found code: other", LoadFailure.OTHER, ShellLoad.classify(true, -14))
        assertEquals("an unknown code: other", LoadFailure.OTHER, ShellLoad.classify(true, -999))
    }

    @Test fun macUnreachableWhenAMacOwnAddressDoesNotAnswer() {
        assertEquals("a Mac's address timing out: the Mac is not answering", LoadFailure.MAC_UNREACHABLE,
            ShellLoad.classify(true, ShellLoad.ERROR_TIMEOUT, "leo.kosmosplus.com", coordinator))
        assertEquals("a Mac's address in any case: the Mac", LoadFailure.MAC_UNREACHABLE,
            ShellLoad.classify(true, ShellLoad.ERROR_CONNECT, "Leo.KosmosPlus.com", coordinator))
        assertEquals("a failed TLS handshake to a Mac: the Mac", LoadFailure.MAC_UNREACHABLE,
            ShellLoad.classify(true, ShellLoad.ERROR_FAILED_SSL_HANDSHAKE, "leo.kosmosplus.com", coordinator))
        assertEquals("a Mac dropping the connection: the Mac", LoadFailure.MAC_UNREACHABLE,
            ShellLoad.classify(true, ShellLoad.ERROR_IO, "leo.kosmosplus.com", coordinator))
    }

    @Test fun notAMacStaysUnreachableOrOffline() {
        assertEquals("the coordinator timing out: Kosmos+, not a Mac", LoadFailure.UNREACHABLE,
            ShellLoad.classify(true, ShellLoad.ERROR_TIMEOUT, "login.kosmosplus.com", coordinator))
        assertEquals("another host: Kosmos+ wording, never a Mac", LoadFailure.UNREACHABLE,
            ShellLoad.classify(true, ShellLoad.ERROR_TIMEOUT, "example.com", coordinator))
        assertEquals("two labels deep is not a Mac's address", LoadFailure.UNREACHABLE,
            ShellLoad.classify(true, ShellLoad.ERROR_TIMEOUT, "a.b.kosmosplus.com", coordinator))
        assertEquals("no failing address: Kosmos+ wording", LoadFailure.UNREACHABLE,
            ShellLoad.classify(true, ShellLoad.ERROR_TIMEOUT, null, coordinator))
        assertEquals("a DNS failure is the phone's lookup, not the Mac asleep", LoadFailure.UNREACHABLE,
            ShellLoad.classify(true, ShellLoad.ERROR_HOST_LOOKUP, "leo.kosmosplus.com", coordinator))
        assertEquals("the phone offline stays offline, whichever address", LoadFailure.OFFLINE,
            ShellLoad.classify(false, ShellLoad.ERROR_TIMEOUT, "leo.kosmosplus.com", coordinator))
    }

    @Test fun isMacHostRule() {
        assertTrue(ShellLoad.isMacHost("leo.kosmosplus.com", coordinator))
        assertFalse("the coordinator is not a Mac", ShellLoad.isMacHost("login.kosmosplus.com", coordinator))
        assertFalse("two labels deep is not a Mac", ShellLoad.isMacHost("a.b.kosmosplus.com", coordinator))
        assertFalse("another registrable domain is not a Mac", ShellLoad.isMacHost("example.com", coordinator))
        assertFalse("no coordinator host: cannot be a Mac", ShellLoad.isMacHost("leo.kosmosplus.com", null))
        assertFalse("a two-label coordinator has no relay domain", ShellLoad.isMacHost("leo.kosmosplus.com", "kosmosplus.com"))
    }

    @Test fun otherComputerOffer() {
        assertTrue("a Mac not answering offers Choose another computer", ShellLoad.offersOtherComputer(LoadFailure.MAC_UNREACHABLE))
        assertFalse("offline: another computer would fail the same way", ShellLoad.offersOtherComputer(LoadFailure.OFFLINE))
        assertFalse("Kosmos+ not answering: the list is on Kosmos+ too", ShellLoad.offersOtherComputer(LoadFailure.UNREACHABLE))
    }

    @Test fun retriesOnShowOfflineOnce() {
        assertTrue("offline page while already online: retry by itself", ShellLoad.retriesOnShow(LoadFailure.OFFLINE, online = true, alreadyRetried = false))
        assertFalse("only once per failure", ShellLoad.retriesOnShow(LoadFailure.OFFLINE, online = true, alreadyRetried = true))
        assertFalse("really offline: wait for the reconnect", ShellLoad.retriesOnShow(LoadFailure.OFFLINE, online = false, alreadyRetried = false))
        assertFalse("not answering is not offline: no automatic retry", ShellLoad.retriesOnShow(LoadFailure.UNREACHABLE, online = true, alreadyRetried = false))
        assertFalse("a Mac not answering is not auto-retried as if the phone came back", ShellLoad.retriesOnShow(LoadFailure.MAC_UNREACHABLE, online = true, alreadyRetried = false))
    }

    @Test fun macWording() {
        assertEquals("leo", ShellLoad.macName("leo.kosmosplus.com"))
        assertEquals(null, ShellLoad.macName(null))
        assertEquals(null, ShellLoad.macName(""))
        assertEquals("the title names the Mac", "10102026 isn't answering", ShellLoad.macUnreachableTitle("10102026"))
        assertEquals("no name: generic title", "Your Mac isn't answering", ShellLoad.macUnreachableTitle(null))
        assertEquals("blank name: generic title", "Your Mac isn't answering", ShellLoad.macUnreachableTitle("  "))
        assertEquals("no name: generic message", "Your phone is online, but your Mac didn't reply. It may be asleep, off or offline. Wake it, then try again.", ShellLoad.macUnreachableMessage(null))
        assertTrue("the message names the Mac", ShellLoad.macUnreachableMessage("tmnt").contains("the Mac called tmnt didn't reply"))
    }

    @Test fun retryAction() {
        assertEquals("Try again loads the page that FAILED, not the one showing",
            ShellLoad.RetryAction.Load("https://hers.kosmosplus.com/?tab=detail&agent=leo"),
            ShellLoad.retryAction("https://hers.kosmosplus.com/?tab=detail&agent=leo", "https://hers.kosmosplus.com/", coordinator))
        assertEquals("nothing loaded yet: the home page", ShellLoad.RetryAction.Load(coordinator), ShellLoad.retryAction(null, null, coordinator))
        assertEquals("otherwise: reload the page showing", ShellLoad.RetryAction.Reload, ShellLoad.retryAction(null, "https://hers.kosmosplus.com/", coordinator))
    }

    @Test fun backAction() {
        assertEquals("Back after a failed tap: stay on the page still loaded", ShellLoad.BackAction.STAY, ShellLoad.backAction(provisional = true, current = "https://mac-a.kosmosplus.com/", canGoBack = true))
        assertEquals("Back after a committed page failed: go back one page", ShellLoad.BackAction.GO_BACK, ShellLoad.backAction(provisional = false, current = "https://mac-c.kosmosplus.com/", canGoBack = true))
        assertEquals("Back when nothing ever loaded: the board home", ShellLoad.BackAction.HOME, ShellLoad.backAction(provisional = true, current = null, canGoBack = false))
        assertEquals("Back with no history: the board home", ShellLoad.BackAction.HOME, ShellLoad.backAction(provisional = false, current = null, canGoBack = false))
    }
}
