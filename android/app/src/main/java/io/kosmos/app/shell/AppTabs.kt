package io.kosmos.app.shell

import java.net.URI

/**
 * kosmos#8046 slice 1 (hybrid shell): the app's own tab bar and its board "door", ported from the AppTabs
 * enum in ios/Kosmos/ShellLogic.swift. Agents is a native tab; the other tabs open their part of the board
 * in the one WebView through the board's JS door, window.kosmosAppTab. Pure Kotlin so AppTabsTest proves it
 * on a plain JVM. The door/mark JS strings are the SAME the board serves, so they port verbatim.
 *
 * The press state machine (PressTracker) is a separate following increment.
 */
object AppTabs {

    enum class Tab {
        TODAY, AGENTS, PROJECTS, TASKS, SETTINGS;

        val title: String
            get() = when (this) {
                TODAY -> "Today"; AGENTS -> "Agents"; PROJECTS -> "Projects"; TASKS -> "Tasks"; SETTINGS -> "Settings"
            }

        /** Mona Lisa's slice 1 spec (kosmos#7266: a briefcase for Projects; Agents draws `asset` instead). */
        val symbol: String
            get() = when (this) {
                TODAY -> "sun.max"; AGENTS -> "person.2"; PROJECTS -> "briefcase"; TASKS -> "checklist"; SETTINGS -> "gearshape"
            }

        /** Where the bar draws its own image instead of a system symbol: Agents (TabAgent); null elsewhere. */
        val asset: String?
            get() = if (this == AGENTS) "TabAgent" else null

        /** The name the board's door takes; null for the native tab. Today is the board's home, its agents tab. */
        val boardName: String?
            get() = when (this) {
                TODAY -> "agents"; AGENTS -> null; PROJECTS -> "projects"; TASKS -> "tasks"; SETTINGS -> "settings"
            }

        companion object {
            val allCases = listOf(TODAY, AGENTS, PROJECTS, TASKS, SETTINGS)
        }
    }

    /** kosmos#7252: Today is off in shipped builds; a signed-in launch opens on Agents. (The KOSMOS_STORE_SHOTS
     *  screenshot build turned it on; that build is out of scope here.) */
    const val todayTab = false

    /** kosmos#7266: the + on Agents and Projects open the board's own create form through the door. */
    enum class Create(val raw: String) { AGENT("new-agent"), PROJECT("new-project") }

    /** In Mona Lisa's order; Tasks is earned (shown only once the board says so) on the old five-tab bar. */
    fun visible(tasksTab: Boolean, todayTab: Boolean = AppTabs.todayTab): List<Tab> =
        Tab.allCases.filter { (it != Tab.TASKS || tasksTab || !todayTab) && (it != Tab.TODAY || todayTab) }

    /** Every tab the app draws itself (kosmos#7010/7030/7031/7032: all of them now). */
    fun isNative(tab: Tab): Boolean =
        tab == Tab.AGENTS || tab == Tab.SETTINGS || tab == Tab.TODAY || tab == Tab.PROJECTS || tab == Tab.TASKS

    /** The tab a board section shows under. The board's Settings / Projects / Tasks sections show under Today
     *  (their tabs are native); the home / an agent chat / anything unknown are Today. */
    fun barTab(forPage: Tab, tasksTab: Boolean): Tab {
        if (forPage == Tab.SETTINGS || forPage == Tab.PROJECTS || forPage == Tab.TASKS) return Tab.TODAY
        return if (forPage == Tab.TODAY || visible(tasksTab).contains(forPage)) forPage else Tab.TODAY
    }

    /** What a tab leaving the bar becomes: with Today off, Agents (the tab a launch opens on). */
    fun keep(selected: Tab, tasksTab: Boolean, todayTab: Boolean = AppTabs.todayTab): Tab =
        if (visible(tasksTab, todayTab).contains(selected)) selected else (if (todayTab) Tab.TODAY else Tab.AGENTS)

    enum class DoorAnswer { OPENED, REFUSED, ABSENT, NO_DOOR }

    /** The coordinator's sign-in host, where a press waits for the hand-off. Must match the coordinator origin. */
    const val signInHost = "login.kosmosplus.com"

    /** The press script for a tab: asks the board's door for that tab's board name, or null for a native tab
     *  with no board name (Agents). */
    fun pressScript(tab: Tab): String? = tab.boardName?.let { pressScript(door = it) }

    /** The door call for any name it takes (a section, or a create). */
    fun pressScript(door: String): String {
        val covered = if (Create.entries.none { it.raw == door }) ""
        else "var t = document.getElementById('tabs'); if (!t || t.closest('[inert]') || document.querySelector('.rm-back:not([hidden]), .fr-back:not([hidden]), .frc-back:not([hidden])')) return 'covered'; "
        return "(function () { if (typeof window.kosmosAppTab !== 'function') return 'absent'; try { if (window.kosmosAppTab('$door') === true) return 'opened'; ${covered}return 'refused'; } catch (e) { return 'refused'; } })()"
    }

    /** What a door call's result/error means. Only a real true is "opened"; a thrown error is no answer. */
    fun answer(result: Any?, error: Throwable?): DoorAnswer {
        if (error != null) return DoorAnswer.ABSENT
        return when (result as? String) {
            "opened" -> DoorAnswer.OPENED
            "refused" -> DoorAnswer.REFUSED
            "absent" -> DoorAnswer.NO_DOOR
            else -> DoorAnswer.ABSENT
        }
    }

    /** What a press's answer does: whether the press is over, and where the bar goes (null: it stays). */
    data class After(val over: Boolean, val barTo: Tab?)

    fun afterAnswer(answer: DoorAnswer, pageURL: String?): After = when (answer) {
        DoorAnswer.OPENED -> After(true, null)
        DoorAnswer.ABSENT -> After(false, null)
        DoorAnswer.REFUSED -> After(true, tab(forBoardURL = pageURL))
        DoorAnswer.NO_DOOR -> {
            val host = hostOf(pageURL)
            if (host == null || host == signInHost) After(false, null) else After(true, tab(forBoardURL = pageURL))
        }
    }

    /** The page moved to another section by itself: the tab the bar moves to, or null to leave it. Not while the
     *  bar is held, never from a native tab (all but a board page under Today), never on the sign-in page, and
     *  not for an address rewritten within one section. */
    fun follow(from: String?, to: String?, selected: Tab, barHeld: Boolean, tasksTab: Boolean): Tab? {
        if (barHeld || selected == Tab.AGENTS || selected == Tab.SETTINGS || selected == Tab.PROJECTS || selected == Tab.TASKS) return null
        if (to == null || hostOf(to) == signInHost) return null
        val now = tab(forBoardURL = to)
        if (from != null && hostOf(from) == hostOf(to) && tab(forBoardURL = from) == now) return null
        val next = barTab(forPage = now, tasksTab = tasksTab)
        return if (next == selected) null else next
    }

    /** The tab whose section a board address opens (?tab=). Home / an agent chat / unknown are Today. */
    fun tab(forBoardURL: String?): Tab {
        val name = queryParam(forBoardURL, "tab") ?: return Tab.TODAY
        return Tab.allCases.firstOrNull { it != Tab.TODAY && it.boardName == name } ?: Tab.TODAY
    }

    /** kosmos#7266 review 3: the board to load a create on (the computer the switcher shows), or null when the
     *  page is already on it (or none is shown yet). */
    fun createTarget(pageURL: String?, shown: String?): String? {
        val want = hostOf(shown) ?: return null
        return if (hostOf(pageURL) == want) null else shown
    }

    sealed interface CreateFallback {
        data object Projects : CreateFallback
        data class Load(val url: String) : CreateFallback
    }

    /** A + the board turned down: a refused project create opens Projects; a refused agent create loads the
     *  board's own create page (?tab=create). null when the press opened, still waits, or was not a create. */
    fun createFallback(door: String?, answer: DoorAnswer, pageURL: String?): CreateFallback? {
        if (door == null || answer == DoorAnswer.OPENED || !afterAnswer(answer, pageURL).over) return null
        if (door == Create.PROJECT.raw) return CreateFallback.Projects
        if (door != Create.AGENT.raw || pageURL == null) return null
        val u = try { URI(pageURL) } catch (e: Exception) { return null }
        val rebuilt = try { URI(u.scheme, u.authority, "/", "tab=create", null).toString() } catch (e: Exception) { return null }
        return CreateFallback.Load(rebuilt)
    }

    /** Marks every page the app loads, at document start, so the board hides its own navigation. */
    val markScript = """
    (function () {
      function mark() { document.documentElement.classList.add('kapptabs'); }
      if (document.documentElement) { mark(); return; }
      new MutationObserver(function (m, o) {
        if (document.documentElement) { o.disconnect(); mark(); }
      }).observe(document, { childList: true });
    })();
    """.trimIndent()

    /** The board keeps the Tasks flag from its status poll in localStorage, per Mac. */
    val tasksReadScript = "(function () { try { return localStorage.getItem('kosmos.tasksTab'); } catch (e) { return null; } })()"

    /** "1" and "0" are the board's answer; anything else says nothing. */
    fun tasksTab(fromPage: Any?): Boolean? = when (fromPage as? String) {
        "1" -> true
        "0" -> false
        else -> null
    }

    /** The app's own memory of the flag, so a launch shows the bar it last had. */
    const val rememberedTasksKey = "kosmos.app.tasksTab"

    private fun hostOf(url: String?): String? {
        url ?: return null
        return try { URI(url).host?.lowercase()?.takeIf { it.isNotEmpty() } } catch (e: Exception) { null }
    }

    private fun queryParam(url: String?, name: String): String? {
        url ?: return null
        val query = try { URI(url).query } catch (e: Exception) { null } ?: return null
        for (pair in query.split("&")) {
            if (pair.substringBefore("=") == name) return pair.substringAfter("=", "")
        }
        return null
    }
}
