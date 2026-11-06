package io.kosmos.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * kosmos#8046 slice 1 (Josh 2026-11-05 18:33, mirrored from iOS #8058 / kosmos#8078): the dots are the
 * app's only loading indicator. This guard fails the build if any app source under android/app/src/main
 * brings back a ProgressBar, a Material progress indicator (Circular/Linear/…ProgressIndicator), a
 * ProgressDialog, or a SwipeRefreshLayout (its own pull-to-refresh spinner). Lines whose first non-blank
 * characters are `//` are skipped, as the iOS guard skips its comment lines; a renamed type or a
 * hand-made spinner is not caught (same limitation the iOS guard states).
 *
 * The positive control proves the matcher actually fires, so a scan that quietly matched nothing — the
 * classic false zero — cannot pass as "clean".
 */
class SweepGuardTest {

    private val banned = listOf("ProgressBar", "ProgressIndicator", "ProgressDialog", "SwipeRefreshLayout")

    /** The banned tokens found in [lines], after dropping // comment lines. */
    private fun offenders(lines: List<String>): List<String> {
        val code = lines.filter { !it.trimStart().startsWith("//") }
        return banned.filter { tok -> code.any { it.contains(tok) } }
    }

    private fun srcMain(): File {
        val here = File(System.getProperty("user.dir"))
        val candidate = File(here, "src/main")
        if (candidate.isDirectory) return candidate
        // Fall back to the repo layout: <repoRoot>/android/app/src/main.
        var dir: File? = here
        while (dir != null) {
            val m = File(dir, "android/app/src/main")
            if (m.isDirectory) return m
            dir = dir.parentFile
        }
        error("could not find android/app/src/main from ${System.getProperty("user.dir")}")
    }

    @Test fun onlyTheDots() {
        val root = srcMain()
        val found = mutableListOf<String>()
        val read = mutableListOf<String>()
        root.walkTopDown()
            .filter { it.isFile && (it.extension == "kt" || it.extension == "java" || it.extension == "xml") }
            .forEach { f ->
                read.add(f.name)
                offenders(f.readLines()).forEach { found.add("${f.name}: $it") }
            }
        assertTrue("app source was scanned (read ${read.size} files under ${root.path})", read.isNotEmpty())
        assertTrue("the manifest and the dots view were scanned", read.contains("AndroidManifest.xml") && read.contains("SweepDots.kt"))
        assertTrue("only the dots: no ProgressBar, Material progress indicator, ProgressDialog or SwipeRefreshLayout in app source: $found", found.isEmpty())
    }

    @Test fun controlTheMatcherFires() {
        assertFalse(
            "control: a ProgressBar in app source must be caught",
            offenders(listOf("    <ProgressBar android:layout_width=\"wrap_content\" />")).isEmpty(),
        )
        assertFalse(
            "control: a Material ProgressIndicator must be caught",
            offenders(listOf("CircularProgressIndicator(modifier = Modifier.size(20.dp))")).isEmpty(),
        )
        assertTrue(
            "control: a // comment line naming a banned type is skipped",
            offenders(listOf("// we must never use a ProgressBar here")).isEmpty(),
        )
    }
}
