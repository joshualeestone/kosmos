package io.kosmos.app.shell

/**
 * kosmos#8046 slice 1 (hybrid shell): the main-frame link routing the board WebView's WebViewClient performs,
 * ported from ContentView.swift's navigation delegate. iOS maps the platform navigation type to Shell.Origin
 * (`navigationType == .linkActivated ? .tapped : .pageFlow`) and then calls Shell.linkDecision; a new-window
 * request passes `.newWindow` directly. On Android the WebViewClient has the same two signals on a
 * WebResourceRequest — `hasGesture()` (the person acted) and `isRedirect` — so the mapping is pure and testable,
 * and the WebViewClient itself becomes a thin caller (as iOS's delegate is).
 */
object BoardWebRouting {

    /**
     * The origin of a MAIN-FRAME navigation, from its platform signals. A navigation the person started by
     * acting (a tap) is TAPPED; a redirect, a form post, a script-driven load or any programmatic navigation
     * is PAGE_FLOW. A redirect is a flow even if a gesture flag lingers from the tap that began it. New-window
     * requests do not come through here; their caller passes ShellLink.Origin.NEW_WINDOW directly.
     */
    fun navOrigin(hasGesture: Boolean, isRedirect: Boolean): ShellLink.Origin =
        if (hasGesture && !isRedirect) ShellLink.Origin.TAPPED else ShellLink.Origin.PAGE_FLOW

    /** The decision for a main-frame navigation, from the url and its platform signals. */
    fun mainFrameDecision(
        url: String,
        coordinator: String,
        hasGesture: Boolean,
        isRedirect: Boolean,
    ): ShellLink.LinkDecision =
        ShellLink.linkDecision(url, coordinator, navOrigin(hasGesture, isRedirect))
}
