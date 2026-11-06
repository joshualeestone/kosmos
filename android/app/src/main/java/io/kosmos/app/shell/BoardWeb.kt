package io.kosmos.app.shell

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import io.kosmos.app.signin.SignIn

/**
 * kosmos#8046 slice 1 (hybrid shell): the Android glue that hosts the board in one WebView, ported from
 * ContentView.swift's BoardWeb + navigation delegate. All of its DECISIONS live in the pure, unit-tested
 * objects it calls (BoardWebRouting / ShellLink for routing, ShellLoad for load failures, BoardScripts +
 * SignIn for the document-start session hand-over); this file is the thin platform wiring over them, verified
 * by compiling and — the parts a compiler cannot see — on a device (the signed debug APK handed to Josh).
 *
 * Weakest parts, device-verified, named here and on the plan:
 *  - Document-start injection uses androidx.webkit's addDocumentStartJavaScript, which needs a recent WebView
 *    (WebViewFeature.DOCUMENT_START_SCRIPT). On a device whose WebView lacks it the session hand-over cannot run
 *    before the page's restore() reads localStorage (the iOS review-round-4 hazard); [applyStartScripts] reports
 *    whether it armed, so the host can fall back. The fallback itself is a later increment + decision.
 *  - The script-handler lifecycle (remove-all then re-add on a session change) mirrors iOS removeAllUserScripts;
 *    its timing against an in-flight load is observable only at runtime.
 */

/** Routes main-frame links and reports main-frame load failures, delegating to the tested logic. */
class BoardWebViewClient(
    private val context: Context,
    private val coordinatorOrigin: String,
    private val isOnline: () -> Boolean,
    private val onLoadFailure: (ShellLoad.LoadFailure, String?) -> Unit,
    private val onMainFrameFinished: () -> Unit = {},
) : WebViewClient() {

    private val coordinatorHost: String? = runCatching { Uri.parse(coordinatorOrigin).host }.getOrNull()

    override fun onPageFinished(view: WebView, url: String?) {
        super.onPageFinished(view, url)
        onMainFrameFinished()
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        // Subframe navigations do not come here as main-frame links; leave them to the WebView (ShellLink.allowsSubframe
        // governs them through the chrome client in a later increment).
        if (!request.isForMainFrame) return false
        val url = request.url.toString()
        return when (BoardWebRouting.mainFrameDecision(url, coordinatorOrigin, request.hasGesture(), request.isRedirect)) {
            ShellLink.LinkDecision.IN_APP -> false            // let the WebView load it
            ShellLink.LinkDecision.EXTERNAL -> { openExternally(url); true }
            ShellLink.LinkDecision.BLOCK -> true              // swallow it
        }
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (!request.isForMainFrame) return
        val failure = ShellLoad.classify(isOnline(), error.errorCode, request.url.host, coordinatorHost)
        onLoadFailure(failure, request.url.host)
    }

    private fun openExternally(url: String) {
        runCatching {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        // No app to open it: nothing happens, which is the same "swallowed" outcome as BLOCK.
    }
}

/**
 * Applies the board's document-start scripts (BoardScripts.startScripts) and re-applies them when the app's
 * session changes, mirroring iOS BoardWeb.sessionChanged (remove all, then add the current set). Holds the
 * ScriptHandlers so a change can remove the old ones first.
 */
class BoardSessionScripts(
    private val webView: WebView,
    private val coordinatorOrigin: String,
) {
    private val handlers = mutableListOf<ScriptHandler>()

    /** True if the scripts were armed at document-start; false when the WebView is too old for the feature. */
    fun apply(session: String?, forget: List<String> = emptyList()): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return false
        val origin = SignIn.pageOrigin(coordinatorOrigin) ?: return false
        handlers.forEach { it.remove() }
        handlers.clear()
        val allowed = setOf(origin)
        for (script in BoardScripts.startScripts(session, forget, coordinatorOrigin)) {
            handlers.add(WebViewCompat.addDocumentStartJavaScript(webView, script, allowed))
        }
        return true
    }
}
