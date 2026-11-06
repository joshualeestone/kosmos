package io.kosmos.app.shell

/**
 * kosmos#8046 slice 1 (board client): the two things the app reads from the board's GET /api/status poll
 * (kosmos#7032), ported from Shell.projectsUnread / AppTabs.tasksTab(fromStatus:) in ios/Kosmos/ShellLogic.swift.
 * The bar earns Tasks when no tab hosts the board page, and Projects shows an unread badge.
 *
 * Android divergence (as elsewhere in this port): the networking layer parses the JSON, so these take a
 * pre-parsed `Map<String, Any?>` rather than raw bytes + org.json, which keeps them framework-free and lets a
 * plain JVM test drive them.
 */
object BoardStatus {

    /** The Projects tab's badge: counts.projectsUnread when it is above zero; null (no badge) otherwise. */
    fun projectsUnread(status: Map<String, Any?>?): Int? {
        val counts = status?.get("counts") as? Map<*, *> ?: return null
        val n = (counts["projectsUnread"] as? Number)?.toInt() ?: return null
        return if (n > 0) n else null
    }

    /** The engine's Tasks flag; null when it is not there or not a boolean. */
    fun tasksTab(status: Map<String, Any?>?): Boolean? = status?.get("tasksTab") as? Boolean
}
