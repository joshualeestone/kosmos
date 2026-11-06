package io.kosmos.app

import io.kosmos.app.shell.BoardStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * kosmos#8046 slice 1 (board client): what the app reads from GET /api/status, ported from ShellLogic.swift.
 * The status body arrives pre-parsed as a Map (the networking-layer divergence).
 */
class BoardStatusTest {

    @Test fun projectsUnreadIsABadgeOnlyAboveZero() {
        assertEquals(3, BoardStatus.projectsUnread(mapOf("counts" to mapOf("projectsUnread" to 3))))
        assertNull("zero is no badge", BoardStatus.projectsUnread(mapOf("counts" to mapOf("projectsUnread" to 0))))
        assertNull("no counts, no badge", BoardStatus.projectsUnread(mapOf("other" to 1)))
        assertNull("counts without the key", BoardStatus.projectsUnread(mapOf("counts" to emptyMap<String, Any?>())))
        assertNull("a non-number count is ignored", BoardStatus.projectsUnread(mapOf("counts" to mapOf("projectsUnread" to "lots"))))
        assertNull(BoardStatus.projectsUnread(null))
    }

    @Test fun tasksFlagIsTakenOnlyAsABoolean() {
        assertEquals(true, BoardStatus.tasksTab(mapOf("tasksTab" to true)))
        assertEquals(false, BoardStatus.tasksTab(mapOf("tasksTab" to false)))
        assertNull("absent", BoardStatus.tasksTab(mapOf("other" to 1)))
        assertNull("a string is not the flag", BoardStatus.tasksTab(mapOf("tasksTab" to "1")))
        assertNull(BoardStatus.tasksTab(null))
    }
}
