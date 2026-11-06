package io.kosmos.app

import io.kosmos.app.shell.AppTabs
import io.kosmos.app.shell.AppTabs.DoorAnswer
import io.kosmos.app.shell.AppTabs.Tab
import io.kosmos.app.shell.PressTracker
import io.kosmos.app.shell.PressTracker.Page
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * kosmos#8046 slice 1: the tab-press / Tasks-read state machine, ported from the PressTracker cases in
 * ios/LogicTests/main.swift. Plain JVM (PressTracker has no Android types).
 */
class PressTrackerTest {

    private val roomURL = "https://studio.kosmosplus.com/?tab=projects&project=x"
    private val settingsURL = "https://studio.kosmosplus.com/?tab=settings"

    @Test fun presses() {
        val t = PressTracker()
        assertTrue("no web view yet: the press waits, pending kept", t.press(Tab.TASKS, Page.NO_VIEW, section = true) == null && t.pending == Tab.TASKS)
        assertTrue("a page still loading: the press waits", t.press(Tab.TASKS, Page.LOADING, section = true) == null && t.pending == Tab.TASKS)

        val native = PressTracker()
        assertTrue("the native Projects tab runs nothing", native.press(Tab.PROJECTS, Page.READY) == null && native.pending == null)
        assertTrue("the native Tasks tab runs nothing", native.press(Tab.TASKS, Page.READY) == null && native.pending == null)

        val serialBefore = t.serial
        val run = t.press(Tab.TASKS, Page.READY, section = true)
        assertTrue("a ready page: the press runs, with a new number", run != null && run.script == AppTabs.pressScript(Tab.TASKS) && run.serial == serialBefore + 1)
        assertTrue("no door: it still waits", t.answered(run!!.serial, DoorAnswer.ABSENT, null) == null && t.pending == Tab.TASKS)
        val waiting = t.press(Tab.TASKS, Page.READY, section = true)!!
        assertTrue("the press is running while it waits for its answer", t.running)
        assertTrue("no answer: waits for a load, no longer holds the bar", t.answered(waiting.serial, DoorAnswer.ABSENT, null) == null && !t.running && t.pending == Tab.TASKS)
        val again = t.press(Tab.TASKS, Page.READY, section = true)!!
        assertTrue("opened: over, and the bar goes to the tab pressed", t.answered(again.serial, DoorAnswer.OPENED, null) == Tab.TASKS && t.pending == null && !t.running)

        val u = PressTracker()
        val first = u.press(Tab.TASKS, Page.READY, section = true)!!
        val second = u.press(Tab.TASKS, Page.READY, section = true)!!
        assertTrue("a late answer to an earlier press moves nothing", u.answered(first.serial, DoorAnswer.REFUSED, roomURL) == null && u.pending == Tab.TASKS)
        assertTrue("the latest press's refusal ends it and moves the bar", u.answered(second.serial, DoorAnswer.REFUSED, roomURL) == Tab.PROJECTS && u.pending == null)

        val v = PressTracker()
        val shown = v.press(Tab.TASKS, Page.READY, section = true)!!
        v.loadingOwnPage()
        assertTrue("an agent tap ends a press; a late refusal cannot move the bar", v.pending == null && v.answered(shown.serial, DoorAnswer.REFUSED, settingsURL) == null)
        for (nativeTab in listOf(Tab.AGENTS, Tab.SETTINGS, Tab.PROJECTS, Tab.TASKS)) {
            v.press(Tab.TASKS, Page.LOADING, section = true)
            assertTrue("the native ${nativeTab.title} tab runs nothing and ends a waiting press", v.press(nativeTab, Page.READY) == null && v.pending == null)
        }
        val section = v.press(Tab.SETTINGS, Page.READY, section = true)
        assertTrue("the board's own Settings, pressed on purpose, runs", section?.script == AppTabs.pressScript(Tab.SETTINGS) && v.pending == Tab.SETTINGS)
        assertTrue("and the bar ends on Today with the board's Settings showing", v.answered(section!!.serial, DoorAnswer.OPENED, null) == Tab.SETTINGS && AppTabs.barTab(forPage = Tab.SETTINGS, tasksTab = true) == Tab.TODAY)

        val cold = PressTracker()
        assertTrue("pressed on purpose with no page yet, it waits", cold.press(Tab.SETTINGS, Page.NO_VIEW, section = true) == null && cold.pending == Tab.SETTINGS)
        assertTrue("and while a page loads", cold.press(Tab.SETTINGS, Page.LOADING, section = true) == null && cold.pending == Tab.SETTINGS)

        assertTrue("a lock on any tab leaves nothing to press", Tab.allCases.all { tab -> val x = PressTracker(); x.drop(tab); x.pending == null })
    }

    @Test fun tasksReadRounds() {
        val t = PressTracker()
        val g = t.generation
        val r1 = t.loaded() ?: -1
        val r2 = t.loaded() ?: -2
        assertTrue("each load starts a round", r1 > 0 && r2 > 0 && r1 != r2)
        assertTrue("only the latest round reads", !t.shouldRead(r1, g) && t.shouldRead(r2, g))
        assertTrue("the sign-in page's nothing does not end the launch's reads", t.read(null, g) == null && !t.readThisLaunch)
        assertTrue("a launch's 0 is applied but the round reads on", t.read(false, g) == false && !t.readThisLaunch && t.shouldRead(r2, g))
        assertTrue("a 1 sets the bar and ends the launch's reads", t.read(true, g) == true && t.readThisLaunch)

        val z = PressTracker()
        val zr = z.loaded()!!
        z.read(false, z.generation)
        assertTrue("after a launch's 0 the round reads on, but a later load starts no new round", z.shouldRead(zr, z.generation) && z.loaded() == null)
        z.drop(Tab.TODAY)
        assertTrue("a lock's fresh page reads again", z.loaded() != null)

        val y = PressTracker()
        val yr = y.loaded("mac-a.example")!!
        y.read(true, y.generation)
        assertTrue("the same Mac again: no new round", y.loaded("mac-a.example") == null)
        val other = y.loaded("mac-b.example")
        assertTrue("another Mac: its flag is read again", other != null && other != yr && !y.readThisLaunch)

        assertTrue("and then the rounds stop, loads start none", !t.shouldRead(r2, g) && t.loaded() == null)
        val back = t.returned()
        assertTrue("a return starts a round and its answers count", t.shouldRead(back, g) && t.read(false, g) == false)
        assertTrue("and it keeps reading after an answer", t.shouldRead(back, g))
        assertTrue("a load during a return starts no launch round and does not cut it", t.loaded() == null && t.shouldRead(back, g))
        assertTrue("a return reads only after a board poll could have written the flag, more than once", PressTracker.returnReads.minOrNull()!! > 5.0 && PressTracker.returnReads.size >= 2)
        assertEquals("a launch reads from the load...", 0.0, PressTracker.launchReads.first(), 1e-9)
        assertEquals("...for 20 s", 20.0, PressTracker.launchReads.last(), 1e-9)
        t.drop(Tab.TODAY)
        assertTrue("after a lock the dropped page's reads do not run", !t.readThisLaunch && !t.shouldRead(back, g))
        val fresh = t.loaded()
        assertTrue("and the fresh page reads again", fresh != null && t.shouldRead(fresh!!, t.generation))
    }
}
