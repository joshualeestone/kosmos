package io.kosmos.app

import io.kosmos.app.shell.AppTabs
import io.kosmos.app.shell.AppTabs.DoorAnswer
import io.kosmos.app.shell.AppTabs.Tab
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * kosmos#8046 slice 1: the app's tab bar + board door, ported from the AppTabs cases in
 * ios/LogicTests/main.swift. Plain JVM (AppTabs has no Android types). The door/mark JS strings are checked
 * by content (as the iOS pressScript test does), not executed.
 */
class AppTabsTest {

    private val home = "https://studio.kosmosplus.com/"
    private val roomURL = "https://studio.kosmosplus.com/?tab=projects&project=x"
    private val settingsURL = "https://studio.kosmosplus.com/?tab=settings"
    private val signIn = "https://${AppTabs.signInHost}/"

    @Test fun visibleAndKeep() {
        assertEquals("five tabs once Tasks is earned", listOf(Tab.TODAY, Tab.AGENTS, Tab.PROJECTS, Tab.TASKS, Tab.SETTINGS), AppTabs.visible(tasksTab = true, todayTab = true))
        assertEquals("four before it, Tasks left out", listOf(Tab.TODAY, Tab.AGENTS, Tab.PROJECTS, Tab.SETTINGS), AppTabs.visible(tasksTab = false, todayTab = true))
        assertEquals("Tasks leaving the bar while showing goes to Today", Tab.TODAY, AppTabs.keep(Tab.TASKS, tasksTab = false, todayTab = true))
        assertEquals("any other tab stays", Tab.PROJECTS, AppTabs.keep(Tab.PROJECTS, tasksTab = false))
        assertEquals("Tasks stays while in the bar", Tab.TASKS, AppTabs.keep(Tab.TASKS, tasksTab = true))
    }

    @Test fun titlesSymbolsAssets() {
        assertEquals(listOf("Today", "Agents", "Projects", "Tasks", "Settings"), AppTabs.visible(true, true).map { it.title })
        assertEquals(listOf("sun.max", "person.2", "briefcase", "checklist", "gearshape"), AppTabs.visible(true, true).map { it.symbol })
        assertEquals("TabAgent", Tab.AGENTS.asset)
        assertTrue(Tab.allCases.filter { it != Tab.AGENTS }.all { it.asset == null })
    }

    @Test fun boardNamesAndPressScript() {
        assertEquals("Today opens the board's home, its agents tab", "agents", Tab.TODAY.boardName)
        assertNull("Agents is native: no board name", Tab.AGENTS.boardName)
        assertNull("Agents is native: no press on the board", AppTabs.pressScript(Tab.AGENTS))
        assertTrue("a press asks the door for that tab's board name", AppTabs.pressScript(Tab.SETTINGS)!!.contains("window.kosmosAppTab('settings')"))
        // a create carries the box-covered guard; a plain section does not
        assertTrue(AppTabs.pressScript(door = "new-agent").contains("return 'covered'"))
        assertTrue(!AppTabs.pressScript(door = "settings").contains("'covered'"))
    }

    @Test fun doorAnswer() {
        assertEquals(DoorAnswer.OPENED, AppTabs.answer("opened", null))
        assertEquals(DoorAnswer.REFUSED, AppTabs.answer("refused", null))
        assertEquals("the script's absent is a page without the door", DoorAnswer.NO_DOOR, AppTabs.answer("absent", null))
        assertEquals("anything else is no answer", DoorAnswer.ABSENT, AppTabs.answer(null, null))
        assertEquals("a true is not opened", DoorAnswer.ABSENT, AppTabs.answer(true, null))
        assertEquals("an error is no answer whatever came with it", DoorAnswer.ABSENT, AppTabs.answer("opened", RuntimeException("mid-nav")))
    }

    @Test fun afterAnswer() {
        assertEquals(AppTabs.After(true, null), AppTabs.afterAnswer(DoorAnswer.OPENED, roomURL))
        assertEquals(AppTabs.After(false, null), AppTabs.afterAnswer(DoorAnswer.ABSENT, roomURL))
        assertEquals("refused: the section the page is on (a project room: Projects)", AppTabs.After(true, Tab.PROJECTS), AppTabs.afterAnswer(DoorAnswer.REFUSED, roomURL))
        assertEquals("on Settings: Settings", AppTabs.After(true, Tab.SETTINGS), AppTabs.afterAnswer(DoorAnswer.REFUSED, settingsURL))
        assertEquals("no address: Today", AppTabs.After(true, Tab.TODAY), AppTabs.afterAnswer(DoorAnswer.REFUSED, null))
        assertEquals("no door on the sign-in page: the press waits", AppTabs.After(false, null), AppTabs.afterAnswer(DoorAnswer.NO_DOOR, signIn))
        assertEquals("no door and no address: it waits", AppTabs.After(false, null), AppTabs.afterAnswer(DoorAnswer.NO_DOOR, null))
        assertEquals("no door on a Mac's page: ends, bar goes where the page is", AppTabs.After(true, Tab.PROJECTS), AppTabs.afterAnswer(DoorAnswer.NO_DOOR, roomURL))
        assertEquals("the sign-in host is the coordinator's", "login.kosmosplus.com", AppTabs.signInHost)
        val anyURL = listOf(home, roomURL, settingsURL, signIn, "https://studio.kosmosplus.com/?tab=tasks", null)
        assertTrue("no refusal ever puts the bar on Agents", anyURL.all { AppTabs.afterAnswer(DoorAnswer.REFUSED, it).barTo != Tab.AGENTS })
    }

    @Test fun barTab() {
        assertEquals(Tab.TODAY, AppTabs.barTab(forPage = Tab.TASKS, tasksTab = false))
        assertEquals(Tab.TODAY, AppTabs.barTab(forPage = Tab.TASKS, tasksTab = true))
        assertEquals(Tab.TODAY, AppTabs.barTab(forPage = Tab.PROJECTS, tasksTab = false))
        assertEquals("the board's Agents page lights Agents", Tab.AGENTS, AppTabs.barTab(forPage = Tab.AGENTS, tasksTab = true))
        assertEquals("the board's Settings shows under Today", Tab.TODAY, AppTabs.barTab(forPage = Tab.SETTINGS, tasksTab = true))
    }

    private fun f(from: String?, to: String?, selected: Tab, held: Boolean = false, tasks: Boolean = false): Tab? =
        AppTabs.follow(from, to, selected, barHeld = held, tasksTab = tasks)

    @Test fun followMovesNothingNowEveryTabIsNative() {
        assertNull(f(home, roomURL, Tab.TODAY))
        assertNull(f(roomURL, home, Tab.PROJECTS))
        assertNull(f(roomURL, home, Tab.TASKS, tasks = true))
        // the full sweep: every section against every tab, offered or not, must move nothing
        val sections = listOf("", "?tab=agents", "?tab=detail&agent=a", "?tab=projects", "?tab=projects&project=x", "?tab=tasks", "?tab=settings")
        for (q in sections) for (tab in Tab.allCases) for (offered in listOf(false, true)) {
            assertNull("the page '$q' moves nothing from ${tab.title} (Tasks $offered)", f(signIn, "https://studio.kosmosplus.com/$q", tab, tasks = offered))
        }
        assertNull("the bar held for a press: its answer decides", f(home, settingsURL, Tab.TODAY, held = true))
        assertNull("never from Agents", f(home, settingsURL, Tab.AGENTS))
        assertNull("no address: nothing moves", f(home, null, Tab.SETTINGS))
        assertNull("never on the sign-in page", f(home, signIn, Tab.TODAY))
        assertNull("an address rewritten within one section moves nothing", f(roomURL, "https://studio.kosmosplus.com/?tab=projects&project=y", Tab.SETTINGS))
        assertNull("the board's Tasks section stays under Today", f(home, "https://studio.kosmosplus.com/?tab=tasks", Tab.TODAY, tasks = true))
        assertNull("from the sign-in page to a project page keeps Today", f(signIn, roomURL, Tab.TODAY))
    }

    @Test fun tabForBoardURL() {
        assertEquals(Tab.TODAY, AppTabs.tab(forBoardURL = home))
        assertEquals(Tab.TODAY, AppTabs.tab(forBoardURL = "https://studio.kosmosplus.com/?tab=agents"))
        assertEquals(Tab.PROJECTS, AppTabs.tab(forBoardURL = roomURL))
        assertEquals(Tab.TASKS, AppTabs.tab(forBoardURL = "https://studio.kosmosplus.com/?tab=tasks"))
        assertEquals(Tab.SETTINGS, AppTabs.tab(forBoardURL = settingsURL))
        assertEquals("an agent chat is Today", Tab.TODAY, AppTabs.tab(forBoardURL = "https://studio.kosmosplus.com/?tab=detail&agent=a"))
    }

    @Test fun createTargetAndFallback() {
        assertNull("already on the shown computer: nothing to load first", AppTabs.createTarget(pageURL = "https://a.kosmosplus.com/", shown = "https://a.kosmosplus.com/?tab=projects"))
        assertEquals("another computer: load it first", "https://b.kosmosplus.com/", AppTabs.createTarget(pageURL = "https://a.kosmosplus.com/", shown = "https://b.kosmosplus.com/"))
        assertEquals("a refused project create opens Projects", AppTabs.CreateFallback.Projects, AppTabs.createFallback("new-project", DoorAnswer.REFUSED, home))
        assertEquals("a refused agent create loads the board's create page", AppTabs.CreateFallback.Load("https://studio.kosmosplus.com/?tab=create"), AppTabs.createFallback("new-agent", DoorAnswer.REFUSED, "https://studio.kosmosplus.com/?tab=detail&agent=a"))
        assertNull("an opened create has no fallback", AppTabs.createFallback("new-agent", DoorAnswer.OPENED, home))
        assertNull("not a create: no fallback", AppTabs.createFallback(null, DoorAnswer.REFUSED, home))
    }

    @Test fun scriptsAndTasksFlag() {
        assertTrue("mark adds kapptabs", AppTabs.markScript.contains("classList.add('kapptabs')"))
        assertTrue("mark waits for the root via a MutationObserver", AppTabs.markScript.contains("MutationObserver"))
        assertTrue("the tasks read reads localStorage", AppTabs.tasksReadScript.contains("localStorage.getItem('kosmos.tasksTab')"))
        assertEquals(true, AppTabs.tasksTab(fromPage = "1"))
        assertEquals(false, AppTabs.tasksTab(fromPage = "0"))
        assertNull(AppTabs.tasksTab(fromPage = null))
        assertNull("anything else says nothing", AppTabs.tasksTab(fromPage = "wrong key"))
    }
}
