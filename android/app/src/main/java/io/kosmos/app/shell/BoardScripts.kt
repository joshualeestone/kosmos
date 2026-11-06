package io.kosmos.app.shell

import io.kosmos.app.signin.SignIn

/**
 * kosmos#8046 slice 1 (board client): the scripts the WebView runs at the start of every main-frame document,
 * ported from ContentView.swift BoardWeb.userScripts and mirroring the iOS wiring. markScript always runs (it tells
 * the board it is inside the app); the session hand-over (SignIn.sessionScript, kosmos#7042) runs only when there is
 * a session to carry or one to forget, and only on the coordinator's own origin, which the script checks itself.
 *
 * Pure logic: it returns the script SOURCES. The Android glue that applies them at document-start on the main frame
 * (androidx.webkit WebViewCompat.addDocumentStartJavaScript) is a separate, compile-verified file; this composition
 * and its origin guard are what the unit test pins.
 */
object BoardScripts {

    /**
     * The document-start scripts for the board, in order: markScript first, then the session hand-over when one is
     * carried (token) or dropped (forget) AND the coordinator origin is well-formed. An unreadable origin yields
     * markScript alone, since the hand-over has nowhere safe to run.
     */
    fun startScripts(session: String?, forget: List<String> = emptyList(), coordinatorOrigin: String): List<String> {
        val scripts = mutableListOf(AppTabs.markScript)
        val origin = SignIn.pageOrigin(coordinatorOrigin)
        if (origin != null) {
            SignIn.sessionScript(session, forget, origin)?.let { scripts.add(it) }
        }
        return scripts
    }
}
