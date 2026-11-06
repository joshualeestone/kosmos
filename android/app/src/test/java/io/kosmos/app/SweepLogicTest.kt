package io.kosmos.app

import io.kosmos.app.sweep.SweepLogic
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.Locale
import kotlin.math.abs

/**
 * kosmos#8046 slice 1: the Android Sweep loader's numbers, ported from ios/LogicTests/sweep/main.swift.
 * Two halves, both from one source of truth (the board): the constants are pinned to the board's CSS text
 * (web/index.html .spin-sweep, @keyframes sweepLite and calmPulse), and the motion is checked against
 * those constants. The pin check and the dot-order check each carry a control that must fail, so a check
 * that quietly matches nothing cannot pass. Plain JVM test: SweepLogic has no Android types.
 */
class SweepLogicTest {

    private fun near(a: Double, b: Double, e: Double = 1e-9): Boolean = abs(a - b) < e

    /** A number as the board's CSS writes it: whole numbers bare, others without a leading zero (.2, 1.08). */
    private fun css(x: Double): String {
        if (x == Math.rint(x)) return x.toInt().toString()
        val s = x.toString()
        return if (s.startsWith("0.")) s.substring(1) else s
    }

    private fun pct(x: Double): String = (x * 100).let { Math.round(it) }.toString()

    private fun repoRoot(): File {
        System.getenv("KOSMOS_REPO")?.let { return File(it) }
        var dir: File? = File(System.getProperty("user.dir") ?: ".")
        while (dir != null) {
            if (File(dir, "web/index.html").exists()) return dir
            dir = dir.parentFile
        }
        error("could not find repo root (web/index.html) from ${System.getProperty("user.dir")}; set KOSMOS_REPO")
    }

    /** Every rule of the board's Sweep that SweepLogic copies, written from SweepLogic's constants. */
    private fun missingPins(page: String): List<String> {
        val want = mutableListOf(
            "--dot: calc(var(--sz)*${SweepLogic.dotShare})",
            "position: absolute; top: 0; left: 50%; width: var(--dot); height: var(--dot);",
            "transform: none !important; opacity: ${css(SweepLogic.calmHigh)}; }",
            ".spin-sweep i::before { animation: sweepLite ${css(SweepLogic.loop)}s ease-in-out infinite; opacity: ${css(SweepLogic.restOpacity)}; }",
            "@keyframes sweepLite { 0%, ${pct(SweepLogic.restFrom)}%, 100% { opacity: ${css(SweepLogic.restOpacity)}; transform: scale(${css(SweepLogic.restScale)}); } " +
                "${pct(SweepLogic.peakAt)}% { opacity: ${css(SweepLogic.litOpacity)}; transform: scale(${css(SweepLogic.litScale)}); } }",
            "animation: calmPulse ${css(SweepLogic.calmLoop)}s ease-in-out infinite",
            "@keyframes calmPulse { 0%, 100% { opacity: ${css(SweepLogic.calmHigh)}; } 50% { opacity: ${css(SweepLogic.calmLow)}; } }",
        )
        for (i in 0 until SweepLogic.count) {
            want.add(".spin i:nth-child(${i + 1}) { transform: rotate(${i * 360 / SweepLogic.count}deg); }")
            var delay = String.format(Locale.ROOT, "%.3f", SweepLogic.loop - SweepLogic.step * i)
            if (delay.startsWith("0.")) delay = delay.substring(1)
            want.add(".spin-sweep i:nth-child(${i + 1})::before { animation-delay: -${delay}s; }")
        }
        return want.filter { !page.contains(it) }
    }

    @Test fun constantsPinnedToBoardCss() {
        val page = repoRoot().resolve("web/index.html").readText()
        assertTrue("the board's page was read (KOSMOS_REPO)", page.isNotEmpty())
        val missing = missingPins(page)
        assertTrue("every Sweep rule SweepLogic copies is on the board's page as written: missing $missing", missing.isEmpty())
        assertFalse(
            "control: a page with the rest keyframe moved must fail the same pins",
            missingPins(page.replace("0%, 72%, 100%", "0%, 70%, 100%")).isEmpty(),
        )
    }

    @Test fun easeInOutIsTheCssCurve() {
        assertTrue(near(SweepLogic.easeInOut(0.0), 0.0) && near(SweepLogic.easeInOut(1.0), 1.0) && near(SweepLogic.easeInOut(0.5), 0.5, 1e-6))
        assertTrue("ease-in-out(0.25) is the CSS curve's (${SweepLogic.easeInOut(0.25)})", near(SweepLogic.easeInOut(0.25), 0.129161, 1e-4))
    }

    @Test fun keyframes() {
        val l = SweepLogic.loop
        val rest = SweepLogic.look(0.0, 0)
        val lit = SweepLogic.look(0.2 * l, 0)
        assertTrue("dot 0 at rest at t = 0", near(rest.first, 0.2) && near(rest.second, 0.6))
        assertTrue("dot 0 lit at 20% of its loop", near(lit.first, 1.0) && near(lit.second, 1.08))
        val falling = SweepLogic.look(0.715 * l, 0)
        val landed = SweepLogic.look(0.72 * l, 0)
        val late = SweepLogic.look(0.8 * l, 0)
        assertTrue("dot 0 still falling just before 72% (${falling.first})", falling.first > 0.2 + 1e-6 && falling.first < 0.21)
        assertTrue("dot 0 at rest at 72% and after", near(landed.first, 0.2) && near(landed.second, 0.6) && near(late.first, 0.2) && near(late.second, 0.6))
        assertTrue("the loop repeats every 1.2 s", near(SweepLogic.look(0.37, 3).first, SweepLogic.look(0.37 + l * 7, 3).first))
    }

    private fun peak(i: Int): Double {
        var best = 0.0
        var bestOp = -1.0
        var t = 0.0
        while (t < SweepLogic.loop) {
            val op = SweepLogic.look(t, i).first
            if (op > bestOp) { bestOp = op; best = t }
            t += 0.001
        }
        return best
    }

    private fun gapsOk(ps: List<Double>): Boolean = ps.zip(ps.drop(1)).all { (a, b) ->
        var g = (b - a) % SweepLogic.loop
        if (g < 0) g += SweepLogic.loop
        near(g, 0.15, 0.002)
    }

    @Test fun dotsPeakClockwise() {
        val peaks = (0 until 8).map { peak(it) }
        assertTrue("each dot peaks 0.15 s after the one before: $peaks", gapsOk(peaks))
        assertFalse("control: the reversed order fails the same check", gapsOk(peaks.reversed()))
    }

    @Test fun geometry() {
        val side = 20.0
        val edge = side * 0.19 * 1.08 / 2
        val ds = SweepLogic.dots(0.0, side, false)
        assertEquals("eight dots", 8, ds.size)
        assertTrue("dot 0 at the top centre (${ds[0].x}, ${ds[0].y})", near(ds[0].x, 10.0) && near(ds[0].y, edge))
        assertTrue("dot 2 at the right (${ds[2].x}, ${ds[2].y})", near(ds[2].x, side - edge) && near(ds[2].y, 10.0))
        val big = SweepLogic.dots(0.24, side, false)[0]
        assertTrue("a lit dot is 1.08 times its width (${big.diameter})", near(big.diameter, side * 0.19 * 1.08))
        var t = 0.0
        var inside = true
        while (t < SweepLogic.loop) {
            inside = inside && SweepLogic.dots(t, side, false).all {
                it.x - it.diameter / 2 >= -1e-9 && it.x + it.diameter / 2 <= side + 1e-9 &&
                    it.y - it.diameter / 2 >= -1e-9 && it.y + it.diameter / 2 <= side + 1e-9
            }
            t += 0.005
        }
        assertTrue("every dot stays inside the box at every moment of the loop", inside)
    }

    @Test fun reduceMotionPulse() {
        val side = 20.0
        val calm0 = SweepLogic.dots(0.0, side, true)
        val calmMid = SweepLogic.dots(0.8, side, true)
        assertTrue("Reduce Motion: all at .85, full size, at t = 0", calm0.all { near(it.opacity, 0.85) && near(it.diameter, side * 0.19) })
        assertTrue("Reduce Motion: all at .4 halfway through 1.6 s", calmMid.all { near(it.opacity, 0.4) })
        assertTrue("Reduce Motion: nothing moves or grows", calm0.zip(calmMid).all { (a, b) -> near(a.x, b.x) && near(a.y, b.y) && near(a.diameter, b.diameter) })
    }

    private fun same(a: List<SweepLogic.Dot>, b: List<SweepLogic.Dot>): Boolean =
        a.zip(b).all { (x, y) -> near(x.x, y.x) && near(x.y, y.y) && near(x.diameter, y.diameter) && near(x.opacity, y.opacity) }

    @Test fun launchFrame() {
        val side = 20.0
        val launch = SweepLogic.dots(SweepLogic.launchAt, side, false)
        assertTrue(
            "the launch frame lights dot 0, at the top, at its brightest",
            near(launch[0].opacity, SweepLogic.litOpacity) && near(launch[0].diameter, side * SweepLogic.dotShare * SweepLogic.litScale),
        )
        assertTrue(
            "the launch frame: dots 7, 6, 5 trail behind dot 0, dimming; dot 1 starts to light; dots 2 and 3 at rest",
            launch[7].opacity > launch[6].opacity && launch[6].opacity > launch[5].opacity && launch[5].opacity > SweepLogic.restOpacity &&
                launch[1].opacity > SweepLogic.restOpacity && launch[1].opacity < launch[7].opacity &&
                near(launch[2].opacity, SweepLogic.restOpacity) && near(launch[3].opacity, SweepLogic.restOpacity),
        )
    }

    @Test fun shownStartsAtLaunchFrame() {
        val side = 20.0
        val launch = SweepLogic.dots(SweepLogic.launchAt, side, false)
        assertTrue(
            "a ring's first frame is the launch frame, with or without Reduce Motion",
            same(SweepLogic.shown(0.0, side, false), launch) && same(SweepLogic.shown(0.0, side, true), launch),
        )
        val f = SweepLogic.calmFrom
        val a = SweepLogic.launchAt
        assertTrue(
            "Reduce Motion: the pulse from calmFrom on",
            same(SweepLogic.shown(f, side, true), SweepLogic.dots(f + a, side, true)) &&
                same(SweepLogic.shown(5.0, side, true), SweepLogic.dots(5.0 + a, side, true)),
        )
        val halfway = SweepLogic.shown(f / 2, side, true)
        val calmThen = SweepLogic.dots(f / 2 + a, side, true)
        val between = halfway.indices.all { i ->
            val h = halfway[i]; val l = launch[i]; val c = calmThen[i]
            near(h.x, l.x) && near(h.y, l.y) &&
                h.opacity >= minOf(l.opacity, c.opacity) - 1e-9 && h.opacity <= maxOf(l.opacity, c.opacity) + 1e-9
        }
        assertTrue(
            "Reduce Motion: halfway, every dot between the launch frame and the pulse, none moved",
            between && !same(halfway, launch) && !same(halfway, calmThen),
        )
        assertTrue(
            "without Reduce Motion, the loop from launchAt on",
            same(SweepLogic.shown(2.5, side, false), SweepLogic.dots(2.5 + a, side, false)),
        )
    }

    @Test fun wrapsAt24sWithNoJump() {
        assertTrue(
            "24 s is a whole number of both loops",
            near(SweepLogic.look(24.0, 5).first, SweepLogic.look(0.0, 5).first) && near(SweepLogic.calmOpacity(24.0), SweepLogic.calmOpacity(0.0)),
        )
    }
}
