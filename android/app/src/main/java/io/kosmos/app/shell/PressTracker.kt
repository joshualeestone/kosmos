package io.kosmos.app.shell

/**
 * kosmos#8046 slice 1 (hybrid shell): the bookkeeping behind the app's tab presses and its Tasks reads,
 * ported from the PressTracker struct in ios/Kosmos/ShellLogic.swift. Apart from the WebView so a plain JVM
 * test can drive it; the Compose chrome / WebView host only carries out what this says (as iOS's BoardWeb
 * does). Pairs with [AppTabs].
 */
class PressTracker {
    /** The press the page has not yet taken (no page yet, still loading, or a page without the door). */
    var pending: AppTabs.Tab? = null; private set
    /** The door name a waiting press uses instead of its tab's section (a create), replayed with it. */
    var pendingDoor: String? = null; private set
    /** The computer a waiting create was meant for, or null for any page. */
    var pendingHost: String? = null; private set
    /** Whether the latest press's script is running (sent, no answer yet). */
    var running: Boolean = false; private set
    /** Every press / own-page load / drop takes a new number; an answer counts only for the latest. */
    var serial: Int = 0; private set
    /** Moves on only when a lock drops the page, so reads of the dropped page are ignored. */
    var generation: Int = 0; private set
    /** Moves on with each round of Tasks reads, so only the latest round runs. */
    var readRound: Int = 0; private set
    var readRoundIsLaunch: Boolean = true; private set
    var readThisLaunch: Boolean = false; private set
    var launchAnswered: Boolean = false; private set
    var launchHost: String? = null; private set

    data class Replay(val tab: AppTabs.Tab, val door: String?, val host: String?)

    /** What a finished load replays: the tab and its create name together. */
    val replay: Replay? get() = pending?.let { Replay(it, pendingDoor, pendingHost) }

    /** What a load on `host` replays: nothing while the waiting press is for another computer. */
    fun replay(host: String?): Replay? {
        if (pendingHost != null && pendingHost?.lowercase() != host?.lowercase()) return null
        return replay
    }

    fun isCurrent(serial: Int): Boolean = serial == this.serial

    /** What BoardWeb sees of its page when a press comes. */
    enum class Page { NO_VIEW, LOADING, READY }

    data class Press(val script: String, val serial: Int)

    /**
     * A press: the script to run now and the number its answer must carry, or null when there is nothing to
     * run now (the native tab, which also ends a waiting press; or a page not ready, where the press waits).
     */
    fun press(tab: AppTabs.Tab, page: Page, section: Boolean = false, door: String? = null, host: String? = null): Press? {
        serial += 1
        val script = if (section || !AppTabs.isNative(tab)) (door?.let { AppTabs.pressScript(door = it) } ?: AppTabs.pressScript(tab)) else null
        if (script == null) {
            pending = null; pendingDoor = null; pendingHost = null; running = false
            return null
        }
        pending = tab
        pendingDoor = door
        pendingHost = host
        running = page == Page.READY
        return if (running) Press(script, serial) else null
    }

    /** An answer to the press numbered `serial`: where the bar goes, or null. */
    fun answered(serial: Int, answer: AppTabs.DoorAnswer, pageURL: String?): AppTabs.Tab? {
        if (serial != this.serial) return null
        running = false
        val pressed = pending
        val next = AppTabs.afterAnswer(answer, pageURL)
        if (next.over) { pending = null; pendingDoor = null; pendingHost = null }
        return if (answer == AppTabs.DoorAnswer.OPENED) pressed else next.barTo
    }

    /** A load of the computer a waiting create was for failed: the create ends there. */
    fun loadFailed(host: String?) {
        val want = pendingHost ?: return
        if (want.lowercase() != host?.lowercase()) return
        serial += 1; running = false; pending = null; pendingDoor = null; pendingHost = null
    }

    /** The app is loading a page of its own choosing (an agent tap, a notification): no earlier press covers it. */
    fun loadingOwnPage() {
        serial += 1; running = false; pending = null; pendingDoor = null; pendingHost = null
    }

    /** A page finished loading: a launch round of Tasks reads starts if none has answered this launch. */
    fun loaded(host: String? = null): Int? {
        if (host != null && host != launchHost) {
            if (launchHost != null) { readThisLaunch = false; launchAnswered = false }
            launchHost = host
        }
        if (readThisLaunch || launchAnswered) return null
        readRound += 1
        readRoundIsLaunch = true
        return readRound
    }

    /** The app came back to the front: a return round of reads starts. */
    fun returned(): Int {
        readRound += 1
        readRoundIsLaunch = false
        return readRound
    }

    /** Whether a read scheduled in `round` for `generation` should still run. */
    fun shouldRead(round: Int, generation: Int): Boolean =
        generation == this.generation && round == readRound && !(readRoundIsLaunch && readThisLaunch)

    /** A read's answer: the value to put in the bar, or null to leave it. In a launch's round only a "1" ends
     *  the round (a "0" can be last session's flag). */
    fun read(shown: Boolean?, generation: Int): Boolean? {
        if (generation != this.generation || shown == null) return null
        if (shown || !readRoundIsLaunch) readThisLaunch = true
        if (readRoundIsLaunch) launchAnswered = true
        return shown
    }

    /** The page was dropped (a lock): the fresh page opens the selected tab's section and may set Tasks. */
    fun drop(selected: AppTabs.Tab) {
        serial += 1
        running = false
        generation += 1
        pending = if (AppTabs.isNative(selected) || AppTabs.pressScript(selected) == null) null else selected
        pendingDoor = null
        pendingHost = null
        readThisLaunch = false
        launchAnswered = false
        launchHost = null
    }

    companion object {
        /** A launch's reads: every 2 s for 20 s from the load, ending at the first answer. */
        val launchReads: List<Double> = (0..10).map { it * 2.0 }
        /** A return's reads: after the board's polls (every 5 s) have had time to write the flag again. */
        val returnReads: List<Double> = listOf(6.0, 12.0, 18.0)
    }
}
