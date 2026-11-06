package io.kosmos.app.sweep

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * kosmos#8046 slice 1: the board's Sweep loader as its CSS defines it, ported from
 * ios/Kosmos/SweepLogic.swift (kosmos#7954). Eight dots on a ring that light one after another,
 * clockwise from the top. This file is the arithmetic only, with no Android types, so a plain JVM
 * unit test (SweepLogicTest) can run it and pin every constant below to the board's CSS text
 * (web/index.html .spin-sweep, @keyframes sweepLite and calmPulse). SweepDots draws these dots.
 *
 * Kept a line-for-line translation of the iOS logic on purpose: the iOS version is pinned to the same
 * CSS and exercised by ios/LogicTests/sweep/main.swift, so keeping the two in step keeps both pinned to
 * one source of truth (the board).
 */
object SweepLogic {
    const val count = 8

    /** sweepLite's loop in seconds, and how far each dot runs behind the one before (animation-delay steps). */
    const val loop = 1.2
    const val step = 0.15

    /** sweepLite's keyframes: at rest, lit at `peakAt` of the loop, back at rest from `restFrom` on. */
    const val restOpacity = 0.2
    const val restScale = 0.6
    const val litOpacity = 1.0
    const val litScale = 1.08
    const val peakAt = 0.2
    const val restFrom = 0.72

    /** calmPulse (Reduce Motion): every dot together, `calmHigh` to `calmLow` and back over `calmLoop`, no size change. */
    const val calmLoop = 1.6
    const val calmHigh = 0.85
    const val calmLow = 0.4

    /** A dot's width as a share of the ring's side (the board's --dot: calc(var(--sz)*0.19)). */
    const val dotShare = 0.19

    /**
     * The moment of the loop the first frame shows (dot 0, at the top, at its brightest, the others
     * trailing), and where every ring starts its loop when it appears (kosmos#7945 follow-up).
     */
    const val launchAt = peakAt * loop

    /** Reduce Motion: the seconds the ring takes, once shown, to fade from the launch frame into the pulse, in place. */
    const val calmFrom = 0.6

    data class Dot(
        val x: Double,        // centre, in the box's pixels
        val y: Double,
        val diameter: Double, // after scaling
        val opacity: Double,
    )

    /**
     * The dots `elapsed` seconds after a ring appeared: the loop from `launchAt` on, so its first frame is
     * the launch frame. With Reduce Motion the pulse is reached by a fade from that same frame over
     * `calmFrom` seconds (a fade, nothing moves), so the hand-over from launch does not switch looks.
     */
    fun shown(elapsed: Double, side: Double, reduceMotion: Boolean): List<Dot> {
        val e = if (elapsed < 0.0) 0.0 else elapsed
        // 24 s holds a whole number of both loops (20 of 1.2 s, 15 of 1.6 s): no jump at the wrap.
        val now = dots((e + launchAt).mod(24.0), side, reduceMotion)
        if (!(reduceMotion && e < calmFrom)) return now
        val k = easeInOut(e / calmFrom)
        val from = dots(launchAt, side, false)
        return from.zip(now) { a, b ->
            Dot(b.x, b.y, a.diameter + (b.diameter - a.diameter) * k, a.opacity + (b.opacity - a.opacity) * k)
        }
    }

    /** CSS ease-in-out, cubic-bezier(.42, 0, .58, 1): the y for a given x, by bisection on the curve's x. */
    fun easeInOut(x: Double): Double {
        if (x <= 0.0) return 0.0
        if (x >= 1.0) return 1.0
        fun bez(s: Double, p1: Double, p2: Double): Double {
            val u = 1 - s
            return 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s
        }
        var lo = 0.0
        var hi = 1.0
        repeat(40) {
            val mid = (lo + hi) / 2
            if (bez(mid, 0.42, 0.58) < x) lo = mid else hi = mid
        }
        return bez((lo + hi) / 2, 0.0, 1.0)
    }

    /** Opacity and scale of one dot at time t (seconds), as sweepLite. */
    fun look(t: Double, dot: Int): Pair<Double, Double> {
        val local = (t - dot * step).mod(loop)
        val p = local / loop
        val rest = restOpacity to restScale
        val lit = litOpacity to litScale
        fun mix(a: Pair<Double, Double>, b: Pair<Double, Double>, k: Double): Pair<Double, Double> =
            (a.first + (b.first - a.first) * k) to (a.second + (b.second - a.second) * k)
        if (p < peakAt) return mix(rest, lit, easeInOut(p / peakAt))
        if (p < restFrom) return mix(lit, rest, easeInOut((p - peakAt) / (restFrom - peakAt)))
        return rest
    }

    /** Every dot's opacity with Reduce Motion on (calmPulse). */
    fun calmOpacity(t: Double): Double {
        val local = t.mod(calmLoop)
        val p = local / calmLoop
        return if (p < 0.5) calmHigh + (calmLow - calmHigh) * easeInOut(p / 0.5)
        else calmLow + (calmHigh - calmLow) * easeInOut((p - 0.5) / 0.5)
    }

    /**
     * The eight dots in a box of the given side, dot 0 at the top and the rest clockwise, 45 degrees apart.
     * The ring is pulled in so a lit dot (the largest) still fits inside the box.
     */
    fun dots(t: Double, side: Double, reduceMotion: Boolean): List<Dot> {
        val d = side * dotShare
        val r = side / 2 - d * litScale / 2
        return (0 until count).map { i ->
            val a = i * 2 * PI / count
            val (opacity, scale) = if (reduceMotion) calmOpacity(t) to 1.0 else look(t, i)
            Dot(side / 2 + r * sin(a), side / 2 - r * cos(a), d * scale, opacity)
        }
    }
}
