package io.kosmos.app.shell

/**
 * kosmos#8046 slice 1 (hybrid shell, Liu Kang ruling 2026-11-06): the shell's decisions about a board page
 * that failed to load, ported from ios/Kosmos/ShellLogic.swift (the `Shell` enum). Pure Kotlin, no Android
 * types, so ShellLoadLogicTest proves it on a plain JVM the way ios/LogicTests proves the Swift. The
 * WebViewClient / ConnectivityManager layer is a thin caller of what is here, as iOS's ContentView is.
 *
 * Android divergences from iOS, written here per the #8046 rule ("where Android has its own way, use it,
 * and write the choice here"):
 *  - iOS reads NSURLError codes and gets "offline" from specific codes. Android reads WebViewClient.ERROR_*
 *    codes and gets "offline" from ConnectivityManager (no active network), so [classify] takes an explicit
 *    `online` flag rather than inferring offline from a code.
 *  - TLS CERTIFICATE errors arrive on Android through WebViewClient.onReceivedSslError, a DIFFERENT callback,
 *    not onReceivedError, so they are out of scope here (iOS folds them into .unreachable). ERROR_FAILED_SSL_HANDSHAKE
 *    (the handshake itself failing, the analog of NSURLErrorSecureConnectionFailed) IS handled.
 *  - "Cancelled / superseded" has no standard Android error code (iOS returns nil for NSURLErrorCancelled).
 *    The caller must pre-filter: only call this for a MAIN-FRAME error whose failing URL is the one it meant
 *    to load. That keeps a typed-over or redirect-superseded load from drawing a failure page.
 */
object ShellLoad {

    /** The WebViewClient.ERROR_* codes this classifier reads. Equal to the android.webkit.WebViewClient
     *  constants; declared here so this file stays Android-free and plain-JVM-testable. */
    const val ERROR_HOST_LOOKUP = -2          // DNS lookup failed (the phone's own lookup)
    const val ERROR_CONNECT = -6              // failed to connect to the server
    const val ERROR_IO = -7                   // failed to read or write (connection lost)
    const val ERROR_TIMEOUT = -8              // timed out
    const val ERROR_FAILED_SSL_HANDSHAKE = -11 // the TLS handshake itself failed

    enum class LoadFailure {
        /** The phone has no connection: "you're offline" is the whole story. */
        OFFLINE,
        /** The phone is online but Kosmos+ did not answer. */
        UNREACHABLE,
        /** The phone is online and a Mac's own address (<mac>.kosmosplus.com) did not answer: asleep, off,
         *  or not running Kosmos (#718 state 2). */
        MAC_UNREACHABLE,
        /** Anything else that stopped the page, shown with the system's wording. */
        OTHER,
    }

    /** Codes that mean the far end was reached but could not serve the page. */
    private val unreachableCodes = setOf(ERROR_HOST_LOOKUP, ERROR_CONNECT, ERROR_IO, ERROR_TIMEOUT, ERROR_FAILED_SSL_HANDSHAKE)

    /** The codes that mean NOTHING answered at the far end (so a Mac's own address failing is the Mac asleep).
     *  ERROR_HOST_LOOKUP is excluded on purpose: a DNS failure is the phone's own lookup, not the Mac. */
    private val noAnswerCodes = setOf(ERROR_CONNECT, ERROR_IO, ERROR_TIMEOUT, ERROR_FAILED_SSL_HANDSHAKE)

    /** Base classification from the connectivity state and the WebView error code. Offline wins over any
     *  code, as on iOS the phone being offline stays offline whichever address failed. */
    fun classify(online: Boolean, errorCode: Int): LoadFailure {
        if (!online) return LoadFailure.OFFLINE
        return if (errorCode in unreachableCodes) LoadFailure.UNREACHABLE else LoadFailure.OTHER
    }

    /** The same, told which host failed and the coordinator's host: a Mac's own address that did not answer
     *  is the Mac not answering, not Kosmos+. A DNS failure, a cert/other error, or any non-Mac host stays
     *  UNREACHABLE (or OFFLINE / OTHER). */
    fun classify(online: Boolean, errorCode: Int, failingHost: String?, coordinatorHost: String?): LoadFailure {
        val base = classify(online, errorCode)
        if (base == LoadFailure.UNREACHABLE && errorCode in noAnswerCodes &&
            failingHost != null && isMacHost(failingHost.lowercase(), coordinatorHost)
        ) {
            return LoadFailure.MAC_UNREACHABLE
        }
        return base
    }

    /**
     * Whether `host` is one of the person's Macs: exactly one host label under the coordinator's relay domain
     * (e.g. leo.kosmosplus.com when the coordinator is login.kosmosplus.com), and not the coordinator itself.
     * Ported from PushBridge.isMacHost. `host` must already be lowercased.
     */
    fun isMacHost(host: String, coordinatorHost: String?): Boolean {
        if (!host.all { it.code in 0..127 }) return false
        val coordinator = coordinatorHost?.lowercase() ?: return false
        val relayDomain = relayDomain(coordinator) ?: return false
        if (host == coordinator) return false
        val suffix = ".$relayDomain"
        if (!host.endsWith(suffix)) return false
        return isHostLabel(host.dropLast(suffix.length))
    }

    /** The coordinator's relay domain: everything after its first label, when it has at least three labels
     *  (login.kosmosplus.com -> kosmosplus.com). nil otherwise. */
    private fun relayDomain(coordinatorHost: String): String? {
        val labels = coordinatorHost.split(".")
        if (labels.size < 3 || labels.any { it.isEmpty() }) return null
        return labels.drop(1).joinToString(".")
    }

    private fun isHostLabel(label: String): Boolean {
        if (label.length !in 1..63) return false
        if (label.first() == '-' || label.last() == '-') return false
        if (label.startsWith("xn--")) return false
        return label.all { it in 'a'..'z' || it in '0'..'9' || it == '-' }
    }

    /** kosmos#6850: only a Mac that did not answer offers "Choose another computer"; offline / Kosmos+ down
     *  / other failures would fail the same way on any computer. */
    fun offersOtherComputer(failure: LoadFailure): Boolean = failure == LoadFailure.MAC_UNREACHABLE

    /** Whether an "offline" page should retry by itself once, in case the phone was already back online when
     *  the load failed (no connectivity CHANGE will come). Once per failure, so a captive portal cannot loop. */
    fun retriesOnShow(failure: LoadFailure, online: Boolean, alreadyRetried: Boolean): Boolean =
        failure == LoadFailure.OFFLINE && online && !alreadyRetried

    /** The Mac's name for the failure page: the first label of its host, or null for the generic wording. */
    fun macName(fromHost: String?): String? =
        fromHost?.split(".")?.firstOrNull()?.takeIf { it.isNotEmpty() }

    fun macUnreachableTitle(name: String?): String {
        val n = name?.trim().orEmpty()
        return if (n.isEmpty()) "Your Mac isn't answering" else "$n isn't answering"
    }

    /** The failure-page body for a Mac that did not answer (the simple form; the "we last heard from it at …"
     *  clock sentence is a later port, as it needs the board's heardWhen). */
    fun macUnreachableMessage(name: String?): String {
        val n = name?.trim().orEmpty()
        val who = if (n.isEmpty()) "your Mac" else "the Mac called $n"
        return "Your phone is online, but $who didn't reply. It may be asleep, off or offline. Wake it, then try again."
    }

    /** What "Try again" loads: the page that FAILED, else the home page when nothing has loaded yet, else a
     *  reload of the current page. URLs are strings here; the caller resolves them against the WebView. */
    sealed interface RetryAction {
        data class Load(val url: String) : RetryAction
        data object Reload : RetryAction
    }

    fun retryAction(failed: String?, current: String?, home: String): RetryAction = when {
        failed != null -> RetryAction.Load(failed)
        current == null -> RetryAction.Load(home)
        else -> RetryAction.Reload
    }

    /** What "Back to Kosmos" does on the failure page. `provisional` is true when the failure came before the
     *  new page committed (an offline Mac, a timeout): the history's current item is still the page that was
     *  showing, so going back would skip it. */
    enum class BackAction { STAY, GO_BACK, HOME }

    fun backAction(provisional: Boolean, current: String?, canGoBack: Boolean): BackAction = when {
        provisional && current != null -> BackAction.STAY
        canGoBack -> BackAction.GO_BACK
        else -> BackAction.HOME
    }
}
