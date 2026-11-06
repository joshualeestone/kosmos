package io.kosmos.app.shell

import java.net.URI

/**
 * kosmos#8046 slice 1 (hybrid shell): where a link goes, ported from the link-routing part of
 * ios/Kosmos/ShellLogic.swift (`Shell.linkDecision` / `isOurs` / `allowsSubframe`). Pure Kotlin, so
 * ShellLinkLogicTest proves it on a plain JVM. The WebViewClient's shouldOverrideUrlLoading is a thin
 * caller of this, as iOS's ContentView navigation delegate is.
 *
 * The scheme is extracted by hand (the text before the first ':') rather than only through java.net.URI,
 * because URI parsing is strict and throws on inputs like `javascript:alert(1)` or `data:text/html,hi`;
 * only the hierarchical https/http cases are parsed with URI, for their host / port / userInfo.
 */
object ShellLink {

    enum class LinkDecision { IN_APP, EXTERNAL, BLOCK }

    /** What started a navigation, as far as the rule cares. */
    enum class Origin {
        /** The person tapped a link. */
        TAPPED,
        /** A redirect, a form post or a script: part of a flow the page is running. */
        PAGE_FLOW,
        /** A request for a new window (target=_blank, window.open). */
        NEW_WINDOW,
    }

    private fun schemeOf(url: String): String =
        if (url.contains(':')) url.substringBefore(':').lowercase() else ""

    private fun hostOf(url: String): String? =
        try { URI(url).host?.lowercase()?.takeIf { it.isNotEmpty() } } catch (e: Exception) { null }

    private fun portOf(url: String): Int =
        try { URI(url).port } catch (e: Exception) { -1 }

    /**
     * Kosmos+ itself or one of the person's Macs, over https: the plain host with no user part, and the
     * coordinator's own port (443 and none are the same) or none for a Mac.
     */
    fun isOurs(url: String, coordinator: String): Boolean {
        val coordinatorHost = hostOf(coordinator) ?: return false
        val want = portOf(coordinator).let { if (it == 443) -1 else it }
        val u = try { URI(url) } catch (e: Exception) { return false }
        if (u.scheme?.lowercase() != "https") return false
        if (u.userInfo != null) return false
        val host = u.host?.lowercase()?.takeIf { it.isNotEmpty() } ?: return false
        val port = if (u.port == 443) -1 else u.port
        if (host == coordinatorHost) return port == want
        return port == -1 && ShellLoad.isMacHost(host, coordinatorHost)
    }

    /**
     * Decides a MAIN-FRAME navigation or a new-window request (subframe loads go to [allowsSubframe]).
     * - Kosmos+ and the person's Macs over https: in the app.
     * - Any other https site, however reached: the browser (no third-party page inside the app).
     * - Plain http: never in the app; tapped or new-window it goes to the browser, a page flow is refused.
     * - mail / phone / text links: their apps, but only from a tap or a new window the person asked for.
     * - about:blank: the page's own use, but never as a new window (it would blank the board).
     * - Every other scheme (javascript:, file:, data:, blob:, custom): refused.
     */
    fun linkDecision(url: String, coordinator: String, origin: Origin): LinkDecision = when (schemeOf(url)) {
        "https" -> if (isOurs(url, coordinator)) LinkDecision.IN_APP
            else if (hostOf(url) != null) LinkDecision.EXTERNAL else LinkDecision.BLOCK
        "http" -> if (hostOf(url) == null) LinkDecision.BLOCK
            else if (origin == Origin.PAGE_FLOW) LinkDecision.BLOCK else LinkDecision.EXTERNAL
        "mailto", "tel", "sms" -> if (origin == Origin.PAGE_FLOW) LinkDecision.BLOCK else LinkDecision.EXTERNAL
        "about" -> if (url == "about:blank" && origin != Origin.NEW_WINDOW) LinkDecision.IN_APP else LinkDecision.BLOCK
        else -> LinkDecision.BLOCK
    }

    /**
     * A navigation inside a frame of the page (an iframe), which [linkDecision] never sees. Embedded content
     * keeps working over https (and about:blank / about:srcdoc, which WebKit/Chromium use for frames); every
     * other scheme is refused, so a frame cannot do what the main frame may not.
     */
    fun allowsSubframe(url: String): Boolean = when (schemeOf(url)) {
        "https" -> true
        "about" -> url == "about:blank" || url == "about:srcdoc"
        else -> false
    }
}
